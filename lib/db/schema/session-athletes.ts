import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { sessions } from "./sessions";
import { athletes } from "./athletes";

export const sessionAthletes = pgTable(
  "session_athletes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    athleteId: uuid("athlete_id")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    sensorId: integer("sensor_id"),
    avgHr: integer("avg_hr"),
    maxHr: integer("max_hr"),
    minHr: integer("min_hr"),
    calories: integer("calories"),
    timeZone1S: integer("time_zone_1_s").notNull().default(0),
    timeZone2S: integer("time_zone_2_s").notNull().default(0),
    timeZone3S: integer("time_zone_3_s").notNull().default(0),
    timeZone4S: integer("time_zone_4_s").notNull().default(0),
    timeZone5S: integer("time_zone_5_s").notNull().default(0),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    leftAt: timestamp("left_at", { withTimezone: true }),
    reportToken: varchar("report_token", { length: 255 }),
    whatsappSentAt: timestamp("whatsapp_sent_at", { withTimezone: true }),
    whatsappStatus: varchar("whatsapp_status", { length: 20 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_session_athletes_session_athlete").on(
      table.sessionId,
      table.athleteId
    ),
    index("idx_session_athletes_session").on(table.sessionId),
    index("idx_session_athletes_athlete").on(table.athleteId),
  ]
);
