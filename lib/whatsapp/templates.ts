/**
 * WhatsApp template builder for session report messages.
 * Template must match what's configured in Twilio Console.
 */

export interface TemplateData {
  athleteName: string;
  classType: string;
  gymName: string;
  duration: string; // Formatted "mm:ss"
  avgHr: number;
  calories: number;
  reportUrl: string;
}

/**
 * Build template params for the session_report WhatsApp template.
 * Returns ordered params matching Twilio template placeholders:
 *   {{1}} athleteName
 *   {{2}} classType
 *   {{3}} gymName
 *   {{4}} duration
 *   {{5}} avgHr
 *   {{6}} calories
 *   {{7}} reportUrl
 */
export function buildSessionReportTemplate(data: TemplateData): {
  templateName: string;
  params: string[];
} {
  return {
    templateName: "session_report",
    params: [
      data.athleteName,
      data.classType || "Clase",
      data.gymName,
      data.duration,
      String(data.avgHr),
      String(data.calories),
      data.reportUrl,
    ],
  };
}
