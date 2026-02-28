/**
 * Structured JSON logger.
 * Outputs to stdout/stderr for PM2 capture.
 * Debug level suppressed in production.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = {
  /** Module or domain (e.g., "athlete-deletion", "rate-limit") */
  module?: string;
  /** Request/operation ID for tracing */
  requestId?: string;
  /** Additional structured fields */
  [key: string]: unknown;
};

type LogEntry = {
  timestamp: string;
  level: LogLevel;
  message: string;
  env: string;
  [key: string]: unknown;
};

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function buildEntry(
  level: LogLevel,
  message: string,
  context?: LogContext
): LogEntry {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    env: process.env.NODE_ENV ?? "development",
  };

  if (context) {
    for (const [key, value] of Object.entries(context)) {
      if (value !== undefined) {
        entry[key] = value;
      }
    }
  }

  return entry;
}

function emit(level: LogLevel, message: string, context?: LogContext): void {
  const entry = buildEntry(level, message, context);
  const json = JSON.stringify(entry);

  if (level === "error") {
    console.error(json);
  } else if (level === "warn") {
    console.warn(json);
  } else {
    console.log(json);
  }
}

export const log = {
  debug(message: string, context?: LogContext): void {
    if (isProduction()) return;
    emit("debug", message, context);
  },

  info(message: string, context?: LogContext): void {
    emit("info", message, context);
  },

  warn(message: string, context?: LogContext): void {
    emit("warn", message, context);
  },

  error(message: string, context?: LogContext): void {
    emit("error", message, context);
  },
};
