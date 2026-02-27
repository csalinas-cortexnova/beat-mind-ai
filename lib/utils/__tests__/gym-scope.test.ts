// @vitest-environment node
import { describe, it, expect } from "vitest";
import { eq, and } from "drizzle-orm";
import { withGymScope, withGymScopeAnd } from "../gym-scope";
import { athletes } from "../../db/schema/athletes";
import { sessions } from "../../db/schema/sessions";

describe("withGymScope", () => {
  const testGymId = "550e8400-e29b-41d4-a716-446655440000";

  it("should return a valid SQL expression", () => {
    const result = withGymScope(athletes.gymId, testGymId);
    expect(result).toBeDefined();
  });

  it("should produce the same result as eq()", () => {
    const scopeResult = withGymScope(athletes.gymId, testGymId);
    const eqResult = eq(athletes.gymId, testGymId);

    // Both should produce equivalent SQL chunks
    expect(scopeResult.queryChunks).toEqual(eqResult.queryChunks);
  });

  it("should work with different tables", () => {
    const athleteScope = withGymScope(athletes.gymId, testGymId);
    const sessionScope = withGymScope(sessions.gymId, testGymId);

    expect(athleteScope).toBeDefined();
    expect(sessionScope).toBeDefined();
    // They should reference different tables
    expect(athleteScope.queryChunks).not.toEqual(sessionScope.queryChunks);
  });
});

describe("withGymScopeAnd", () => {
  const testGymId = "550e8400-e29b-41d4-a716-446655440000";

  it("should compose gym scope with additional conditions", () => {
    const result = withGymScopeAnd(
      athletes.gymId,
      testGymId,
      eq(athletes.isActive, true)
    );
    expect(result).toBeDefined();
  });

  it("should produce same result as manual and() composition", () => {
    const scopeResult = withGymScopeAnd(
      athletes.gymId,
      testGymId,
      eq(athletes.isActive, true)
    );
    const manualResult = and(
      eq(athletes.gymId, testGymId),
      eq(athletes.isActive, true)
    )!;

    expect(scopeResult.queryChunks).toEqual(manualResult.queryChunks);
  });

  it("should compose with multiple conditions", () => {
    const result = withGymScopeAnd(
      athletes.gymId,
      testGymId,
      eq(athletes.isActive, true),
      eq(athletes.name, "Test")
    );
    expect(result).toBeDefined();
  });
});
