/**
 * BeatMind AI WebSocket Server — Entry Point
 *
 * Standalone process running alongside Next.js, managed by PM2.
 * Handles real-time HR streaming from gym agents to TV displays.
 *
 * Usage: bun run ws-server.ts
 */

import http from "http";
import { WebSocketServer } from "ws";
import { loadWsConfig, validateWsConfig } from "@/lib/ws/config";
import { BatchWriter } from "@/lib/ws/batch-writer";
import { GymStateManager } from "@/lib/ws/gym-state";
import { AutoSessionManager } from "@/lib/ws/auto-session";
import { ConnectionManager } from "@/lib/ws/manager";
import { createHttpHandler } from "@/lib/ws/http-handler";
import { log } from "@/lib/logger";
import {
  startCoachingTimer,
  stopCoachingTimer,
  generatePostSessionSummary,
  getCoachingConfig,
  stopAllTimers,
} from "@/lib/ai/coach";
import { db } from "@/lib/db";
import { gyms } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// ─── Configuration ───────────────────────────────────────────────────────────

const config = loadWsConfig();
validateWsConfig(config);

// ─── Initialize Modules ──────────────────────────────────────────────────────

const batchWriter = new BatchWriter(
  config.WS_BATCH_FLUSH_INTERVAL,
  config.WS_BATCH_MAX_BUFFER
);
const gymState = new GymStateManager();
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

// ConnectionManager and AutoSession need each other's broadcastToGym,
// so we wire them after creation.
const autoSession = new AutoSessionManager(
  gymState,
  (gymId, msg) => connectionManager.broadcastToGym(gymId, msg),
  {
    onSessionStart: async (sessionId, gymId) => {
      try {
        const gym = await db.query.gyms.findFirst({
          where: eq(gyms.id, gymId),
          columns: { language: true },
        });
        if (!gym) return;
        const config = getCoachingConfig(gym);
        startCoachingTimer(sessionId, gymId, config, (gId, msg) =>
          connectionManager.broadcastToGym(gId, msg)
        );
      } catch (err) {
        log.error("Failed to start coaching timer", {
          module: "ws-server",
          sessionId,
          gymId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    onSessionEnd: async (sessionId, gymId) => {
      stopCoachingTimer(sessionId);
      await generatePostSessionSummary(sessionId, gymId);
    },
  }
);
const connectionManager = new ConnectionManager(
  wss,
  gymState,
  batchWriter,
  autoSession,
  config
);

// ─── HTTP Server ─────────────────────────────────────────────────────────────

const startTime = Date.now();

const handleHttp = createHttpHandler({
  manager: connectionManager,
  gymState,
  batchWriter,
  internalSecret: config.WS_INTERNAL_SECRET,
  startTime,
});

const server = http.createServer(handleHttp);

server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────

batchWriter.start();
gymState.start();
autoSession.start();
connectionManager.start();

server.listen(config.WS_PORT, () => {
  log.info(`WS server listening on port ${config.WS_PORT}`, {
    module: "ws-server",
    port: config.WS_PORT,
  });
});

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log.info(`Shutting down (${signal})...`, { module: "ws-server", signal });

  // 1. Stop accepting new connections
  server.close();

  // 2. Stop coaching timers (before flushing, so no new AI calls)
  stopAllTimers();

  // 3. Flush batch writer (final DB writes)
  await batchWriter.shutdown();

  // 4. Close all WS connections
  await connectionManager.shutdown();

  // 5. Stop timers
  gymState.shutdown();
  autoSession.shutdown();

  log.info("Shutdown complete", { module: "ws-server" });
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
