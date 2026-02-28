import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit CLI runs outside Next.js, so .env.local isn't auto-loaded
dotenv.config({ path: ".env.local" });

// Prefer MIGRATION_DATABASE_URL (full privileges) over DATABASE_URL (app-level)
const databaseUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "Neither MIGRATION_DATABASE_URL nor DATABASE_URL is set in environment variables"
  );
}

export default defineConfig({
  schema: "./lib/db/schema/index.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
