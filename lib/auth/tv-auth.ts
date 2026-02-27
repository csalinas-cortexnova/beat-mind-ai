import { db } from "@/lib/db";
import { gyms } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import type { TvContext } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function verifyTvToken(
  gymId: string,
  token: string
): Promise<TvContext | null> {
  if (!UUID_RE.test(gymId) || !UUID_RE.test(token)) {
    return null;
  }

  const rows = await db
    .select({ id: gyms.id })
    .from(gyms)
    .where(and(eq(gyms.id, gymId), eq(gyms.tvAccessToken, token)));

  if (rows.length === 0) {
    return null;
  }

  return { gymId };
}

export async function regenerateTvToken(gymId: string): Promise<string> {
  const newToken = crypto.randomUUID();

  await db
    .update(gyms)
    .set({ tvAccessToken: newToken })
    .where(eq(gyms.id, gymId));

  return newToken;
}
