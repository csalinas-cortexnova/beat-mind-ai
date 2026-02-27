import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const subscriptionStatusEnum = [
  "active",
  "trial",
  "suspended",
  "cancelled",
] as const;
export type SubscriptionStatus = (typeof subscriptionStatusEnum)[number];

export const gyms = pgTable("gyms", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  address: text("address"),
  phone: varchar("phone", { length: 50 }),
  timezone: varchar("timezone", { length: 50 })
    .notNull()
    .default("America/Sao_Paulo"),
  language: varchar("language", { length: 10 }).notNull().default("pt-BR"),
  clerkOrgId: varchar("clerk_org_id", { length: 255 }).notNull().unique(),
  tvAccessToken: uuid("tv_access_token")
    .notNull()
    .default(sql`gen_random_uuid()`),
  subscriptionStatus: varchar("subscription_status", { length: 20 })
    .notNull()
    .default("active"),
  subscriptionPlan: varchar("subscription_plan", { length: 100 }),
  maxAthletes: integer("max_athletes").notNull().default(20),
  logoUrl: text("logo_url"),
  primaryColor: varchar("primary_color", { length: 7 }).default("#000000"),
  secondaryColor: varchar("secondary_color", { length: 7 }).default("#FFFFFF"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
