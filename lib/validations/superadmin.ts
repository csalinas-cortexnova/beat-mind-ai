import { z } from "zod";
import { PaginationSchema } from "@/lib/api/pagination";
import { subscriptionStatusEnum } from "@/lib/db/schema/gyms";
import { agentStatusEnum } from "@/lib/db/schema/agents";
import { email, ianaTimezone } from "./common";

export const ListGymsQuerySchema = PaginationSchema.extend({
  status: z.enum(subscriptionStatusEnum).optional(),
  search: z.string().max(100).optional(),
});

export type ListGymsQuery = z.infer<typeof ListGymsQuerySchema>;

export const ListAgentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(agentStatusEnum).optional(),
  gymId: z.uuid().optional(),
});

export type ListAgentsQuery = z.infer<typeof ListAgentsQuerySchema>;

export const CreateGymFormSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
      message: "Slug must be lowercase letters, numbers, and hyphens only",
    }),
  address: z.string().max(500).nullable().default(null),
  ownerEmail: email,
  plan: z.enum(["starter", "pro", "enterprise"]),
  maxAthletes: z.coerce.number().int().min(5).max(100),
});

export const UpdateGymFormSchema = z
  .object({
    name: z.string().min(2).max(100),
    address: z.string().max(500).nullable(),
    subscriptionStatus: z.enum(["active", "suspended", "cancelled", "trial"]),
    subscriptionPlan: z.enum(["starter", "pro", "enterprise"]),
    maxAthletes: z.coerce.number().int().min(5).max(100),
    timezone: ianaTimezone,
    language: z.enum(["es", "pt", "en"]),
  })
  .partial()
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "At least one field must be provided",
  });

export const ReassignOwnerSchema = z.object({
  newOwnerEmail: email,
});

export type CreateGymForm = z.infer<typeof CreateGymFormSchema>;
export type UpdateGymForm = z.infer<typeof UpdateGymFormSchema>;
export type ReassignOwner = z.infer<typeof ReassignOwnerSchema>;
