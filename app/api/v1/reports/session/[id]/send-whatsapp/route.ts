import { NextRequest } from "next/server";
import { ok, error } from "@/lib/api/response";
import { db } from "@/lib/db";
import { sessions, sessionAthletes, athletes, gyms } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { requireGymAccessApi, isAuthError } from "@/lib/auth/guards";
import { validateBody } from "@/lib/api/validate";
import { SendWhatsAppSchema } from "@/lib/validations/report";
import { generateReportToken } from "@/lib/reports/token";
import { sendWhatsAppMessage, maskPhone } from "@/lib/whatsapp/client";
import { buildSessionReportTemplate } from "@/lib/whatsapp/templates";
import { formatDuration } from "@/lib/reports/generate";
import { log } from "@/lib/logger";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;

  // Auth: Clerk only (Owner or Trainer)
  const authResult = await requireGymAccessApi();
  if (isAuthError(authResult)) {
    const code =
      authResult.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN";
    return error(authResult.error, code, authResult.status);
  }

  // Validate body (optional)
  let body: { athleteIds?: string[] } = {};
  try {
    const text = await request.text();
    if (text) {
      const parsed = JSON.parse(text);
      const validation = validateBody(SendWhatsAppSchema, parsed);
      if (!validation.success) return validation.response;
      body = validation.data;
    }
  } catch {
    // Empty body is valid
  }

  // Fetch session (scoped to gym)
  const session = await db.query.sessions.findFirst({
    where: and(eq(sessions.id, sessionId), eq(sessions.gymId, authResult.gymId)),
  });

  if (!session) {
    return error("Session not found", "NOT_FOUND", 404);
  }

  if (session.status !== "completed") {
    return error("Session has not ended", "BAD_REQUEST", 400);
  }

  // Build conditions for athletes query
  const conditions = [eq(sessionAthletes.sessionId, sessionId)];

  if (body.athleteIds && body.athleteIds.length > 0) {
    conditions.push(inArray(sessionAthletes.athleteId, body.athleteIds));
  }

  // Get session athletes with athlete info
  const rows = await db
    .select({
      saId: sessionAthletes.id,
      athleteId: sessionAthletes.athleteId,
      avgHr: sessionAthletes.avgHr,
      calories: sessionAthletes.calories,
      whatsappSentAt: sessionAthletes.whatsappSentAt,
      athleteName: athletes.name,
      phone: athletes.phone,
      whatsappOptIn: athletes.whatsappOptIn,
    })
    .from(sessionAthletes)
    .innerJoin(athletes, eq(sessionAthletes.athleteId, athletes.id))
    .where(and(...conditions));

  // Fetch gym name
  const gym = await db.query.gyms.findFirst({
    where: eq(gyms.id, authResult.gymId),
    columns: { name: true },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const durationFormatted = formatDuration(session.durationSeconds ?? 0);

  const results: Array<{
    athleteId: string;
    status: string;
    messageSid?: string;
    reason?: string;
    error?: string;
  }> = [];

  for (const row of rows) {
    // Check opt-in
    if (!row.whatsappOptIn) {
      results.push({
        athleteId: row.athleteId,
        status: "skipped",
        reason: "no_opt_in",
      });

      await db
        .update(sessionAthletes)
        .set({ whatsappStatus: "skipped" })
        .where(eq(sessionAthletes.id, row.saId));
      continue;
    }

    // Check phone
    if (!row.phone || !/^\+\d{10,15}$/.test(row.phone)) {
      results.push({
        athleteId: row.athleteId,
        status: "skipped",
        reason: row.phone ? "invalid_phone" : "no_phone",
      });
      await db
        .update(sessionAthletes)
        .set({ whatsappStatus: "skipped" })
        .where(eq(sessionAthletes.id, row.saId));
      continue;
    }

    // Check already sent
    if (row.whatsappSentAt) {
      results.push({
        athleteId: row.athleteId,
        status: "skipped",
        reason: "already_sent",
      });
      continue;
    }

    // Generate token and URL
    const reportToken = generateReportToken(
      sessionId,
      row.athleteId,
      authResult.gymId
    );
    const reportUrl = `${appUrl}/reports/session/${sessionId}/${row.athleteId}?token=${reportToken}`;

    // Build template
    const template = buildSessionReportTemplate({
      athleteName: row.athleteName.split(" ")[0], // First name
      classType: session.classType || "Clase",
      gymName: gym?.name || "",
      duration: durationFormatted,
      avgHr: row.avgHr ?? 0,
      calories: row.calories ?? 0,
      reportUrl,
    });

    // Send WhatsApp
    const sendResult = await sendWhatsAppMessage({
      to: row.phone,
      templateName: template.templateName,
      templateParams: template.params,
    });

    if (sendResult.success) {
      await db
        .update(sessionAthletes)
        .set({
          whatsappSentAt: new Date(),
          whatsappStatus: "sent",
          reportToken,
        })
        .where(eq(sessionAthletes.id, row.saId));

      results.push({
        athleteId: row.athleteId,
        status: "sent",
        messageSid: sendResult.messageSid,
      });

      log.info("WhatsApp sent manually", {
        module: "reports",
        sessionId,
        athleteId: row.athleteId,
        phone: maskPhone(row.phone),
      });
    } else {
      await db
        .update(sessionAthletes)
        .set({ whatsappStatus: "failed" })
        .where(eq(sessionAthletes.id, row.saId));

      results.push({
        athleteId: row.athleteId,
        status: "failed",
        error: sendResult.errorMessage,
      });

      log.error("WhatsApp send failed", {
        module: "reports",
        sessionId,
        athleteId: row.athleteId,
        error: sendResult.errorMessage,
      });
    }
  }

  return ok({ results });
}
