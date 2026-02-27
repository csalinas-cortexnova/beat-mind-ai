import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { gyms } from "./gyms";

export const gymMembershipRoleEnum = ["owner", "trainer", "athlete"] as const;
export type GymMembershipRole = (typeof gymMembershipRoleEnum)[number];

export const gymMemberships = pgTable(
  "gym_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_gym_memberships_user_gym").on(table.userId, table.gymId),
    index("idx_gym_memberships_user")
      .on(table.userId)
      .where(sql`is_active = true`),
    index("idx_gym_memberships_gym")
      .on(table.gymId)
      .where(sql`is_active = true`),
  ]
);
