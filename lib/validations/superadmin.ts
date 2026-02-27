import { z } from "zod";
import { PaginationSchema } from "@/lib/api/pagination";
import { subscriptionStatusEnum } from "@/lib/db/schema/gyms";
import { agentStatusEnum } from "@/lib/db/schema/agents";

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
