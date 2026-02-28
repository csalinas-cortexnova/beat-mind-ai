/**
 * TV connection handler — builds init message, manages ping/pong lifecycle.
 */

import type { GymStateManager } from "./gym-state";
import type { TvInitMessage, TvConnection } from "./types";
import { log } from "@/lib/logger";

/**
 * Build the initial state message sent to a TV client on connection.
 */
export async function buildInitMessage(
  gymState: GymStateManager,
  gymId: string
): Promise<TvInitMessage> {
  const state = await gymState.getOrLoadState(gymId);

  const athletes = Array.from(state.sensorAthleteMap.entries()).map(
    ([sensorId, athlete]) => ({
      sensorId,
      athleteId: athlete.id,
      athleteName: athlete.name,
      bpm: 0,
      zone: 0,
      zoneName: "",
      zoneColor: "",
      hrMaxPercent: 0,
      deviceActive: false,
    })
  );

  return {
    type: "init",
    gym: {
      id: state.gymId,
      name: state.config.name,
      logoUrl: state.config.logoUrl,
      primaryColor: state.config.primaryColor,
      secondaryColor: state.config.secondaryColor,
    },
    athletes,
    session: state.activeSession
      ? {
          id: state.activeSession.id,
          classType: state.activeSession.classType,
          startedAt: state.activeSession.startedAt,
        }
      : null,
  };
}

/**
 * Set up periodic ping for a TV connection. Terminates on pong timeout.
 * Returns cleanup function to stop the ping interval.
 */
export function setupTvPing(
  tv: TvConnection,
  pingInterval: number,
  pongTimeout: number
): () => void {
  const timer = setInterval(() => {
    const now = Date.now();
    if (now - tv.lastPong > pongTimeout) {
      log.warn("TV: pong timeout, terminating", {
        module: "tv-handler",
        gymId: tv.gymId,
      });
      clearInterval(timer);
      tv.ws.terminate();
      return;
    }

    tv.ws.ping();
  }, pingInterval);

  tv.ws.on("pong", () => {
    tv.lastPong = Date.now();
  });

  return () => clearInterval(timer);
}
