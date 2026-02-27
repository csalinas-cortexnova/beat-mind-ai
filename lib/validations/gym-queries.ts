import { z } from "zod";
import { PaginationSchema } from "@/lib/api/pagination";

export const ListAthletesQuerySchema = PaginationSchema.extend({
  search: z.string().max(100).optional(),
  active: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

export type ListAthletesQuery = z.infer<typeof ListAthletesQuerySchema>;
