import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit CLI runs outside Next.js, so .env.local isn't auto-loaded
dotenv.config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set in environment variables");
}

export default defineConfig({
  schema: "./lib/db/schema/index.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
