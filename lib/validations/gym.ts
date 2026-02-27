import { z } from "zod";
import { email, hexColor, ianaTimezone } from "./common";

export const CreateGymSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
      message: "Slug must be lowercase letters, numbers, and hyphens only",
    }),
  address: z.string().max(500).nullable(),
  ownerEmail: email,
  plan: z.enum(["starter", "pro", "enterprise"]),
  maxAthletes: z.int().min(5).max(100),
});

export const UpdateGymSchema = z
  .object({
    name: z.string().min(2).max(100),
    address: z.string().max(500).nullable(),
    subscriptionStatus: z.enum(["active", "suspended", "cancelled", "trial"]),
    subscriptionPlan: z.enum(["starter", "pro", "enterprise"]),
    maxAthletes: z.int().min(5).max(100),
    timezone: ianaTimezone,
    language: z.enum(["es", "pt", "en"]),
  })
  .partial()
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "At least one field must be provided",
  });

export const UpdateGymProfileSchema = z
  .object({
    name: z.string().min(2).max(100),
    address: z.string().max(500).nullable(),
    phone: z
      .string()
      .regex(/^\+[1-9]\d{1,14}$/)
      .nullable(),
    timezone: ianaTimezone,
    language: z.enum(["es", "pt", "en"]),
    branding: z
      .object({
        logoUrl: z.url().nullable().optional(),
        primaryColor: hexColor.optional(),
        secondaryColor: hexColor.optional(),
      })
      .optional(),
  })
  .partial()
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "At least one field must be provided",
  });

export type CreateGym = z.infer<typeof CreateGymSchema>;
export type UpdateGym = z.infer<typeof UpdateGymSchema>;
export type UpdateGymProfile = z.infer<typeof UpdateGymProfileSchema>;
