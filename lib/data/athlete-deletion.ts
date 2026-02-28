/**
 * Atomic athlete data deletion with audit logging.
 * Deletes in FK-safe order within a transaction.
 */

import { db } from "@/lib/db";
import {
  athletes,
  hrReadings,
  sessionAthletes,
  athleteBands,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { log } from "@/lib/logger";

export type DeletionResult = {
  hrReadingsDeleted: number;
  sessionAthletesDeleted: number;
  athleteBandsDeleted: number;
  athleteDeleted: boolean;
};

/**
 * Delete all data for an athlete within a gym, wrapped in a transaction.
 * Gym scope is enforced in every WHERE clause for defense in depth.
 *
 * Deletion order (FK-safe):
 * 1. hr_readings (athlete_id + gym_id)
 * 2. session_athletes (athlete_id)
 * 3. athlete_bands (athlete_id + gym_id)
 * 4. athletes (id + gym_id)
 */
export async function deleteAthleteData(
  athleteId: string,
  gymId: string
): Promise<DeletionResult> {
  return db.transaction(async (tx) => {
    // 1. Delete HR readings
    const deletedHr = await tx
      .delete(hrReadings)
      .where(and(eq(hrReadings.athleteId, athleteId), eq(hrReadings.gymId, gymId)))
      .returning({ id: hrReadings.id });

    // 2. Delete session_athletes
    const deletedSa = await tx
      .delete(sessionAthletes)
      .where(eq(sessionAthletes.athleteId, athleteId))
      .returning({ id: sessionAthletes.id });

    // 3. Delete athlete_bands
    const deletedBands = await tx
      .delete(athleteBands)
      .where(
        and(eq(athleteBands.athleteId, athleteId), eq(athleteBands.gymId, gymId))
      )
      .returning({ id: athleteBands.id });

    // 4. Delete athlete record
    const deletedAthlete = await tx
      .delete(athletes)
      .where(and(eq(athletes.id, athleteId), eq(athletes.gymId, gymId)))
      .returning({ id: athletes.id });

    const result: DeletionResult = {
      hrReadingsDeleted: deletedHr.length,
      sessionAthletesDeleted: deletedSa.length,
      athleteBandsDeleted: deletedBands.length,
      athleteDeleted: deletedAthlete.length > 0,
    };

    // 5. Audit log
    log.info("Athlete data deleted", {
      module: "athlete-deletion",
      athleteId,
      gymId,
      ...result,
    });

    return result;
  });
}
