// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  CreateGymSchema,
  UpdateGymSchema,
  UpdateGymProfileSchema,
} from "../gym";

describe("CreateGymSchema", () => {
  const validGym = {
    name: "My Gym",
    slug: "my-gym",
    address: "123 Main St",
    ownerEmail: "owner@example.com",
    plan: "starter" as const,
    maxAthletes: 50,
  };

  it("should accept valid gym data", () => {
    const result = CreateGymSchema.safeParse(validGym);
    expect(result.success).toBe(true);
  });

  it("should accept null address", () => {
    const result = CreateGymSchema.safeParse({ ...validGym, address: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.address).toBeNull();
    }
  });

  it("should reject name shorter than 2 characters", () => {
    const result = CreateGymSchema.safeParse({ ...validGym, name: "A" });
    expect(result.success).toBe(false);
  });

  it("should reject name longer than 100 characters", () => {
    const result = CreateGymSchema.safeParse({
      ...validGym,
      name: "A".repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it("should accept boundary name lengths (2 and 100)", () => {
    const result2 = CreateGymSchema.safeParse({ ...validGym, name: "AB" });
    expect(result2.success).toBe(true);

    const result100 = CreateGymSchema.safeParse({
      ...validGym,
      name: "A".repeat(100),
    });
    expect(result100.success).toBe(true);
  });

  it("should reject slug with uppercase letters", () => {
    const result = CreateGymSchema.safeParse({ ...validGym, slug: "My-Gym" });
    expect(result.success).toBe(false);
  });

  it("should reject slug with spaces", () => {
    const result = CreateGymSchema.safeParse({ ...validGym, slug: "my gym" });
    expect(result.success).toBe(false);
  });

  it("should accept slug with numbers and hyphens", () => {
    const result = CreateGymSchema.safeParse({
      ...validGym,
      slug: "gym-123-test",
    });
    expect(result.success).toBe(true);
  });

  it("should reject slug shorter than 2 characters", () => {
    const result = CreateGymSchema.safeParse({ ...validGym, slug: "a" });
    expect(result.success).toBe(false);
  });

  it("should reject slug starting or ending with hyphen", () => {
    const result1 = CreateGymSchema.safeParse({ ...validGym, slug: "-my-gym" });
    expect(result1.success).toBe(false);

    const result2 = CreateGymSchema.safeParse({ ...validGym, slug: "my-gym-" });
    expect(result2.success).toBe(false);
  });

  it("should reject slug with consecutive hyphens", () => {
    const result = CreateGymSchema.safeParse({
      ...validGym,
      slug: "my--gym",
    });
    expect(result.success).toBe(false);
  });

  it("should lowercase and trim the email", () => {
    const result = CreateGymSchema.safeParse({
      ...validGym,
      ownerEmail: "  Owner@Example.COM  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ownerEmail).toBe("owner@example.com");
    }
  });

  it("should reject invalid email", () => {
    const result = CreateGymSchema.safeParse({
      ...validGym,
      ownerEmail: "not-an-email",
    });
    expect(result.success).toBe(false);
  });

  it("should accept all valid plan values", () => {
    for (const plan of ["starter", "pro", "enterprise"] as const) {
      const result = CreateGymSchema.safeParse({ ...validGym, plan });
      expect(result.success).toBe(true);
    }
  });

  it("should reject invalid plan", () => {
    const result = CreateGymSchema.safeParse({ ...validGym, plan: "free" });
    expect(result.success).toBe(false);
  });

  it("should reject maxAthletes below 5", () => {
    const result = CreateGymSchema.safeParse({
      ...validGym,
      maxAthletes: 4,
    });
    expect(result.success).toBe(false);
  });

  it("should reject maxAthletes above 100", () => {
    const result = CreateGymSchema.safeParse({
      ...validGym,
      maxAthletes: 101,
    });
    expect(result.success).toBe(false);
  });

  it("should accept boundary maxAthletes (5 and 100)", () => {
    const result5 = CreateGymSchema.safeParse({
      ...validGym,
      maxAthletes: 5,
    });
    expect(result5.success).toBe(true);

    const result100 = CreateGymSchema.safeParse({
      ...validGym,
      maxAthletes: 100,
    });
    expect(result100.success).toBe(true);
  });

  it("should reject address longer than 500 characters", () => {
    const result = CreateGymSchema.safeParse({
      ...validGym,
      address: "A".repeat(501),
    });
    expect(result.success).toBe(false);
  });
});

describe("UpdateGymSchema", () => {
  it("should accept a single field update", () => {
    const result = UpdateGymSchema.safeParse({ name: "New Name" });
    expect(result.success).toBe(true);
  });

  it("should accept multiple field updates", () => {
    const result = UpdateGymSchema.safeParse({
      name: "New Name",
      maxAthletes: 50,
      language: "en",
    });
    expect(result.success).toBe(true);
  });

  it("should reject empty object", () => {
    const result = UpdateGymSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should accept all subscriptionStatus values", () => {
    for (const status of [
      "active",
      "suspended",
      "cancelled",
      "trial",
    ] as const) {
      const result = UpdateGymSchema.safeParse({
        subscriptionStatus: status,
      });
      expect(result.success).toBe(true);
    }
  });

  it("should accept null address", () => {
    const result = UpdateGymSchema.safeParse({ address: null });
    expect(result.success).toBe(true);
  });

  it("should accept valid timezone", () => {
    const result = UpdateGymSchema.safeParse({
      timezone: "America/Sao_Paulo",
    });
    expect(result.success).toBe(true);
  });

  it("should reject invalid timezone", () => {
    const result = UpdateGymSchema.safeParse({ timezone: "Invalid/Zone" });
    expect(result.success).toBe(false);
  });

  it("should accept all language values", () => {
    for (const language of ["es", "pt", "en"] as const) {
      const result = UpdateGymSchema.safeParse({ language });
      expect(result.success).toBe(true);
    }
  });

  it("should reject invalid language", () => {
    const result = UpdateGymSchema.safeParse({ language: "fr" });
    expect(result.success).toBe(false);
  });
});

describe("UpdateGymProfileSchema", () => {
  it("should accept a single field update", () => {
    const result = UpdateGymProfileSchema.safeParse({
      name: "Updated Gym",
    });
    expect(result.success).toBe(true);
  });

  it("should reject empty object", () => {
    const result = UpdateGymProfileSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should accept null phone", () => {
    const result = UpdateGymProfileSchema.safeParse({ phone: null });
    expect(result.success).toBe(true);
  });

  it("should accept valid phone", () => {
    const result = UpdateGymProfileSchema.safeParse({
      phone: "+5511999887766",
    });
    expect(result.success).toBe(true);
  });

  it("should reject invalid phone", () => {
    const result = UpdateGymProfileSchema.safeParse({
      phone: "not-a-phone",
    });
    expect(result.success).toBe(false);
  });

  it("should accept branding with all fields", () => {
    const result = UpdateGymProfileSchema.safeParse({
      branding: {
        logoUrl: "https://example.com/logo.png",
        primaryColor: "#FF5733",
        secondaryColor: "#33FF57",
      },
    });
    expect(result.success).toBe(true);
  });

  it("should accept branding with null logoUrl", () => {
    const result = UpdateGymProfileSchema.safeParse({
      branding: {
        logoUrl: null,
        primaryColor: "#FF5733",
      },
    });
    expect(result.success).toBe(true);
  });

  it("should accept branding with partial fields", () => {
    const result = UpdateGymProfileSchema.safeParse({
      branding: { primaryColor: "#FF5733" },
    });
    expect(result.success).toBe(true);
  });

  it("should reject branding with invalid color", () => {
    const result = UpdateGymProfileSchema.safeParse({
      branding: { primaryColor: "red" },
    });
    expect(result.success).toBe(false);
  });

  it("should reject branding with invalid logoUrl", () => {
    const result = UpdateGymProfileSchema.safeParse({
      branding: { logoUrl: "not-a-url" },
    });
    expect(result.success).toBe(false);
  });

  it("should accept null address", () => {
    const result = UpdateGymProfileSchema.safeParse({ address: null });
    expect(result.success).toBe(true);
  });

  it("should reject address over 500 characters", () => {
    const result = UpdateGymProfileSchema.safeParse({
      address: "A".repeat(501),
    });
    expect(result.success).toBe(false);
  });
});
