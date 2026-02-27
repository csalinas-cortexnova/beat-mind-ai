// @vitest-environment node
import { describe, it, expect } from "vitest";
import { AgentHeartbeatSchema, AgentStatusSchema } from "../agent";

const validUuid = "550e8400-e29b-41d4-a716-446655440000";

describe("AgentHeartbeatSchema", () => {
  const validHeartbeat = {
    agentId: validUuid,
    gymId: validUuid,
    devices: {
      "12345": {
        bpm: 120,
        beatTime: 1.5,
        beatCount: 100,
        deviceActive: true,
      },
    },
    timestamp: new Date().toISOString(),
  };

  it("should accept a valid heartbeat", () => {
    const result = AgentHeartbeatSchema.safeParse(validHeartbeat);
    expect(result.success).toBe(true);
  });

  it("should accept heartbeat with multiple devices", () => {
    const result = AgentHeartbeatSchema.safeParse({
      ...validHeartbeat,
      devices: {
        "1": { bpm: 80, beatTime: 0, beatCount: 0, deviceActive: true },
        "2": { bpm: 150, beatTime: 1.0, beatCount: 50, deviceActive: false },
      },
    });
    expect(result.success).toBe(true);
  });

  it("should reject empty devices object", () => {
    const result = AgentHeartbeatSchema.safeParse({
      ...validHeartbeat,
      devices: {},
    });
    expect(result.success).toBe(false);
  });

  it("should reject bpm below 30", () => {
    const result = AgentHeartbeatSchema.safeParse({
      ...validHeartbeat,
      devices: {
        "1": { bpm: 29, beatTime: 0, beatCount: 0, deviceActive: true },
      },
    });
    expect(result.success).toBe(false);
  });

  it("should reject bpm above 250", () => {
    const result = AgentHeartbeatSchema.safeParse({
      ...validHeartbeat,
      devices: {
        "1": { bpm: 251, beatTime: 0, beatCount: 0, deviceActive: true },
      },
    });
    expect(result.success).toBe(false);
  });

  it("should reject negative beatTime", () => {
    const result = AgentHeartbeatSchema.safeParse({
      ...validHeartbeat,
      devices: {
        "1": { bpm: 100, beatTime: -1, beatCount: 0, deviceActive: true },
      },
    });
    expect(result.success).toBe(false);
  });

  it("should reject negative beatCount", () => {
    const result = AgentHeartbeatSchema.safeParse({
      ...validHeartbeat,
      devices: {
        "1": { bpm: 100, beatTime: 0, beatCount: -1, deviceActive: true },
      },
    });
    expect(result.success).toBe(false);
  });

  it("should reject non-boolean deviceActive", () => {
    const result = AgentHeartbeatSchema.safeParse({
      ...validHeartbeat,
      devices: {
        "1": { bpm: 100, beatTime: 0, beatCount: 0, deviceActive: "yes" },
      },
    });
    expect(result.success).toBe(false);
  });

  it("should reject invalid agentId", () => {
    const result = AgentHeartbeatSchema.safeParse({
      ...validHeartbeat,
      agentId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("should reject timestamp older than 30 seconds", () => {
    const oldTimestamp = new Date(Date.now() - 60000).toISOString();
    const result = AgentHeartbeatSchema.safeParse({
      ...validHeartbeat,
      timestamp: oldTimestamp,
    });
    expect(result.success).toBe(false);
  });

  it("should accept timestamp within 30 seconds", () => {
    const recentTimestamp = new Date(Date.now() - 10000).toISOString();
    const result = AgentHeartbeatSchema.safeParse({
      ...validHeartbeat,
      timestamp: recentTimestamp,
    });
    expect(result.success).toBe(true);
  });

  it("should reject invalid ISO timestamp", () => {
    const result = AgentHeartbeatSchema.safeParse({
      ...validHeartbeat,
      timestamp: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("should accept boundary bpm values (30 and 250)", () => {
    const result30 = AgentHeartbeatSchema.safeParse({
      ...validHeartbeat,
      devices: {
        "1": { bpm: 30, beatTime: 0, beatCount: 0, deviceActive: true },
      },
    });
    expect(result30.success).toBe(true);

    const result250 = AgentHeartbeatSchema.safeParse({
      ...validHeartbeat,
      devices: {
        "1": { bpm: 250, beatTime: 0, beatCount: 0, deviceActive: true },
      },
    });
    expect(result250.success).toBe(true);
  });

  it("should reject float bpm", () => {
    const result = AgentHeartbeatSchema.safeParse({
      ...validHeartbeat,
      devices: {
        "1": { bpm: 100.5, beatTime: 0, beatCount: 0, deviceActive: true },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("AgentStatusSchema", () => {
  const validStatus = {
    agentId: validUuid,
    gymId: validUuid,
    status: "online" as const,
    softwareVersion: "1.0.0",
    uptime: 3600,
    connectedSensors: 5,
    ipAddress: "192.168.1.1",
  };

  it("should accept a valid status", () => {
    const result = AgentStatusSchema.safeParse(validStatus);
    expect(result.success).toBe(true);
  });

  it("should accept all valid status values", () => {
    for (const status of ["online", "degraded", "error"] as const) {
      const result = AgentStatusSchema.safeParse({ ...validStatus, status });
      expect(result.success).toBe(true);
    }
  });

  it("should reject invalid status value", () => {
    const result = AgentStatusSchema.safeParse({
      ...validStatus,
      status: "offline",
    });
    expect(result.success).toBe(false);
  });

  it("should accept valid semver versions", () => {
    for (const version of ["0.0.1", "1.0.0", "10.20.30"]) {
      const result = AgentStatusSchema.safeParse({
        ...validStatus,
        softwareVersion: version,
      });
      expect(result.success).toBe(true);
    }
  });

  it("should reject invalid semver versions", () => {
    for (const version of ["1.0", "v1.0.0", "1.0.0-beta", "abc"]) {
      const result = AgentStatusSchema.safeParse({
        ...validStatus,
        softwareVersion: version,
      });
      expect(result.success).toBe(false);
    }
  });

  it("should reject negative uptime", () => {
    const result = AgentStatusSchema.safeParse({
      ...validStatus,
      uptime: -1,
    });
    expect(result.success).toBe(false);
  });

  it("should accept zero uptime", () => {
    const result = AgentStatusSchema.safeParse({
      ...validStatus,
      uptime: 0,
    });
    expect(result.success).toBe(true);
  });

  it("should reject connectedSensors above 30", () => {
    const result = AgentStatusSchema.safeParse({
      ...validStatus,
      connectedSensors: 31,
    });
    expect(result.success).toBe(false);
  });

  it("should accept boundary connectedSensors (0 and 30)", () => {
    const result0 = AgentStatusSchema.safeParse({
      ...validStatus,
      connectedSensors: 0,
    });
    expect(result0.success).toBe(true);

    const result30 = AgentStatusSchema.safeParse({
      ...validStatus,
      connectedSensors: 30,
    });
    expect(result30.success).toBe(true);
  });

  it("should accept IPv4 address", () => {
    const result = AgentStatusSchema.safeParse({
      ...validStatus,
      ipAddress: "10.0.0.1",
    });
    expect(result.success).toBe(true);
  });

  it("should accept IPv6 address", () => {
    const result = AgentStatusSchema.safeParse({
      ...validStatus,
      ipAddress: "::1",
    });
    expect(result.success).toBe(true);
  });

  it("should reject invalid IP address", () => {
    const result = AgentStatusSchema.safeParse({
      ...validStatus,
      ipAddress: "not-an-ip",
    });
    expect(result.success).toBe(false);
  });

  it("should reject float uptime", () => {
    const result = AgentStatusSchema.safeParse({
      ...validStatus,
      uptime: 100.5,
    });
    expect(result.success).toBe(false);
  });
});
