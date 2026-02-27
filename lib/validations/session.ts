import { z } from "zod";

export const EndSessionSchema = z.object({
  classType: z.string().max(100).optional(),
});

export type EndSession = z.infer<typeof EndSessionSchema>;
