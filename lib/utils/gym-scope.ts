import { eq, and, SQL } from "drizzle-orm";
import { PgColumn } from "drizzle-orm/pg-core";

/**
 * Creates a tenant isolation filter for gym-scoped queries.
 * Every query touching tenant-scoped data MUST include this filter.
 *
 * @example
 * db.select().from(athletes).where(withGymScope(athletes.gymId, gymId))
 * db.select().from(athletes).where(and(withGymScope(athletes.gymId, gymId), eq(athletes.isActive, true)))
 */
export function withGymScope(column: PgColumn, gymId: string): SQL {
  return eq(column, gymId);
}

/**
 * Composes a gym scope filter with additional conditions.
 *
 * @example
 * db.select().from(athletes).where(withGymScopeAnd(athletes.gymId, gymId, eq(athletes.isActive, true)))
 */
export function withGymScopeAnd(
  column: PgColumn,
  gymId: string,
  ...conditions: SQL[]
): SQL {
  return and(eq(column, gymId), ...conditions)!;
}
