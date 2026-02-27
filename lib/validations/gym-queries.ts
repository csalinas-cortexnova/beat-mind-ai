import { z } from "zod";
import { PaginationSchema } from "@/lib/api/pagination";
import { sessionStatusEnum } from "@/lib/db/schema";

export const ListAthletesQuerySchema = PaginationSchema.extend({
  search: z.string().max(100).optional(),
  active: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

export type ListAthletesQuery = z.infer<typeof ListAthletesQuerySchema>;

export const ListSessionsQuerySchema = PaginationSchema.extend({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  status: z.enum(sessionStatusEnum).optional(),
});

export type ListSessionsQuery = z.infer<typeof ListSessionsQuerySchema>;
