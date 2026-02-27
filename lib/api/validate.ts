import { NextResponse } from "next/server";
import type { z } from "zod";

type ValidationSuccess<T> = { success: true; data: T };
type ValidationFailure = { success: false; response: NextResponse };
type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

function parseResult<T>(result: z.SafeParseReturnType<unknown, T>): ValidationResult<T> {
  if (result.success) {
    return { success: true, data: result.data };
  }

  const details = result.error.issues.map((issue) => ({
    field: issue.path.map(String).join("."),
    message: issue.message,
  }));

  return {
    success: false,
    response: NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR", details },
      { status: 422 }
    ),
  };
}

export function validateBody<T>(
  schema: z.ZodType<T>,
  body: unknown
): ValidationResult<T> {
  return parseResult(schema.safeParse(body));
}

export function validateQuery<T>(
  schema: z.ZodType<T>,
  searchParams: URLSearchParams
): ValidationResult<T> {
  const raw = Object.fromEntries(searchParams);
  return parseResult(schema.safeParse(raw));
}
