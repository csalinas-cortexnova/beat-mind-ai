import {
  pgTable,
  uuid,
  varchar,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { gyms } from "./gyms";
import { users } from "./users";

export const sessionStatusEnum = [
  "active",
  "completed",
  "cancelled",
] as const;
export type SessionStatus = (typeof sessionStatusEnum)[number];

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    trainerId: uuid("trainer_id").references(() => users.id, {
      onDelete: "set null",
    }),
    classType: varchar("class_type", { length: 100 }),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationSeconds: integer("duration_seconds"),
    athleteCount: integer("athlete_count").notNull().default(0),
    aiSummary: text("ai_summary"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_sessions_gym").on(table.gymId, table.startedAt),
    index("idx_sessions_active")
      .on(table.gymId, table.status)
      .where(sql`status = 'active'`),
  ]
);
