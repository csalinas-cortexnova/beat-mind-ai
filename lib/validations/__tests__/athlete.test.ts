// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  CreateAthleteSchema,
  UpdateAthleteSchema,
  UpdateAthleteProfileSchema,
} from "../athlete";

describe("CreateAthleteSchema", () => {
  const validAthlete = {
    name: "John Doe",
  };

  it("should accept minimal valid data (name only)", () => {
    const result = CreateAthleteSchema.safeParse(validAthlete);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxHr).toBe(190);
      expect(result.data.whatsappOptIn).toBe(false);
    }
  });

  it("should accept full valid data", () => {
    const result = CreateAthleteSchema.safeParse({
      name: "John Doe",
      email: "john@example.com",
      phone: "+5511999887766",
      age: 25,
      weightKg: 75.5,
      maxHr: 195,
      whatsappOptIn: true,
    });
    expect(result.success).toBe(true);
  });

  it("should reject empty name", () => {
    const result = CreateAthleteSchema.safeParse({ ...validAthlete, name: "" });
    expect(result.success).toBe(false);
  });

  it("should reject name longer than 100 characters", () => {
    const result = CreateAthleteSchema.safeParse({
      ...validAthlete,
      name: "A".repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it("should accept null email", () => {
    const result = CreateAthleteSchema.safeParse({
      ...validAthlete,
      email: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBeNull();
    }
  });

  it("should lowercase and trim email", () => {
    const result = CreateAthleteSchema.safeParse({
      ...validAthlete,
      email: "  John@Example.COM  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("john@example.com");
    }
  });

  it("should accept null phone", () => {
    const result = CreateAthleteSchema.safeParse({
      ...validAthlete,
      phone: null,
    });
    expect(result.success).toBe(true);
  });

  it("should reject invalid phone format", () => {
    const result = CreateAthleteSchema.safeParse({
      ...validAthlete,
      phone: "123456",
    });
    expect(result.success).toBe(false);
  });

  it("should reject age below 10", () => {
    const result = CreateAthleteSchema.safeParse({
      ...validAthlete,
      age: 9,
    });
    expect(result.success).toBe(false);
  });

  it("should reject age above 100", () => {
    const result = CreateAthleteSchema.safeParse({
      ...validAthlete,
      age: 101,
    });
    expect(result.success).toBe(false);
  });

  it("should accept boundary ages (10 and 100)", () => {
    const result10 = CreateAthleteSchema.safeParse({
      ...validAthlete,
      age: 10,
    });
    expect(result10.success).toBe(true);

    const result100 = CreateAthleteSchema.safeParse({
      ...validAthlete,
      age: 100,
    });
    expect(result100.success).toBe(true);
  });

  it("should accept null age", () => {
    const result = CreateAthleteSchema.safeParse({
      ...validAthlete,
      age: null,
    });
    expect(result.success).toBe(true);
  });

  it("should reject weightKg below 20", () => {
    const result = CreateAthleteSchema.safeParse({
      ...validAthlete,
      weightKg: 19.9,
    });
    expect(result.success).toBe(false);
  });

  it("should reject weightKg above 300", () => {
    const result = CreateAthleteSchema.safeParse({
      ...validAthlete,
      weightKg: 300.1,
    });
    expect(result.success).toBe(false);
  });

  it("should accept boundary weightKg (20 and 300)", () => {
    const result20 = CreateAthleteSchema.safeParse({
      ...validAthlete,
      weightKg: 20,
    });
    expect(result20.success).toBe(true);

    const result300 = CreateAthleteSchema.safeParse({
      ...validAthlete,
      weightKg: 300,
    });
    expect(result300.success).toBe(true);
  });

  it("should accept null weightKg", () => {
    const result = CreateAthleteSchema.safeParse({
      ...validAthlete,
      weightKg: null,
    });
    expect(result.success).toBe(true);
  });

  it("should reject maxHr below 100", () => {
    const result = CreateAthleteSchema.safeParse({
      ...validAthlete,
      maxHr: 99,
    });
    expect(result.success).toBe(false);
  });

  it("should reject maxHr above 250", () => {
    const result = CreateAthleteSchema.safeParse({
      ...validAthlete,
      maxHr: 251,
    });
    expect(result.success).toBe(false);
  });

  it("should use default maxHr of 190", () => {
    const result = CreateAthleteSchema.safeParse(validAthlete);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxHr).toBe(190);
    }
  });

  it("should use default whatsappOptIn of false", () => {
    const result = CreateAthleteSchema.safeParse(validAthlete);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.whatsappOptIn).toBe(false);
    }
  });

  it("should reject float age", () => {
    const result = CreateAthleteSchema.safeParse({
      ...validAthlete,
      age: 25.5,
    });
    expect(result.success).toBe(false);
  });

  it("should reject float maxHr", () => {
    const result = CreateAthleteSchema.safeParse({
      ...validAthlete,
      maxHr: 190.5,
    });
    expect(result.success).toBe(false);
  });
});

describe("UpdateAthleteSchema", () => {
  it("should accept a single field update", () => {
    const result = UpdateAthleteSchema.safeParse({ name: "Jane Doe" });
    expect(result.success).toBe(true);
  });

  it("should accept isActive field", () => {
    const result = UpdateAthleteSchema.safeParse({ isActive: false });
    expect(result.success).toBe(true);
  });

  it("should reject empty object", () => {
    const result = UpdateAthleteSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should accept multiple field updates", () => {
    const result = UpdateAthleteSchema.safeParse({
      name: "Jane Doe",
      age: 30,
      maxHr: 180,
    });
    expect(result.success).toBe(true);
  });

  it("should accept null email", () => {
    const result = UpdateAthleteSchema.safeParse({ email: null });
    expect(result.success).toBe(true);
  });

  it("should accept null phone", () => {
    const result = UpdateAthleteSchema.safeParse({ phone: null });
    expect(result.success).toBe(true);
  });

  it("should accept null age", () => {
    const result = UpdateAthleteSchema.safeParse({ age: null });
    expect(result.success).toBe(true);
  });

  it("should accept null weightKg", () => {
    const result = UpdateAthleteSchema.safeParse({ weightKg: null });
    expect(result.success).toBe(true);
  });
});

describe("UpdateAthleteProfileSchema", () => {
  it("should accept a single field update", () => {
    const result = UpdateAthleteProfileSchema.safeParse({ name: "Jane" });
    expect(result.success).toBe(true);
  });

  it("should reject empty object", () => {
    const result = UpdateAthleteProfileSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should accept whatsappOptIn", () => {
    const result = UpdateAthleteProfileSchema.safeParse({
      whatsappOptIn: true,
    });
    expect(result.success).toBe(true);
  });

  it("should not accept isActive (not in profile schema)", () => {
    const result = UpdateAthleteProfileSchema.safeParse({ isActive: false });
    // isActive is stripped by Zod (not in the schema), leaving empty object
    expect(result.success).toBe(false);
  });

  it("should accept phone update", () => {
    const result = UpdateAthleteProfileSchema.safeParse({
      phone: "+5511999887766",
    });
    expect(result.success).toBe(true);
  });

  it("should accept null phone", () => {
    const result = UpdateAthleteProfileSchema.safeParse({ phone: null });
    expect(result.success).toBe(true);
  });
});
