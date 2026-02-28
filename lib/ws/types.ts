/**
 * WebSocket server types for BeatMind AI.
 * Used across all WS modules (manager, handlers, batch writer, gym state).
 */

import type { WebSocket } from "ws";

// ─── WS Close Codes ─────────────────────────────────────────────────────────

export const WS_CLOSE_CODES = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  UNKNOWN_ENDPOINT: 4000,
  AUTH_FAILED: 4001,
  AUTH_TIMEOUT: 4002,
  REPLACED: 4003,
} as const;

export type WsCloseCode = (typeof WS_CLOSE_CODES)[keyof typeof WS_CLOSE_CODES];

// ─── Agent Inbound Messages ─────────────────────────────────────────────────

export interface AgentAuthMessage {
  type: "agent-auth";
  agentId: string;
  secret: string;
}

export interface AgentHRDataMessage {
  type: "hr-data";
  devices: Record<string, { bpm: number; deviceActive: boolean }>;
  timestamp: string;
}

export interface AgentHeartbeatMessage {
  type: "heartbeat";
}

export type AgentInboundMessage =
  | AgentAuthMessage
  | AgentHRDataMessage
  | AgentHeartbeatMessage;

// ─── TV Outbound Messages ───────────────────────────────────────────────────

export interface TvInitMessage {
  type: "init";
  gym: {
    id: string;
    name: string;
    logoUrl: string | null;
    primaryColor: string;
    secondaryColor: string;
  };
  athletes: EnrichedDeviceData[];
  session: { id: string; classType: string | null; startedAt: string } | null;
}

export interface TvHRUpdateMessage {
  type: "hr-update";
  athletes: EnrichedDeviceData[];
  timestamp: string;
}

export interface TvSessionStartMessage {
  type: "session-start";
  sessionId: string;
  classType: string | null;
  startedAt: string;
}

export interface TvSessionEndMessage {
  type: "session-end";
  sessionId: string;
  durationSeconds: number;
}

export interface TvCoachMessage {
  type: "coach-message";
  message: string;
  athleteId?: string;
  athleteName?: string;
}

export type TvOutboundMessage =
  | TvInitMessage
  | TvHRUpdateMessage
  | TvSessionStartMessage
  | TvSessionEndMessage
  | TvCoachMessage;

// ─── Connection Types ───────────────────────────────────────────────────────

export interface AgentConnection {
  ws: WebSocket;
  agentId: string;
  gymId: string;
  connectedAt: number;
  lastMessage: number;
  messageCount: number;
}

export interface TvConnection {
  ws: WebSocket;
  gymId: string;
  connectedAt: number;
  lastPong: number;
}

// ─── Gym State Types ────────────────────────────────────────────────────────

export interface GymConfig {
  name: string;
  language: string;
  timezone: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  subscriptionStatus: string;
}

export interface AthleteProfile {
  id: string;
  name: string;
  maxHr: number;
  age: number | null;
}

export interface ActiveSession {
  id: string;
  classType: string | null;
  startedAt: string;
}

export interface GymState {
  gymId: string;
  config: GymConfig;
  sensorAthleteMap: Map<number, AthleteProfile>;
  activeSession: ActiveSession | null;
  lastActivity: number;
  lastRefresh: number;
  deviceLastSeen: Map<number, number>;
}

// ─── Data Enrichment Types ──────────────────────────────────────────────────

export interface EnrichedDeviceData {
  sensorId: number;
  athleteId: string | null;
  athleteName: string | null;
  bpm: number;
  zone: number;
  zoneName: string;
  zoneColor: string;
  hrMaxPercent: number;
  deviceActive: boolean;
}

export interface HRReadingInsert {
  sessionId: string;
  gymId: string;
  athleteId: string;
  sensorId: number;
  heartRateBpm: number;
  hrZone: number;
  hrZoneName: string;
  hrZoneColor: string;
  hrMaxPercent: string;
  beatTime: Date;
  beatCount: number;
  deviceActive: boolean;
}

export interface ProcessHRDataResult {
  enriched: EnrichedDeviceData[];
  readings: HRReadingInsert[];
}

// ─── Metrics ────────────────────────────────────────────────────────────────

export interface WsMetrics {
  uptime: number;
  agentConnections: number;
  tvConnections: number;
  activeGyms: number;
  batchWriterBuffered: number;
}

// ─── Config Type ────────────────────────────────────────────────────────────

export interface WsConfig {
  WS_PORT: number;
  WS_INTERNAL_SECRET: string;
  WS_PING_INTERVAL: number;
  WS_PONG_TIMEOUT: number;
  WS_AUTH_TIMEOUT: number;
  WS_BATCH_FLUSH_INTERVAL: number;
  WS_BATCH_MAX_BUFFER: number;
}
