import { z } from "zod";

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationParams = z.infer<typeof PaginationSchema>;

export function paginationMeta(
  total: number,
  params: PaginationParams
): { total: number; page: number; limit: number; totalPages: number } {
  return {
    total,
    page: params.page,
    limit: params.limit,
    totalPages: total === 0 ? 0 : Math.ceil(total / params.limit),
  };
}

export function paginationOffsetLimit(
  params: PaginationParams
): { offset: number; limit: number } {
  return {
    offset: (params.page - 1) * params.limit,
    limit: params.limit,
  };
}
