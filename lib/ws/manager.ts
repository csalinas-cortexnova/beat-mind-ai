/**
 * ConnectionManager — routes WS connections, manages agent/TV lifecycle,
 * orchestrates data flow between handlers, gym state, and batch writer.
 */

import type { WebSocket, WebSocketServer } from "ws";
import type { IncomingMessage } from "http";
import { authenticateAgent, authenticateTv } from "./auth";
import { handleAgentMessage } from "./agent-handler";
import { buildInitMessage, setupTvPing } from "./tv-handler";
import { log } from "@/lib/logger";
import type { GymStateManager } from "./gym-state";
import type { BatchWriter } from "./batch-writer";
import type { AutoSessionManager } from "./auto-session";
import type {
  AgentConnection,
  TvConnection,
  TvOutboundMessage,
  WsConfig,
  WsMetrics,
} from "./types";
import { WS_CLOSE_CODES } from "./types";

export class ConnectionManager {
  private agentConnections: Map<string, AgentConnection> = new Map(); // gymId → agent
  private tvConnections: Map<string, Set<TvConnection>> = new Map(); // gymId → Set<tv>
  private offlineTimers: Map<string, ReturnType<typeof setTimeout>> = new Map(); // gymId → timer
  private tvPingCleanups: Map<WebSocket, () => void> = new Map();
  private startTime = Date.now();

  constructor(
    private wss: WebSocketServer,
    private gymState: GymStateManager,
    private batchWriter: BatchWriter,
    private autoSession: AutoSessionManager,
    private config: WsConfig
  ) {}

