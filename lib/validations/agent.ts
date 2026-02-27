import { z } from "zod";
import { uuid } from "./common";

const DeviceReadingSchema = z.object({
  bpm: z.int().min(30).max(250),
  beatTime: z.number().min(0),
  beatCount: z.int().min(0),
  deviceActive: z.boolean(),
});

export const AgentHeartbeatSchema = z.object({
  agentId: uuid,
  gymId: uuid,
  devices: z
    .record(z.string(), DeviceReadingSchema)
    .refine((d) => Object.keys(d).length >= 1, {
      message: "At least one device is required",
    })
    .refine((d) => Object.keys(d).length <= 30, {
      message: "Maximum 30 devices allowed",
    }),
  timestamp: z
    .iso
    .datetime()
    .refine((val) => Date.now() - new Date(val).getTime() <= 30000, {
      message: "Timestamp must not be more than 30 seconds in the past",
    }),
});

export const AgentStatusSchema = z.object({
  agentId: uuid,
  gymId: uuid,
  status: z.enum(["online", "degraded", "error"]),
  softwareVersion: z.string().regex(/^\d+\.\d+\.\d+$/, {
    message: "Must be a valid semver version (e.g. 1.0.0)",
  }),
  uptime: z.int().min(0),
  connectedSensors: z.int().min(0).max(30),
  ipAddress: z.union([z.ipv4(), z.ipv6()]),
});

export type AgentHeartbeat = z.infer<typeof AgentHeartbeatSchema>;
export type AgentStatus = z.infer<typeof AgentStatusSchema>;
export type DeviceReading = z.infer<typeof DeviceReadingSchema>;
