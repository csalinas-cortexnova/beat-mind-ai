/**
 * Zod validation schemas for all WS inbound messages.
 * Used at parsing boundaries (message received from agent, internal HTTP).
 */

import { z } from "zod";

// ─── Device Data (sub-schema) ───────────────────────────────────────────────

export const WsDeviceDataSchema = z.object({
  bpm: z.int().min(0).max(250),
  deviceActive: z.boolean(),
});

// ─── Agent Inbound Messages ─────────────────────────────────────────────────

export const AgentAuthSchema = z.object({
  type: z.literal("agent-auth"),
  agentId: z.uuid(),
  secret: z.string().min(1),
});

export const AgentHRDataSchema = z.object({
  type: z.literal("hr-data"),
  devices: z
    .record(z.string(), WsDeviceDataSchema)
    .refine((d) => Object.keys(d).length >= 1, {
      message: "At least one device is required",
    })
    .refine((d) => Object.keys(d).length <= 50, {
      message: "Maximum 50 devices allowed",
    }),
  timestamp: z.iso.datetime(),
});

export const AgentWsHeartbeatSchema = z.object({
  type: z.literal("heartbeat"),
});

// ─── Internal HTTP Messages ─────────────────────────────────────────────────

export const InternalBroadcastSchema = z.object({
  gymId: z.uuid(),
  type: z.literal("coach-message"),
  message: z.string().min(1),
  athleteId: z.uuid().optional(),
  athleteName: z.string().optional(),
});

export const InternalSessionEventSchema = z.object({
  gymId: z.uuid(),
  event: z.enum(["start", "end"]),
  sessionId: z.uuid(),
  classType: z.string().optional(),
});

// ─── Inferred Types ─────────────────────────────────────────────────────────

export type AgentAuth = z.infer<typeof AgentAuthSchema>;
export type AgentHRData = z.infer<typeof AgentHRDataSchema>;
export type AgentWsHeartbeat = z.infer<typeof AgentWsHeartbeatSchema>;
export type InternalBroadcast = z.infer<typeof InternalBroadcastSchema>;
export type InternalSessionEvent = z.infer<typeof InternalSessionEventSchema>;
