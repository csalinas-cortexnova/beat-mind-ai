# Drizzle ORM Skill

Reference patterns for working with Drizzle ORM in the BeatMind AI codebase.

## Schema Patterns

### Table Definition
```typescript
import { pgTable, uuid, varchar, boolean, timestamp } from "drizzle-orm/pg-core";

export const tableName = pgTable("table_name", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

### Enum Strategy (NO pgEnum — use varchar + as const)
```typescript
export const statusEnum = ["active", "suspended", "cancelled"] as const;
export type Status = (typeof statusEnum)[number];

// Use in column:
status: varchar("status", { length: 20 }).notNull().default("active"),
```
**Why:** `pgEnum` requires `ALTER TYPE ... ADD VALUE` for changes, which can't run inside transactions. `varchar` + `as const` is simpler to migrate.

### Foreign Keys
```typescript
import { users } from "./users";
import { gyms } from "./gyms";

// CASCADE: child deleted when parent deleted
gymId: uuid("gym_id").notNull().references(() => gyms.id, { onDelete: "cascade" }),

// SET NULL: child preserved, FK nulled out (column must be nullable)
userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
```

### Indexes and Constraints
```typescript
import { unique, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const myTable = pgTable("my_table", { ... }, (table) => [
  // Unique constraint
  unique("uq_my_table_col1_col2").on(table.col1, table.col2),

  // Regular index
  index("idx_my_table_col1").on(table.col1, table.col2),

  // Partial index (with WHERE clause)
  index("idx_my_table_active").on(table.col1).where(sql`is_active = true`),
]);
```

### BIGSERIAL (for high-volume tables)
```typescript
import { bigserial } from "drizzle-orm/pg-core";

id: bigserial("id", { mode: "number" }).primaryKey(),
// mode: "number" is safe up to 2^53 rows, avoids BigInt verbosity
```

### JSONB Columns
```typescript
import { jsonb } from "drizzle-orm/pg-core";

config: jsonb("config").default({}),
```

## Database Client

```typescript
// lib/db/index.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const db = drizzle(pool, { schema });
```

## Multi-Tenancy

All tenant-scoped queries MUST use `withGymScope`:

```typescript
import { withGymScope, withGymScopeAnd } from "@/lib/utils/gym-scope";
import { athletes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// Basic scope
db.select().from(athletes).where(withGymScope(athletes.gymId, gymId));

// Scope + additional filter
db.select().from(athletes).where(
  withGymScopeAnd(athletes.gymId, gymId, eq(athletes.isActive, true))
);
```

## Migration Commands

```bash
bun drizzle-kit generate   # Generate migration SQL from schema changes
bun drizzle-kit migrate    # Run pending migrations against the database
bun drizzle-kit push       # Push schema directly (dev only, no migration files)
bun drizzle-kit studio     # Open Drizzle Studio (visual DB browser)
```

## Configuration

```typescript
// drizzle.config.ts
import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({ path: ".env.local" });

export default defineConfig({
  schema: "./lib/db/schema/index.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

## Testing (No DB Connection Needed)

```typescript
// Use drizzle.mock() for SQL inspection tests
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../schema";

const mockDb = drizzle.mock({ schema });

const query = mockDb.select().from(table).where(condition).toSQL();
expect(query.sql).toContain('"table"."column"');
expect(query.params).toContain(value);
```
