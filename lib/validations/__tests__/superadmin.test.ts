// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  ListGymsQuerySchema,
  ListAgentsQuerySchema,
  CreateGymFormSchema,
  UpdateGymFormSchema,
  ReassignOwnerSchema,
} from "../superadmin";

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

describe("CreateGymFormSchema", () => {
  const validData = {
    name: "Test Gym",
    slug: "test-gym",
    address: "123 Main St",
    ownerEmail: "owner@example.com",
    plan: "starter" as const,
    maxAthletes: 30,
  };

  it("should accept valid complete data", () => {
    const result = CreateGymFormSchema.safeParse(validData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Test Gym");
      expect(result.data.slug).toBe("test-gym");
      expect(result.data.address).toBe("123 Main St");
      expect(result.data.ownerEmail).toBe("owner@example.com");
      expect(result.data.plan).toBe("starter");
      expect(result.data.maxAthletes).toBe(30);
    }
  });

  it("should accept valid data with null address", () => {
    const result = CreateGymFormSchema.safeParse({ ...validData, address: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.address).toBeNull();
    }
  });

  it("should default address to null when omitted", () => {
    const { address: _, ...noAddress } = validData;
    const result = CreateGymFormSchema.safeParse(noAddress);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.address).toBeNull();
    }
  });

  it("should reject missing name", () => {
    const { name: _, ...noName } = validData;
    const result = CreateGymFormSchema.safeParse(noName);
    expect(result.success).toBe(false);
  });

  it("should reject name too short (1 char)", () => {
    const result = CreateGymFormSchema.safeParse({ ...validData, name: "A" });
    expect(result.success).toBe(false);
  });

  it("should reject name too long (101 chars)", () => {
    const result = CreateGymFormSchema.safeParse({
      ...validData,
      name: "a".repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it("should reject invalid slug (uppercase)", () => {
    const result = CreateGymFormSchema.safeParse({ ...validData, slug: "Test-Gym" });
    expect(result.success).toBe(false);
  });

  it("should reject invalid slug (spaces)", () => {
    const result = CreateGymFormSchema.safeParse({ ...validData, slug: "test gym" });
    expect(result.success).toBe(false);
  });

  it("should reject invalid slug (starts with hyphen)", () => {
    const result = CreateGymFormSchema.safeParse({ ...validData, slug: "-test-gym" });
    expect(result.success).toBe(false);
  });

  it("should accept valid slug with numbers and hyphens", () => {
    const result = CreateGymFormSchema.safeParse({ ...validData, slug: "gym-123-test" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slug).toBe("gym-123-test");
    }
  });

  it("should reject invalid ownerEmail", () => {
    const result = CreateGymFormSchema.safeParse({
      ...validData,
      ownerEmail: "not-an-email",
    });
    expect(result.success).toBe(false);
  });

  it("should accept ownerEmail with whitespace trimming", () => {
    const result = CreateGymFormSchema.safeParse({
      ...validData,
      ownerEmail: "  Owner@Example.COM  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ownerEmail).toBe("owner@example.com");
    }
  });

  it("should reject invalid plan", () => {
    const result = CreateGymFormSchema.safeParse({ ...validData, plan: "basic" });
    expect(result.success).toBe(false);
  });

  it("should reject maxAthletes < 5", () => {
    const result = CreateGymFormSchema.safeParse({ ...validData, maxAthletes: 4 });
    expect(result.success).toBe(false);
  });

  it("should reject maxAthletes > 100", () => {
    const result = CreateGymFormSchema.safeParse({ ...validData, maxAthletes: 101 });
    expect(result.success).toBe(false);
  });

  it("should coerce maxAthletes from string to number", () => {
    const result = CreateGymFormSchema.safeParse({ ...validData, maxAthletes: "50" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxAthletes).toBe(50);
    }
  });
});

describe("UpdateGymFormSchema", () => {
  it("should accept single field update (name only)", () => {
    const result = UpdateGymFormSchema.safeParse({ name: "New Name" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("New Name");
    }
  });

  it("should accept multiple field update", () => {
    const result = UpdateGymFormSchema.safeParse({
      name: "Updated Gym",
      maxAthletes: 50,
      language: "pt",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Updated Gym");
      expect(result.data.maxAthletes).toBe(50);
      expect(result.data.language).toBe("pt");
    }
  });

  it("should reject empty object (no fields)", () => {
    const result = UpdateGymFormSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should reject invalid subscriptionStatus", () => {
    const result = UpdateGymFormSchema.safeParse({ subscriptionStatus: "paused" });
    expect(result.success).toBe(false);
  });

  it("should reject invalid subscriptionPlan", () => {
    const result = UpdateGymFormSchema.safeParse({ subscriptionPlan: "basic" });
    expect(result.success).toBe(false);
  });

  it("should reject invalid timezone", () => {
    const result = UpdateGymFormSchema.safeParse({ timezone: "Not/A/Timezone" });
    expect(result.success).toBe(false);
  });

  it("should accept valid timezone (America/Sao_Paulo)", () => {
    const result = UpdateGymFormSchema.safeParse({ timezone: "America/Sao_Paulo" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timezone).toBe("America/Sao_Paulo");
    }
  });

  it("should reject invalid language", () => {
    const result = UpdateGymFormSchema.safeParse({ language: "fr" });
    expect(result.success).toBe(false);
  });

  it("should accept valid language values", () => {
    for (const lang of ["es", "pt", "en"]) {
      const result = UpdateGymFormSchema.safeParse({ language: lang });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.language).toBe(lang);
      }
    }
  });

  it("should reject maxAthletes out of range", () => {
    expect(UpdateGymFormSchema.safeParse({ maxAthletes: 4 }).success).toBe(false);
    expect(UpdateGymFormSchema.safeParse({ maxAthletes: 101 }).success).toBe(false);
  });

  it("should coerce maxAthletes from string", () => {
    const result = UpdateGymFormSchema.safeParse({ maxAthletes: "25" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxAthletes).toBe(25);
    }
  });
});

describe("ReassignOwnerSchema", () => {
  it("should accept valid email", () => {
    const result = ReassignOwnerSchema.safeParse({ newOwnerEmail: "new@example.com" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.newOwnerEmail).toBe("new@example.com");
    }
  });

  it("should accept email with whitespace (trimmed)", () => {
    const result = ReassignOwnerSchema.safeParse({ newOwnerEmail: "  test@example.com  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.newOwnerEmail).toBe("test@example.com");
    }
  });

  it("should reject missing email", () => {
    const result = ReassignOwnerSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should reject invalid email format", () => {
    const result = ReassignOwnerSchema.safeParse({ newOwnerEmail: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("should lowercase email", () => {
    const result = ReassignOwnerSchema.safeParse({ newOwnerEmail: "Test@EXAMPLE.COM" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.newOwnerEmail).toBe("test@example.com");
    }
  });
});
