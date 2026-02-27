// @vitest-environment node
import { describe, it, expect } from "vitest";
import { ok, error } from "../response";

describe("ok", () => {
  it("should return 200 status by default", async () => {
    const res = ok({ id: "123" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "123" });
  });

  it("should accept a custom status code", async () => {
    const res = ok({ created: true }, 201);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ created: true });
  });

  it("should serialize arrays", async () => {
    const res = ok([1, 2, 3]);
    expect(await res.json()).toEqual([1, 2, 3]);
  });

  it("should serialize nested objects", async () => {
    const data = { user: { name: "Alice", roles: ["admin"] } };
    const res = ok(data);
    expect(await res.json()).toEqual(data);
  });

  it("should serialize null", async () => {
    const res = ok(null);
    expect(await res.json()).toBeNull();
  });
});

describe("error", () => {
  it("should return the given status code", async () => {
    const res = error("Not found", "NOT_FOUND", 404);
    expect(res.status).toBe(404);
  });

  it("should include error message and code in body", async () => {
    const res = error("Unauthorized", "UNAUTHORIZED", 401);
    const body = await res.json();
    expect(body).toEqual({
      error: "Unauthorized",
      code: "UNAUTHORIZED",
    });
  });

  it("should omit details when not provided", async () => {
    const res = error("Bad request", "VALIDATION_ERROR", 422);
    const body = await res.json();
    expect(body).not.toHaveProperty("details");
  });

  it("should include details when provided", async () => {
    const details = [{ field: "name", message: "Required" }];
    const res = error("Validation failed", "VALIDATION_ERROR", 422, details);
    const body = await res.json();
    expect(body).toEqual({
      error: "Validation failed",
      code: "VALIDATION_ERROR",
      details,
    });
  });
});
