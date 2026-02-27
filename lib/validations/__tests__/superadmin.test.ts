// @vitest-environment node
import { describe, it, expect } from "vitest";
import { ListGymsQuerySchema, ListAgentsQuerySchema } from "../superadmin";

describe("ListGymsQuerySchema", () => {
  it("should accept empty query (use defaults)", () => {
    const result = ListGymsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
      expect(result.data.status).toBeUndefined();
      expect(result.data.search).toBeUndefined();
    }
  });

  it("should accept valid pagination params", () => {
    const result = ListGymsQuerySchema.safeParse({ page: "2", limit: "10" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.limit).toBe(10);
    }
  });

  it("should accept valid status filter", () => {
    for (const status of ["active", "trial", "suspended", "cancelled"]) {
      const result = ListGymsQuerySchema.safeParse({ status });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe(status);
      }
    }
  });

  it("should reject invalid status", () => {
    const result = ListGymsQuerySchema.safeParse({ status: "invalid" });
    expect(result.success).toBe(false);
  });

  it("should accept valid search string", () => {
    const result = ListGymsQuerySchema.safeParse({ search: "test gym" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.search).toBe("test gym");
    }
  });

  it("should reject search longer than 100 chars", () => {
    const result = ListGymsQuerySchema.safeParse({ search: "a".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("should reject page < 1", () => {
    const result = ListGymsQuerySchema.safeParse({ page: "0" });
    expect(result.success).toBe(false);
  });

  it("should reject limit > 100", () => {
    const result = ListGymsQuerySchema.safeParse({ limit: "101" });
    expect(result.success).toBe(false);
  });
});

describe("ListAgentsQuerySchema", () => {
  it("should accept empty query with default limit=50", () => {
    const result = ListAgentsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(50);
      expect(result.data.status).toBeUndefined();
      expect(result.data.gymId).toBeUndefined();
    }
  });

  it("should accept valid status filter", () => {
    for (const status of ["online", "offline", "maintenance"]) {
      const result = ListAgentsQuerySchema.safeParse({ status });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe(status);
      }
    }
  });

  it("should reject invalid status", () => {
    const result = ListAgentsQuerySchema.safeParse({ status: "invalid" });
    expect(result.success).toBe(false);
  });

  it("should accept valid gymId (UUID)", () => {
    const result = ListAgentsQuerySchema.safeParse({
      gymId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.gymId).toBe("550e8400-e29b-41d4-a716-446655440000");
    }
  });

  it("should reject invalid gymId (not UUID)", () => {
    const result = ListAgentsQuerySchema.safeParse({ gymId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("should accept valid pagination params", () => {
    const result = ListAgentsQuerySchema.safeParse({ page: "3", limit: "25" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.limit).toBe(25);
    }
  });
});
