import {
  pgTable,
  uuid,
  integer,
  varchar,
  boolean,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { athletes } from "./athletes";
import { gyms } from "./gyms";

export const athleteBands = pgTable(
  "athlete_bands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    athleteId: uuid("athlete_id")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    sensorId: integer("sensor_id").notNull(),
    bandLabel: varchar("band_label", { length: 50 }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_athlete_bands_gym_sensor").on(table.gymId, table.sensorId),
    index("idx_athlete_bands_gym")
      .on(table.gymId, table.sensorId)
      .where(sql`is_active = true`),
  ]
);
