// @vitest-environment node
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { validateBody, validateQuery } from "../validate";

const UserSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
});

const NestedSchema = z.object({
  user: z.object({
    profile: z.object({
      age: z.number().min(0),
    }),
  }),
});

const TransformSchema = z.object({
  tag: z.string().transform((v) => v.toLowerCase()),
});

describe("validateBody", () => {
  it("should return success with parsed data for valid body", () => {
    const result = validateBody(UserSchema, { name: "Alice", email: "alice@example.com" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: "Alice", email: "alice@example.com" });
    }
  });

  it("should return 422 with VALIDATION_ERROR for invalid body", async () => {
    const result = validateBody(UserSchema, { name: "", email: "bad" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.response.status).toBe(422);
      const body = await result.response.json();
      expect(body.error).toBe("Validation failed");
      expect(body.code).toBe("VALIDATION_ERROR");
      expect(body.details).toBeInstanceOf(Array);
      expect(body.details.length).toBeGreaterThan(0);
      expect(body.details[0]).toHaveProperty("field");
      expect(body.details[0]).toHaveProperty("message");
    }
  });

  it("should use dot-notation for nested field paths", async () => {
    const result = validateBody(NestedSchema, { user: { profile: { age: -1 } } });
    expect(result.success).toBe(false);
    if (!result.success) {
      const body = await result.response.json();
      const ageDetail = body.details.find((d: { field: string }) => d.field.includes("age"));
      expect(ageDetail).toBeDefined();
      expect(ageDetail.field).toBe("user.profile.age");
    }
  });

  it("should preserve schema transforms on success", () => {
    const result = validateBody(TransformSchema, { tag: "HELLO" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tag).toBe("hello");
    }
  });
});

describe("validateQuery", () => {
  it("should convert URLSearchParams and validate", () => {
    const params = new URLSearchParams({ name: "Bob", email: "bob@test.com" });
    const result = validateQuery(UserSchema, params);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: "Bob", email: "bob@test.com" });
    }
  });

  it("should return 422 for invalid query params", async () => {
    const params = new URLSearchParams({ name: "", email: "invalid" });
    const result = validateQuery(UserSchema, params);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.response.status).toBe(422);
      const body = await result.response.json();
      expect(body.code).toBe("VALIDATION_ERROR");
    }
  });

  it("should support coercion and defaults with query params", () => {
    const QuerySchema = z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).default(20),
    });
    const params = new URLSearchParams({ page: "3" });
    const result = validateQuery(QuerySchema, params);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ page: 3, limit: 20 });
    }
  });
});
