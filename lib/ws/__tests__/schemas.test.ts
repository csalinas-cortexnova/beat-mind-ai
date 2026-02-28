import { describe, it, expect } from "vitest";
import {
  AgentAuthSchema,
  AgentHRDataSchema,
  AgentWsHeartbeatSchema,
  InternalBroadcastSchema,
  InternalSessionEventSchema,
  WsDeviceDataSchema,
} from "../schemas";

const validUuid = "550e8400-e29b-41d4-a716-446655440000";

describe("WsDeviceDataSchema", () => {
  it("should accept valid device data", () => {
    const result = WsDeviceDataSchema.safeParse({ bpm: 120, deviceActive: true });
    expect(result.success).toBe(true);
  });

  it("should accept BPM=0 (sensor connected, no reading)", () => {
    const result = WsDeviceDataSchema.safeParse({ bpm: 0, deviceActive: true });
    expect(result.success).toBe(true);
  });

  it("should reject BPM > 250", () => {
    const result = WsDeviceDataSchema.safeParse({ bpm: 251, deviceActive: true });
    expect(result.success).toBe(false);
  });

  it("should reject negative BPM", () => {
    const result = WsDeviceDataSchema.safeParse({ bpm: -1, deviceActive: true });
    expect(result.success).toBe(false);
  });

  it("should reject non-integer BPM", () => {
    const result = WsDeviceDataSchema.safeParse({ bpm: 72.5, deviceActive: true });
    expect(result.success).toBe(false);
  });
});

describe("AgentAuthSchema", () => {
  it("should accept valid auth message", () => {
    const result = AgentAuthSchema.safeParse({
      type: "agent-auth",
      agentId: validUuid,
      secret: "my-secret-key",
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing agentId", () => {
    const result = AgentAuthSchema.safeParse({
      type: "agent-auth",
      secret: "my-secret",
    });
    expect(result.success).toBe(false);
  });

  it("should reject invalid UUID format", () => {
    const result = AgentAuthSchema.safeParse({
      type: "agent-auth",
      agentId: "not-a-uuid",
      secret: "my-secret",
    });
    expect(result.success).toBe(false);
  });

  it("should reject empty secret", () => {
    const result = AgentAuthSchema.safeParse({
      type: "agent-auth",
      agentId: validUuid,
      secret: "",
    });
    expect(result.success).toBe(false);
  });

  it("should reject wrong type literal", () => {
    const result = AgentAuthSchema.safeParse({
      type: "auth",
      agentId: validUuid,
      secret: "my-secret",
    });
    expect(result.success).toBe(false);
  });
});

describe("AgentHRDataSchema", () => {
  const validTimestamp = new Date().toISOString();

  it("should accept valid HR data with one device", () => {
    const result = AgentHRDataSchema.safeParse({
      type: "hr-data",
      devices: { "101": { bpm: 145, deviceActive: true } },
      timestamp: validTimestamp,
    });
    expect(result.success).toBe(true);
  });

  it("should accept BPM=0 (connected, no reading)", () => {
    const result = AgentHRDataSchema.safeParse({
      type: "hr-data",
      devices: { "101": { bpm: 0, deviceActive: false } },
      timestamp: validTimestamp,
    });
    expect(result.success).toBe(true);
  });

  it("should reject empty devices object", () => {
    const result = AgentHRDataSchema.safeParse({
      type: "hr-data",
      devices: {},
      timestamp: validTimestamp,
    });
    expect(result.success).toBe(false);
  });

  it("should reject > 50 devices", () => {
    const devices: Record<string, { bpm: number; deviceActive: boolean }> = {};
    for (let i = 0; i < 51; i++) {
      devices[String(i)] = { bpm: 80, deviceActive: true };
    }
    const result = AgentHRDataSchema.safeParse({
      type: "hr-data",
      devices,
      timestamp: validTimestamp,
    });
    expect(result.success).toBe(false);
  });

  it("should accept exactly 50 devices", () => {
    const devices: Record<string, { bpm: number; deviceActive: boolean }> = {};
    for (let i = 0; i < 50; i++) {
      devices[String(i)] = { bpm: 80, deviceActive: true };
    }
    const result = AgentHRDataSchema.safeParse({
      type: "hr-data",
      devices,
      timestamp: validTimestamp,
    });
    expect(result.success).toBe(true);
  });

  it("should reject invalid timestamp", () => {
    const result = AgentHRDataSchema.safeParse({
      type: "hr-data",
      devices: { "101": { bpm: 80, deviceActive: true } },
      timestamp: "not-a-timestamp",
    });
    expect(result.success).toBe(false);
  });

  it("should reject missing fields in device data", () => {
    const result = AgentHRDataSchema.safeParse({
      type: "hr-data",
      devices: { "101": { bpm: 80 } },
      timestamp: validTimestamp,
    });
    expect(result.success).toBe(false);
  });
});

describe("AgentWsHeartbeatSchema", () => {
  it("should accept valid heartbeat", () => {
    const result = AgentWsHeartbeatSchema.safeParse({ type: "heartbeat" });
    expect(result.success).toBe(true);
  });

  it("should reject wrong type", () => {
    const result = AgentWsHeartbeatSchema.safeParse({ type: "ping" });
    expect(result.success).toBe(false);
  });
});

describe("InternalBroadcastSchema", () => {
  it("should accept valid coach message broadcast", () => {
    const result = InternalBroadcastSchema.safeParse({
      gymId: validUuid,
      type: "coach-message",
      message: "Great effort! Keep pushing!",
    });
    expect(result.success).toBe(true);
  });

  it("should accept with optional athleteId and athleteName", () => {
    const result = InternalBroadcastSchema.safeParse({
      gymId: validUuid,
      type: "coach-message",
      message: "Personal message",
      athleteId: validUuid,
      athleteName: "Carlos",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.athleteId).toBe(validUuid);
      expect(result.data.athleteName).toBe("Carlos");
    }
  });

  it("should reject empty message", () => {
    const result = InternalBroadcastSchema.safeParse({
      gymId: validUuid,
      type: "coach-message",
      message: "",
    });
    expect(result.success).toBe(false);
  });

  it("should reject invalid gymId", () => {
    const result = InternalBroadcastSchema.safeParse({
      gymId: "not-uuid",
      type: "coach-message",
      message: "Hello",
    });
    expect(result.success).toBe(false);
  });
});

describe("InternalSessionEventSchema", () => {
  it("should accept valid session start event", () => {
    const result = InternalSessionEventSchema.safeParse({
      gymId: validUuid,
      event: "start",
      sessionId: validUuid,
      classType: "HIIT",
    });
    expect(result.success).toBe(true);
  });

  it("should accept session end without classType", () => {
    const result = InternalSessionEventSchema.safeParse({
      gymId: validUuid,
      event: "end",
      sessionId: validUuid,
    });
    expect(result.success).toBe(true);
  });

  it("should reject invalid event type", () => {
    const result = InternalSessionEventSchema.safeParse({
      gymId: validUuid,
      event: "pause",
      sessionId: validUuid,
    });
    expect(result.success).toBe(false);
  });

  it("should reject missing sessionId", () => {
    const result = InternalSessionEventSchema.safeParse({
      gymId: validUuid,
      event: "start",
    });
    expect(result.success).toBe(false);
  });
});
