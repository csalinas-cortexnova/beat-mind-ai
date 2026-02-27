import { z } from "zod";
import { uuid } from "./common";

export const SendWhatsAppSchema = z.object({
  athleteIds: z.array(uuid).optional(),
});

export type SendWhatsApp = z.infer<typeof SendWhatsAppSchema>;
