import { z } from "zod";
import { email, phone } from "./common";

export const CreateAthleteSchema = z.object({
  name: z.string().min(1).max(100),
  email: email.nullable().optional(),
  phone: phone.optional(),
  age: z.int().min(10).max(100).nullable().optional(),
  weightKg: z.number().min(20).max(300).nullable().optional(),
  maxHr: z.int().min(100).max(250).default(190),
  whatsappOptIn: z.boolean().default(false),
});

export const UpdateAthleteSchema = z
  .object({
    name: z.string().min(1).max(100),
    email: email.nullable(),
    phone: phone,
    age: z.int().min(10).max(100).nullable(),
    weightKg: z.number().min(20).max(300).nullable(),
    maxHr: z.int().min(100).max(250),
    whatsappOptIn: z.boolean(),
    isActive: z.boolean(),
  })
  .partial()
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "At least one field must be provided",
  });

export const UpdateAthleteProfileSchema = z
  .object({
    name: z.string().min(1).max(100),
    age: z.int().min(10).max(100).nullable(),
    weightKg: z.number().min(20).max(300).nullable(),
    maxHr: z.int().min(100).max(250),
    phone: phone,
    whatsappOptIn: z.boolean(),
  })
  .partial()
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "At least one field must be provided",
  });

export type CreateAthlete = z.infer<typeof CreateAthleteSchema>;
export type UpdateAthlete = z.infer<typeof UpdateAthleteSchema>;
export type UpdateAthleteProfile = z.infer<typeof UpdateAthleteProfileSchema>;
