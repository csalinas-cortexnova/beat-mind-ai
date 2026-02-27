import {
  pgTable,
  uuid,
  text,
  varchar,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { sessions } from "./sessions";
import { gyms } from "./gyms";

export const aiCoachingMessages = pgTable(
  "ai_coaching_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    message: text("message").notNull(),
    model: varchar("model", { length: 100 }).notNull(),
    athleteSummaries: jsonb("athlete_summaries"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_ai_coaching_messages_session").on(
      table.sessionId,
      table.createdAt
    ),
  ]
);
