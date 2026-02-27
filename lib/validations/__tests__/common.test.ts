// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  uuid,
  email,
  phone,
  hexColor,
  ianaTimezone,
  UuidParamSchema,
  PaginationSchema as ReExportedPaginationSchema,
} from "../common";
import { PaginationSchema } from "../../api/pagination";

describe("uuid", () => {
  it("should accept a valid v4 UUID", () => {
    const result = uuid.safeParse("550e8400-e29b-41d4-a716-446655440000");
    expect(result.success).toBe(true);
  });

  it("should reject a non-UUID string", () => {
    const result = uuid.safeParse("not-a-uuid");
    expect(result.success).toBe(false);
  });

  it("should reject an empty string", () => {
    const result = uuid.safeParse("");
    expect(result.success).toBe(false);
  });
});

describe("email", () => {
  it("should accept a valid email", () => {
    const result = email.safeParse("user@example.com");
    expect(result.success).toBe(true);
  });

  it("should lowercase the email", () => {
    const result = email.safeParse("User@Example.COM");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("user@example.com");
    }
  });

  it("should trim whitespace", () => {
    const result = email.safeParse("  user@example.com  ");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("user@example.com");
    }
  });

  it("should reject an invalid email", () => {
    const result = email.safeParse("not-an-email");
    expect(result.success).toBe(false);
  });
});

describe("phone", () => {
  it("should accept a valid E.164 phone number", () => {
    const result = phone.safeParse("+5511999887766");
    expect(result.success).toBe(true);
  });

  it("should accept a short E.164 phone number", () => {
    const result = phone.safeParse("+12025551234");
    expect(result.success).toBe(true);
  });

  it("should reject a phone without + prefix", () => {
    const result = phone.safeParse("5511999887766");
    expect(result.success).toBe(false);
  });

  it("should reject a phone starting with +0", () => {
    const result = phone.safeParse("+0511999887766");
    expect(result.success).toBe(false);
  });

  it("should accept null", () => {
    const result = phone.safeParse(null);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });

  it("should reject undefined", () => {
    const result = phone.safeParse(undefined);
    expect(result.success).toBe(false);
  });
});

describe("hexColor", () => {
  it("should accept a valid 6-digit hex color", () => {
    const result = hexColor.safeParse("#FF5733");
    expect(result.success).toBe(true);
  });

  it("should accept lowercase hex", () => {
    const result = hexColor.safeParse("#ff5733");
    expect(result.success).toBe(true);
  });

  it("should reject a 3-digit hex color", () => {
    const result = hexColor.safeParse("#F57");
    expect(result.success).toBe(false);
  });

  it("should reject without # prefix", () => {
    const result = hexColor.safeParse("FF5733");
    expect(result.success).toBe(false);
  });

  it("should reject invalid hex characters", () => {
    const result = hexColor.safeParse("#GGGGGG");
    expect(result.success).toBe(false);
  });
});

describe("ianaTimezone", () => {
  it("should accept America/Sao_Paulo", () => {
    const result = ianaTimezone.safeParse("America/Sao_Paulo");
    expect(result.success).toBe(true);
  });

  it("should accept UTC", () => {
    const result = ianaTimezone.safeParse("UTC");
    expect(result.success).toBe(true);
  });

  it("should accept Europe/London", () => {
    const result = ianaTimezone.safeParse("Europe/London");
    expect(result.success).toBe(true);
  });

  it("should reject Invalid/Zone", () => {
    const result = ianaTimezone.safeParse("Invalid/Zone");
    expect(result.success).toBe(false);
  });

  it("should reject an empty string", () => {
    const result = ianaTimezone.safeParse("");
    expect(result.success).toBe(false);
  });
});

describe("UuidParamSchema", () => {
  it("should accept an object with a valid id", () => {
    const result = UuidParamSchema.safeParse({ id: "550e8400-e29b-41d4-a716-446655440000" });
    expect(result.success).toBe(true);
  });

  it("should reject an object with an invalid id", () => {
    const result = UuidParamSchema.safeParse({ id: "not-uuid" });
    expect(result.success).toBe(false);
  });
});

describe("Re-exports", () => {
  it("should re-export PaginationSchema from api/pagination", () => {
    expect(ReExportedPaginationSchema).toBe(PaginationSchema);
  });
});