  start(): void {
    this.startTime = Date.now();
    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      this.handleConnection(ws, req);
    });
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const url = req.url || "";

    if (url === "/ws/agent") {
      this.handleAgentConnection(ws);
    } else if (url.startsWith("/ws/tv/")) {
      this.handleTVConnection(ws, url);
    } else {
      ws.close(WS_CLOSE_CODES.UNKNOWN_ENDPOINT, "Unknown endpoint");
    }
  }

  private async handleAgentConnection(ws: WebSocket): Promise<void> {
    try {
      const ctx = await authenticateAgent(ws, this.config.WS_AUTH_TIMEOUT);

      // Replace existing agent for this gym
      const existing = this.agentConnections.get(ctx.gymId);
      if (existing) {
        existing.ws.close(WS_CLOSE_CODES.REPLACED, "Replaced by new connection");
        log.info("Agent replaced", {
          module: "manager",
          gymId: ctx.gymId,
          oldAgent: existing.agentId,
          newAgent: ctx.agentId,
        });
      }

      // Cancel offline timer if reconnecting
      const offlineTimer = this.offlineTimers.get(ctx.gymId);
      if (offlineTimer) {
        clearTimeout(offlineTimer);
        this.offlineTimers.delete(ctx.gymId);
      }

      const conn: AgentConnection = {
        ws,
        agentId: ctx.agentId,
        gymId: ctx.gymId,
        connectedAt: Date.now(),
        lastMessage: Date.now(),
        messageCount: 0,
      };
      this.agentConnections.set(ctx.gymId, conn);

      // Send auth-ok
      ws.send(JSON.stringify({ type: "auth-ok", gymId: ctx.gymId }));

      // Handle messages
      ws.on("message", async (data: Buffer | string) => {
        conn.lastMessage = Date.now();
        conn.messageCount++;
        await handleAgentMessage(data, ctx.agentId, ctx.gymId, {
          gymState: this.gymState,
          batchWriter: this.batchWriter,
          autoSession: this.autoSession,
          broadcastToGym: (gymId, msg) => this.broadcastToGym(gymId, msg),
        });
      });

      // Handle disconnect
      ws.on("close", () => {
        this.agentConnections.delete(ctx.gymId);
        log.info("Agent disconnected", {
          module: "manager",
          gymId: ctx.gymId,
          agentId: ctx.agentId,
        });

        // Start 60s offline timer
        const timer = setTimeout(() => {
          this.offlineTimers.delete(ctx.gymId);
          log.warn("Agent offline timeout", {
            module: "manager",
            gymId: ctx.gymId,
          });
        }, 60_000);
        this.offlineTimers.set(ctx.gymId, timer);
      });

      log.info("Agent connected", {
        module: "manager",
        gymId: ctx.gymId,
        agentId: ctx.agentId,
      });
    } catch (err) {
      // Auth failed — ws already closed by authenticateAgent
      log.warn("Agent auth failed", {
        module: "manager",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handleTVConnection(ws: WebSocket, url: string): Promise<void> {
    // Parse: /ws/tv/{gymId}?token=TOKEN
    const urlObj = new URL(url, "http://localhost");
    const parts = urlObj.pathname.split("/");
    const gymId = parts[3]; // /ws/tv/{gymId}
    const token = urlObj.searchParams.get("token");

    if (!gymId || !token) {
      ws.close(WS_CLOSE_CODES.AUTH_FAILED, "Missing gymId or token");
      return;
    }

    const ctx = await authenticateTv(gymId, token);
    if (!ctx) {
      ws.close(WS_CLOSE_CODES.AUTH_FAILED, "Invalid TV credentials");
      return;
    }

    const tv: TvConnection = {
      ws,
      gymId,
      connectedAt: Date.now(),
      lastPong: Date.now(),
    };

    // Add to gym's TV set
    if (!this.tvConnections.has(gymId)) {
      this.tvConnections.set(gymId, new Set());
    }
    this.tvConnections.get(gymId)!.add(tv);

    // Send init message
    try {
      const initMsg = await buildInitMessage(this.gymState, gymId);
      ws.send(JSON.stringify(initMsg));
    } catch (err) {
      log.error("TV: failed to send init", {
        module: "manager",
        gymId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Set up ping/pong
    const stopPing = setupTvPing(
      tv,
      this.config.WS_PING_INTERVAL,
      this.config.WS_PONG_TIMEOUT
    );
    this.tvPingCleanups.set(ws, stopPing);

    // Handle disconnect
    ws.on("close", () => {
      const tvSet = this.tvConnections.get(gymId);
      if (tvSet) {
        tvSet.delete(tv);
        if (tvSet.size === 0) this.tvConnections.delete(gymId);
      }
      const cleanup = this.tvPingCleanups.get(ws);
      if (cleanup) {
        cleanup();
        this.tvPingCleanups.delete(ws);
      }
      log.info("TV disconnected", { module: "manager", gymId });
    });

    log.info("TV connected", { module: "manager", gymId });
  }

  broadcastToGym(gymId: string, message: TvOutboundMessage): void {
    const tvSet = this.tvConnections.get(gymId);
    if (!tvSet || tvSet.size === 0) return;

    const serialized = JSON.stringify(message);
    for (const tv of tvSet) {
      if (tv.ws.readyState === 1) {
        // WebSocket.OPEN
        tv.ws.send(serialized);
      }
    }
  }

  getMetrics(): WsMetrics {
    return {
      uptime: Math.round((Date.now() - this.startTime) / 1000),
      agentConnections: this.agentConnections.size,
      tvConnections: Array.from(this.tvConnections.values()).reduce(
        (sum, set) => sum + set.size,
        0
      ),
      activeGyms: new Set([
        ...this.agentConnections.keys(),
        ...this.tvConnections.keys(),
      ]).size,
      batchWriterBuffered: this.batchWriter.getBufferedCount(),
    };
  }

  async shutdown(): Promise<void> {
    // Close all agent connections
    for (const [, conn] of this.agentConnections) {
      conn.ws.close(WS_CLOSE_CODES.GOING_AWAY, "Server shutting down");
    }
    this.agentConnections.clear();

    // Close all TV connections
    for (const [, tvSet] of this.tvConnections) {
      for (const tv of tvSet) {
        tv.ws.close(WS_CLOSE_CODES.GOING_AWAY, "Server shutting down");
      }
    }
    this.tvConnections.clear();

    // Clean up ping timers
    for (const [, cleanup] of this.tvPingCleanups) {
      cleanup();
    }
    this.tvPingCleanups.clear();

    // Clear offline timers
    for (const [, timer] of this.offlineTimers) {
      clearTimeout(timer);
    }
    this.offlineTimers.clear();

    log.info("ConnectionManager: shutdown complete", { module: "manager" });
  }
}
