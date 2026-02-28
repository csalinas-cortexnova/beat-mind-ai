/**
 * Twilio WhatsApp client wrapper with retry logic.
 * Singleton pattern — one client per process.
 */

import Twilio from "twilio";
import { log } from "@/lib/logger";

// ─── Singleton Twilio client ────────────────────────────────────────────────

let twilioClient: ReturnType<typeof Twilio> | null = null;

function getClient() {
  if (!twilioClient) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) return null;
    twilioClient = Twilio(sid, token);
  }
  return twilioClient;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SendWhatsAppParams {
  to: string; // E.164 format: "+5511999998888"
  templateName: string;
  templateParams: string[];
}

export interface SendWhatsAppResult {
  success: boolean;
  messageSid?: string;
  errorCode?: string;
  errorMessage?: string;
}

// ─── Utilities ──────────────────────────────────────────────────────────────

/**
 * Mask phone for logging: "+55****1234"
 */
export function maskPhone(phone: string): string {
  if (phone.length < 8) return "****";
  return phone.slice(0, 3) + "****" + phone.slice(-4);
}

// ─── Send Message ───────────────────────────────────────────────────────────

/**
 * Send a WhatsApp message via Twilio with 1 retry after 30s on failure.
 */
export async function sendWhatsAppMessage(
  params: SendWhatsAppParams
): Promise<SendWhatsAppResult> {
  const client = getClient();
  if (!client) {
    return { success: false, errorMessage: "Twilio client not configured" };
  }

  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!from) {
    return { success: false, errorMessage: "TWILIO_WHATSAPP_FROM not configured" };
  }

  const to = `whatsapp:${params.to}`;

  // Build message body from template params
  // Template messages use ContentSid in production; body is a fallback
  const body = params.templateParams.join(" | ");

  async function attempt(): Promise<SendWhatsAppResult> {
    try {
      const message = await client!.messages.create({
        from,
        to,
        body,
      });
      return { success: true, messageSid: message.sid };
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : String(err);
      const errorCode =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: unknown }).code)
          : undefined;
      return { success: false, errorCode, errorMessage };
    }
  }

  // First attempt
  const firstResult = await attempt();
  if (firstResult.success) return firstResult;

  log.warn("WhatsApp send failed, retrying in 30s", {
    module: "whatsapp",
    phone: maskPhone(params.to),
    error: firstResult.errorMessage,
  });

  // Retry after 30s
  await new Promise((resolve) => setTimeout(resolve, 30_000));
  const retryResult = await attempt();

  if (!retryResult.success) {
    log.error("WhatsApp send failed after retry", {
      module: "whatsapp",
      phone: maskPhone(params.to),
      error: retryResult.errorMessage,
    });
  }

  return retryResult;
}

// ─── Test Helpers ───────────────────────────────────────────────────────────

export const _testing = {
  resetClient: () => {
    twilioClient = null;
  },
};
