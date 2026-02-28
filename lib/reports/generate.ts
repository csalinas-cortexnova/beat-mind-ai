/**
 * Report generation pipeline orchestrator.
 *
 * 5-step pipeline:
 * 1. Calculate per-athlete session stats
 * 2. Upsert session_athletes with stats
 * 3. Update sessions.athlete_count
 * 4. Check/generate AI summary
 * 5. Schedule WhatsApp delivery (2-minute delay)
 */

import { db } from "@/lib/db";
import { sessions, sessionAthletes, athletes } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { calculateAthleteSessionStats } from "./stats";
import { generateReportToken } from "./token";
import { generatePostSessionSummary } from "@/lib/ai/coach";
import { sendWhatsAppMessage } from "@/lib/whatsapp/client";
import { buildSessionReportTemplate } from "@/lib/whatsapp/templates";
import { log } from "@/lib/logger";

// ─── Utilities ──────────────────────────────────────────────────────────────

/**
 * Format seconds into "mm:ss" string.
 */
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/**
 * Validate phone number: starts with "+" and has 10-15 digits.
 */
function isValidPhone(phone: string | null | undefined): phone is string {
  if (!phone) return false;
  if (!phone.startsWith("+")) return false;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

// ─── Main Pipeline ──────────────────────────────────────────────────────────

/**
 * Generate a session report: stats, upsert, AI summary, WhatsApp.
 */
export async function generateSessionReport(
  sessionId: string,
  gymId: string
): Promise<void> {
  try {
    // Step 0: Query session for durationSeconds and existing AI summary
    const session = await db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      columns: {
        durationSeconds: true,
        classType: true,
        aiSummary: true,
      },
    });

    if (!session) {
      log.warn("Session not found for report generation", {
        module: "reports",
        sessionId,
      });
      return;
    }

    const durationSeconds = session.durationSeconds || 0;

    // Step 1: Calculate per-athlete stats
    const stats = await calculateAthleteSessionStats(
      sessionId,
      durationSeconds
    );

    if (stats.length === 0) {
      log.info("No stats for session, skipping report", {
        module: "reports",
        sessionId,
      });
      return;
    }

    // Step 2: Upsert session_athletes with stats
    for (const stat of stats) {
      await db
        .insert(sessionAthletes)
        .values({
          sessionId,
          athleteId: stat.athleteId,
          avgHr: stat.avgHr,
          maxHr: stat.maxHr,
          minHr: stat.minHr,
          calories: stat.calories,
          timeZone1S: stat.zoneTimes.zone1Seconds,
          timeZone2S: stat.zoneTimes.zone2Seconds,
          timeZone3S: stat.zoneTimes.zone3Seconds,
          timeZone4S: stat.zoneTimes.zone4Seconds,
          timeZone5S: stat.zoneTimes.zone5Seconds,
        })
        .onConflictDoUpdate({
          target: [sessionAthletes.sessionId, sessionAthletes.athleteId],
          set: {
            avgHr: stat.avgHr,
            maxHr: stat.maxHr,
            minHr: stat.minHr,
            calories: stat.calories,
            timeZone1S: stat.zoneTimes.zone1Seconds,
            timeZone2S: stat.zoneTimes.zone2Seconds,
            timeZone3S: stat.zoneTimes.zone3Seconds,
            timeZone4S: stat.zoneTimes.zone4Seconds,
            timeZone5S: stat.zoneTimes.zone5Seconds,
          },
        });
    }

    // Step 3: Update sessions.athlete_count
    await db
      .update(sessions)
      .set({ athleteCount: stats.length })
      .where(eq(sessions.id, sessionId));

    // Step 4: Check/generate AI summary
    if (!session.aiSummary) {
      await generatePostSessionSummary(sessionId, gymId);
    }

    // Step 5: Schedule WhatsApp delivery (2-minute delay)
    const gymName = await getGymName(gymId);
    const classType = session.classType || "";
    const duration = formatDuration(durationSeconds);

    setTimeout(async () => {
      try {
        await sendWhatsAppToEligibleAthletes(
          sessionId,
          gymId,
          gymName,
          classType,
          duration,
          stats
        );
      } catch (err) {
        log.error("WhatsApp delivery failed", {
          module: "reports",
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, 120_000);

    log.info("Report pipeline completed, WhatsApp scheduled", {
      module: "reports",
      sessionId,
      athleteCount: stats.length,
    });
  } catch (err) {
    log.error("Report generation failed", {
      module: "reports",
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

async function getGymName(gymId: string): Promise<string> {
  const gym = await db.query.gyms.findFirst({
    where: eq(sessions.id, gymId),
    columns: { name: true },
  });
  return gym?.name || "Gym";
}

/**
 * Send WhatsApp to eligible athletes:
 * - whatsappOptIn = true
 * - valid phone number
 * - whatsappSentAt IS NULL (not already sent)
 */
async function sendWhatsAppToEligibleAthletes(
  sessionId: string,
  gymId: string,
  gymName: string,
  classType: string,
  duration: string,
  stats: { athleteId: string; athleteName: string; avgHr: number; calories: number }[]
): Promise<void> {
  // Query eligible athletes
  const eligible = await db
    .select({
      athleteId: athletes.id,
      athleteName: athletes.name,
      phone: athletes.phone,
      whatsappOptIn: athletes.whatsappOptIn,
      whatsappSentAt: sessionAthletes.whatsappSentAt,
    })
    .from(athletes)
    .innerJoin(
      sessionAthletes,
      and(
        eq(sessionAthletes.athleteId, athletes.id),
        eq(sessionAthletes.sessionId, sessionId)
      )
    )
    .where(
      and(
        eq(athletes.whatsappOptIn, true),
        isNull(sessionAthletes.whatsappSentAt)
      )
    );

  if (eligible.length === 0) {
    log.debug("No eligible athletes for WhatsApp", {
      module: "reports",
      sessionId,
    });
    return;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.beatmind.ai";

  for (const athlete of eligible) {
    // Skip invalid phone numbers
    if (!isValidPhone(athlete.phone)) {
      log.debug("Skipping WhatsApp - invalid phone", {
        module: "reports",
        athleteId: athlete.athleteId,
      });
      continue;
    }

    // Skip already sent
    if (athlete.whatsappSentAt) continue;

    // Find matching stats for this athlete
    const athleteStat = stats.find((s) => s.athleteId === athlete.athleteId);
    if (!athleteStat) continue;

    // Generate report token and URL
    const token = generateReportToken(sessionId, athlete.athleteId, gymId);
    const reportUrl = `${appUrl}/reports/session/${sessionId}/${athlete.athleteId}?token=${token}`;

    // Build template
    const template = buildSessionReportTemplate({
      athleteName: athlete.athleteName,
      classType,
      gymName,
      duration,
      avgHr: athleteStat.avgHr,
      calories: athleteStat.calories,
      reportUrl,
    });

    // Send WhatsApp message
    const result = await sendWhatsAppMessage({
      to: athlete.phone,
      templateName: template.templateName,
      templateParams: template.params,
    });

    // Update session_athletes with result
    if (result.success) {
      await db
        .update(sessionAthletes)
        .set({
          reportToken: token,
          whatsappSentAt: new Date(),
          whatsappStatus: "sent",
        })
        .where(
          and(
            eq(sessionAthletes.sessionId, sessionId),
            eq(sessionAthletes.athleteId, athlete.athleteId)
          )
        );

      log.info("WhatsApp sent successfully", {
        module: "reports",
        sessionId,
        athleteId: athlete.athleteId,
        messageSid: result.messageSid,
      });
    } else {
      await db
        .update(sessionAthletes)
        .set({
          whatsappStatus: "failed",
        })
        .where(
          and(
            eq(sessionAthletes.sessionId, sessionId),
            eq(sessionAthletes.athleteId, athlete.athleteId)
          )
        );

      log.warn("WhatsApp send failed", {
        module: "reports",
        sessionId,
        athleteId: athlete.athleteId,
        error: result.errorMessage,
      });
    }
  }
}
