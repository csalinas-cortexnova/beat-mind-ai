import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { gyms } from "./gyms";

export const agentStatusEnum = ["online", "offline", "maintenance"] as const;
export type AgentStatus = (typeof agentStatusEnum)[number];

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    agentSecret: varchar("agent_secret", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    hardwareModel: varchar("hardware_model", { length: 100 }),
    serialNumber: varchar("serial_number", { length: 100 }),
    status: varchar("status", { length: 20 }).notNull().default("offline"),
    lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true }),
    ipAddress: varchar("ip_address", { length: 45 }),
    softwareVersion: varchar("software_version", { length: 50 }),
    config: jsonb("config").default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_agents_gym").on(table.gymId)]
);
