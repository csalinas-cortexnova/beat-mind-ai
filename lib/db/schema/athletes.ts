import {
  pgTable,
  uuid,
  varchar,
  integer,
  decimal,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { gyms } from "./gyms";

export const athletes = pgTable(
  "athletes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }),
    phone: varchar("phone", { length: 50 }),
    age: integer("age"),
    gender: varchar("gender", { length: 10 }),
    weightKg: decimal("weight_kg", { precision: 5, scale: 2 }),
    maxHr: integer("max_hr").notNull().default(190),
    whatsappOptIn: boolean("whatsapp_opt_in").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_athletes_gym")
      .on(table.gymId)
      .where(sql`is_active = true`),
  ]
);
