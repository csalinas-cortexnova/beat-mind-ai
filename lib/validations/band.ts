import { z } from "zod";

export const AssignBandSchema = z.object({
  sensorId: z.int().min(1),
  bandLabel: z.string().max(100).optional(),
});

export type AssignBand = z.infer<typeof AssignBandSchema>;
