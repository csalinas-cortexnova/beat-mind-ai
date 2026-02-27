// @vitest-environment node
import { describe, it, expect } from "vitest";
import { PaginationSchema, paginationMeta, paginationOffsetLimit } from "../pagination";

describe("PaginationSchema", () => {
  it("should apply defaults when no values provided", () => {
    const result = PaginationSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ page: 1, limit: 20 });
    }
  });

  it("should coerce string values to numbers", () => {
    const result = PaginationSchema.safeParse({ page: "3", limit: "10" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ page: 3, limit: 10 });
    }
  });

  it("should reject page less than 1", () => {
    const result = PaginationSchema.safeParse({ page: 0 });
    expect(result.success).toBe(false);
  });

  it("should reject limit less than 1", () => {
    const result = PaginationSchema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });

  it("should reject limit greater than 100", () => {
    const result = PaginationSchema.safeParse({ limit: 101 });
    expect(result.success).toBe(false);
  });

  it("should reject non-integer page", () => {
    const result = PaginationSchema.safeParse({ page: 1.5 });
    expect(result.success).toBe(false);
  });

  it("should reject non-integer limit", () => {
    const result = PaginationSchema.safeParse({ limit: 10.5 });
    expect(result.success).toBe(false);
  });
});

describe("paginationMeta", () => {
  it("should calculate totalPages with ceil division", () => {
    const meta = paginationMeta(25, { page: 1, limit: 10 });
    expect(meta).toEqual({ total: 25, page: 1, limit: 10, totalPages: 3 });
  });

  it("should return 0 totalPages for 0 total", () => {
    const meta = paginationMeta(0, { page: 1, limit: 20 });
    expect(meta).toEqual({ total: 0, page: 1, limit: 20, totalPages: 0 });
  });

  it("should return 1 totalPages when total equals limit", () => {
    const meta = paginationMeta(10, { page: 1, limit: 10 });
    expect(meta).toEqual({ total: 10, page: 1, limit: 10, totalPages: 1 });
  });

  it("should handle non-divisible totals correctly", () => {
    const meta = paginationMeta(7, { page: 1, limit: 3 });
    expect(meta.totalPages).toBe(3);
  });
});

describe("paginationOffsetLimit", () => {
  it("should return offset 0 for page 1", () => {
    const result = paginationOffsetLimit({ page: 1, limit: 20 });
    expect(result).toEqual({ offset: 0, limit: 20 });
  });

  it("should calculate correct offset for page 3 with limit 10", () => {
    const result = paginationOffsetLimit({ page: 3, limit: 10 });
    expect(result).toEqual({ offset: 20, limit: 10 });
  });

  it("should calculate correct offset for page 2 with limit 5", () => {
    const result = paginationOffsetLimit({ page: 2, limit: 5 });
    expect(result).toEqual({ offset: 5, limit: 5 });
  });
});
