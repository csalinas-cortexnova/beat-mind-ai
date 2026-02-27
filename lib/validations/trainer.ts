import { z } from "zod";
import { email } from "./common";

export const InviteTrainerSchema = z.object({
  email: email,
  name: z.string().min(1).max(100),
});

export type InviteTrainer = z.infer<typeof InviteTrainerSchema>;
