import { NextResponse } from "next/server";

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function error(
  message: string,
  code: string,
  status: number,
  details?: Array<{ field: string; message: string }>
): NextResponse {
  const body: Record<string, unknown> = { error: message, code };
  if (details) {
    body.details = details;
  }
  return NextResponse.json(body, { status });
}
