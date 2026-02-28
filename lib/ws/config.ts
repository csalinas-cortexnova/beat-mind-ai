/**
 * WS server configuration from environment variables.
 * Sensible defaults for development. WS_INTERNAL_SECRET required in production.
 */

import type { WsConfig } from "./types";

export function loadWsConfig(): WsConfig {
  return {
    WS_PORT: parseInt(process.env.WS_PORT || "3001", 10),
    WS_INTERNAL_SECRET: process.env.WS_INTERNAL_SECRET || "",
    WS_PING_INTERVAL: parseInt(process.env.WS_PING_INTERVAL || "30000", 10),
    WS_PONG_TIMEOUT: parseInt(process.env.WS_PONG_TIMEOUT || "60000", 10),
    WS_AUTH_TIMEOUT: parseInt(process.env.WS_AUTH_TIMEOUT || "5000", 10),
    WS_BATCH_FLUSH_INTERVAL: parseInt(
      process.env.WS_BATCH_FLUSH_INTERVAL || "5000",
      10
    ),
    WS_BATCH_MAX_BUFFER: parseInt(
      process.env.WS_BATCH_MAX_BUFFER || "1000",
      10
    ),
  };
}

export function validateWsConfig(config: WsConfig): void {
  if (isNaN(config.WS_PORT) || config.WS_PORT < 1 || config.WS_PORT > 65535) {
    throw new Error(
      `Invalid WS_PORT: ${config.WS_PORT}. Must be between 1 and 65535.`
    );
  }

  if (
    process.env.NODE_ENV === "production" &&
    !config.WS_INTERNAL_SECRET
  ) {
    throw new Error(
      "WS_INTERNAL_SECRET is required in production environment."
    );
  }
}
