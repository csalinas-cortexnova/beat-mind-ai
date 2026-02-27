import { z } from "zod";

export const uuid = z.uuid();

export const email = z
  .string()
  .transform((v) => v.trim())
  .pipe(z.email())
  .transform((v) => v.toLowerCase());

export const phone = z
  .string()
  .regex(/^\+[1-9]\d{1,14}$/)
  .nullable();

export const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const ianaTimezone = z.string().refine(
  (val) => {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: val });
      return true;
    } catch {
      return false;
    }
  },
  { message: "Invalid IANA timezone" }
);

export const UuidParamSchema = z.object({ id: uuid });

export { PaginationSchema, type PaginationParams } from "@/lib/api/pagination";
