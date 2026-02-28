/**
 * AI Coaching System (Coach Pulse) — Prompt builders.
 *
 * Pure functions that construct system/user prompts for OpenAI calls.
 * No side effects, no DB or API imports.
 */

import type { AthleteSummary, PostSessionAthleteStats } from "./types";

// ─── Real-time Analysis Prompts ─────────────────────────────────────────────

/**
 * Build system prompt for real-time coaching analysis.
 * Sets Coach Pulse identity, rules, and language.
 */
export function buildSystemPrompt(language: "es" | "pt"): string {
  const langDirective =
    language === "pt"
      ? "Responda em português, com tom motivador, enérgico mas breve (2-3 frases no máximo)."
      : "Responde en español, con tono motivador, enérgico pero breve (2-3 oraciones máximo).";

  return [
    'Eres "Coach Pulse", un coach de fitness virtual en un gimnasio.',
    langDirective,
    "IMPORTANTE: Siempre menciona el BPM PROMEDIO (avgBpm), NUNCA un BPM puntual específico.",
    "Menciona el nombre del atleta, su zona actual, la tendencia y el promedio de BPM.",
    "Si la zona actual es 4-5 (anaeróbico/máximo), anímalo pero recuérdale descansar si lleva mucho tiempo ahí.",
    "Si la zona actual es 0-1 (reposo/calentamiento), motívalo a subir la intensidad.",
    "Usa máximo 1-2 emojis. No uses hashtags.",
    "Da un mensaje para cada atleta en el resumen.",
  ].join(" ");
}

/**
 * Build user prompt with athlete HR data for real-time analysis.
 */
export function buildUserPrompt(
  athletes: AthleteSummary[],
  classType: string | null
): string {
  const parts: string[] = [];

  if (classType) {
    parts.push(`Tipo de clase: ${classType}`);
  }

  parts.push("Resumen de la sesión actual:");
  parts.push("");
  parts.push(JSON.stringify(athletes, null, 2));
  parts.push("");
  parts.push(
    "Da un mensaje motivacional breve para cada atleta. Usa el avgBpm (promedio), nunca un BPM puntual."
  );

  return parts.join("\n");
}

// ─── Post-Session Summary Prompts ───────────────────────────────────────────

/**
 * Build system prompt for post-session summary generation.
 */
export function buildPostSessionSystemPrompt(language: "es" | "pt"): string {
  const langDirective =
    language === "pt"
      ? "Responda em português com tom profissional e motivador."
      : "Responde en español con tono profesional y motivador.";

  return [
    'Eres "Coach Pulse", un coach de fitness virtual.',
    langDirective,
    "Genera un resumen conciso de la sesión de entrenamiento.",
    "Incluye: rendimiento general del grupo, atletas destacados, recomendaciones para la próxima sesión.",
    "Máximo 4-5 oraciones. Usa datos concretos (promedios, zonas dominantes).",
    "No uses hashtags. Máximo 2 emojis.",
  ].join(" ");
}

/**
 * Build user prompt with post-session stats.
 */
export function buildPostSessionUserPrompt(
  durationSeconds: number,
  athleteCount: number,
  athletes: PostSessionAthleteStats[]
): string {
  const durationMin = Math.round(durationSeconds / 60);

  const parts: string[] = [];
  parts.push(`Duración de la sesión: ${durationMin} minutos`);
  parts.push(`Número de atletas: ${athleteCount}`);
  parts.push("");
  parts.push("Estadísticas por atleta:");
  parts.push(JSON.stringify(athletes, null, 2));
  parts.push("");
  parts.push(
    "Genera un resumen profesional de la sesión con datos concretos."
  );

  return parts.join("\n");
}
