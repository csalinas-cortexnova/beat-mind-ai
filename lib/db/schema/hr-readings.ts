import {
  pgTable,
  bigserial,
  uuid,
  integer,
  varchar,
  decimal,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { sessions } from "./sessions";
import { gyms } from "./gyms";
import { athletes } from "./athletes";

export const hrReadings = pgTable(
  "hr_readings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    athleteId: uuid("athlete_id")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    sensorId: integer("sensor_id").notNull(),
    heartRateBpm: integer("heart_rate_bpm").notNull(),
    hrZone: integer("hr_zone").notNull(),
    hrZoneName: varchar("hr_zone_name", { length: 20 }).notNull(),
    hrZoneColor: varchar("hr_zone_color", { length: 7 }).notNull(),
    hrMaxPercent: decimal("hr_max_percent", { precision: 5, scale: 2 }).notNull(),
    beatTime: timestamp("beat_time", { withTimezone: true }).notNull(),
    beatCount: integer("beat_count").notNull().default(0),
    deviceActive: boolean("device_active").notNull().default(true),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_hr_readings_session_time").on(table.sessionId, table.recordedAt),
    index("idx_hr_readings_gym_time").on(table.gymId, table.recordedAt),
    index("idx_hr_readings_athlete").on(table.athleteId, table.recordedAt),
  ]
);
