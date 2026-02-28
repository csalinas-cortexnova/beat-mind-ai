/**
 * HTTP request handler for WS server.
 * Handles: /health, /internal/broadcast, /internal/session-event, 404.
 */

import type { IncomingMessage, ServerResponse } from "http";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { InternalBroadcastSchema, InternalSessionEventSchema } from "./schemas";
import { log } from "@/lib/logger";
import type { ConnectionManager } from "./manager";
import type { GymStateManager } from "./gym-state";
import type { BatchWriter } from "./batch-writer";
import type { TvCoachMessage, TvSessionStartMessage, TvSessionEndMessage } from "./types";

export interface HttpHandlerDeps {
  manager: ConnectionManager;
  gymState: GymStateManager;
  batchWriter: BatchWriter;
  internalSecret: string;
  startTime: number;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function validateInternalSecret(
  req: IncomingMessage,
  secret: string
): boolean {
  return req.headers["x-internal-secret"] === secret;
}

export function createHttpHandler(deps: HttpHandlerDeps) {
  return async function handleHttpRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const url = req.url || "";
    const method = req.method || "";

    try {
      if (method === "GET" && url === "/health") {
        await handleHealth(res, deps);
      } else if (method === "POST" && url === "/internal/broadcast") {
        await handleBroadcast(req, res, deps);
      } else if (method === "POST" && url === "/internal/session-event") {
        await handleSessionEvent(req, res, deps);
      } else {
        res.writeHead(404);
        res.end();
      }
    } catch (err) {
      log.error("HTTP handler error", {
        module: "http-handler",
        url,
        error: err instanceof Error ? err.message : String(err),
      });
      res.writeHead(500);
      res.end();
    }
  };
}

async function handleHealth(
  res: ServerResponse,
  deps: HttpHandlerDeps
): Promise<void> {
  let dbLatency = -1;
  try {
    const start = Date.now();
    await db.execute(sql`SELECT 1`);
    dbLatency = Date.now() - start;
  } catch {
    dbLatency = -1;
  }

  const metrics = deps.manager.getMetrics();

  jsonResponse(res, 200, {
    status: "ok",
    uptime: Math.round((Date.now() - deps.startTime) / 1000),
    connections: {
      agents: metrics.agentConnections,
      tvs: metrics.tvConnections,
    },
    activeGyms: metrics.activeGyms,
    batchWriter: {
      buffered: deps.batchWriter.getBufferedCount(),
    },
    dbLatency,
  });
}

async function handleBroadcast(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HttpHandlerDeps
): Promise<void> {
  if (!validateInternalSecret(req, deps.internalSecret)) {
    jsonResponse(res, 403, { error: "Forbidden" });
    return;
  }

  const body = await readBody(req);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    jsonResponse(res, 400, { error: "Invalid JSON" });
    return;
  }

  const result = InternalBroadcastSchema.safeParse(parsed);
  if (!result.success) {
    jsonResponse(res, 400, { error: "Invalid broadcast payload" });
    return;
  }

  const msg: TvCoachMessage = {
    type: "coach-message",
    message: result.data.message,
    athleteId: result.data.athleteId,
    athleteName: result.data.athleteName,
  };

  deps.manager.broadcastToGym(result.data.gymId, msg);

  log.info("Internal broadcast sent", {
    module: "http-handler",
    gymId: result.data.gymId,
  });

  jsonResponse(res, 200, { ok: true });
}

async function handleSessionEvent(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HttpHandlerDeps
): Promise<void> {
  if (!validateInternalSecret(req, deps.internalSecret)) {
    jsonResponse(res, 403, { error: "Forbidden" });
    return;
  }

  const body = await readBody(req);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    jsonResponse(res, 400, { error: "Invalid JSON" });
    return;
  }

  const result = InternalSessionEventSchema.safeParse(parsed);
  if (!result.success) {
    jsonResponse(res, 400, { error: "Invalid session event payload" });
    return;
  }

  const { gymId, event, sessionId, classType } = result.data;

  if (event === "start") {
    deps.gymState.setActiveSession(gymId, {
      id: sessionId,
      classType: classType ?? null,
      startedAt: new Date().toISOString(),
    });

    const msg: TvSessionStartMessage = {
      type: "session-start",
      sessionId,
      classType: classType ?? null,
      startedAt: new Date().toISOString(),
    };
    deps.manager.broadcastToGym(gymId, msg);
  } else {
    deps.gymState.clearActiveSession(gymId);

    const msg: TvSessionEndMessage = {
      type: "session-end",
      sessionId,
      durationSeconds: 0, // actual duration calculated elsewhere
    };
    deps.manager.broadcastToGym(gymId, msg);
  }

  log.info("Internal session event processed", {
    module: "http-handler",
    gymId,
    event,
    sessionId,
  });

  jsonResponse(res, 200, { ok: true });
}
