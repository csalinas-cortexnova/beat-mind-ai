import {
  pgTable,
  uuid,
  integer,
  varchar,
  text,
  date,
  timestamp,
} from "drizzle-orm/pg-core";
import { gyms } from "./gyms";

export const hrBandStatusEnum = ["active", "damaged", "lost"] as const;
export type HrBandStatus = (typeof hrBandStatusEnum)[number];

export const hrBands = pgTable("hr_bands", {
  id: uuid("id").primaryKey().defaultRandom(),
  gymId: uuid("gym_id")
    .notNull()
    .references(() => gyms.id, { onDelete: "cascade" }),
  sensorId: integer("sensor_id").notNull(),
  bandLabel: varchar("band_label", { length: 50 }),
  brand: varchar("brand", { length: 100 }),
  model: varchar("model", { length: 100 }),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  purchasedAt: date("purchased_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
