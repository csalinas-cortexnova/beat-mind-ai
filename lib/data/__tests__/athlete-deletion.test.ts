// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks ---

// Track deletion calls in order
const deletionOrder: string[] = [];

// The transaction mock
const mockTransaction = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  athletes: {
    id: "id",
    gymId: "gym_id",
  },
  hrReadings: {
    id: "id",
    athleteId: "athlete_id",
    gymId: "gym_id",
  },
  sessionAthletes: {
    id: "id",
    athleteId: "athlete_id",
  },
  athleteBands: {
    id: "id",
    athleteId: "athlete_id",
    gymId: "gym_id",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
  and: (...conditions: unknown[]) => ({ conditions }),
}));

const mockLogInfo = vi.fn();
vi.mock("@/lib/logger", () => ({
  log: {
    info: (...args: unknown[]) => mockLogInfo(...args),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { deleteAthleteData } from "../athlete-deletion";

const ATHLETE_ID = "ath-001";
const GYM_ID = "gym-001";

describe("deleteAthleteData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deletionOrder.length = 0;
  });

  function setupTransaction(opts: {
    hrReadings?: Array<{ id: number }>;
    sessionAthletes?: Array<{ id: string }>;
    athleteBands?: Array<{ id: string }>;
    athletes?: Array<{ id: string }>;
  } = {}) {
    const hrResults = opts.hrReadings ?? [{ id: 1 }, { id: 2 }, { id: 3 }];
    const saResults = opts.sessionAthletes ?? [{ id: "sa-1" }];
    const bandResults = opts.athleteBands ?? [{ id: "band-1" }];
    const athleteResults = opts.athletes ?? [{ id: ATHLETE_ID }];

    mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) => {
      let deleteCall = 0;
      const tx = {
        delete: () => {
          deleteCall++;
          const currentCall = deleteCall;
          return {
            where: () => ({
              returning: () => {
                if (currentCall === 1) {
                  deletionOrder.push("hr_readings");
                  return Promise.resolve(hrResults);
                }
                if (currentCall === 2) {
                  deletionOrder.push("session_athletes");
                  return Promise.resolve(saResults);
                }
                if (currentCall === 3) {
                  deletionOrder.push("athlete_bands");
                  return Promise.resolve(bandResults);
                }
                deletionOrder.push("athletes");
                return Promise.resolve(athleteResults);
              },
            }),
          };
        },
      };
      return callback(tx);
    });
  }

  it("should delete HR readings", async () => {
    setupTransaction({ hrReadings: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    const result = await deleteAthleteData(ATHLETE_ID, GYM_ID);
    expect(result.hrReadingsDeleted).toBe(3);
  });

  it("should delete session_athletes", async () => {
    setupTransaction({ sessionAthletes: [{ id: "sa-1" }, { id: "sa-2" }] });
    const result = await deleteAthleteData(ATHLETE_ID, GYM_ID);
    expect(result.sessionAthletesDeleted).toBe(2);
  });

  it("should delete athlete_bands", async () => {
    setupTransaction({ athleteBands: [{ id: "band-1" }, { id: "band-2" }] });
    const result = await deleteAthleteData(ATHLETE_ID, GYM_ID);
    expect(result.athleteBandsDeleted).toBe(2);
  });

  it("should delete athlete record", async () => {
    setupTransaction({ athletes: [{ id: ATHLETE_ID }] });
    const result = await deleteAthleteData(ATHLETE_ID, GYM_ID);
    expect(result.athleteDeleted).toBe(true);
  });

  it("should return correct DeletionResult counts", async () => {
    setupTransaction({
      hrReadings: [{ id: 1 }, { id: 2 }],
      sessionAthletes: [{ id: "sa-1" }],
      athleteBands: [],
      athletes: [{ id: ATHLETE_ID }],
    });
    const result = await deleteAthleteData(ATHLETE_ID, GYM_ID);
    expect(result).toEqual({
      hrReadingsDeleted: 2,
      sessionAthletesDeleted: 1,
      athleteBandsDeleted: 0,
      athleteDeleted: true,
    });
  });

  it("should run all deletes in a transaction", async () => {
    setupTransaction();
    await deleteAthleteData(ATHLETE_ID, GYM_ID);
    expect(mockTransaction).toHaveBeenCalledOnce();
  });

  it("should delete in FK-safe order: hr_readings → session_athletes → athlete_bands → athletes", async () => {
    setupTransaction();
    await deleteAthleteData(ATHLETE_ID, GYM_ID);

    expect(deletionOrder).toEqual([
      "hr_readings",
      "session_athletes",
      "athlete_bands",
      "athletes",
    ]);
  });

  it("should log audit entry after deletion", async () => {
    setupTransaction();
    await deleteAthleteData(ATHLETE_ID, GYM_ID);

    expect(mockLogInfo).toHaveBeenCalledWith(
      "Athlete data deleted",
      expect.objectContaining({
        module: "athlete-deletion",
        athleteId: ATHLETE_ID,
        gymId: GYM_ID,
        athleteDeleted: true,
      })
    );
  });

  it("should handle zero related records gracefully", async () => {
    setupTransaction({
      hrReadings: [],
      sessionAthletes: [],
      athleteBands: [],
      athletes: [{ id: ATHLETE_ID }],
    });
    const result = await deleteAthleteData(ATHLETE_ID, GYM_ID);
    expect(result).toEqual({
      hrReadingsDeleted: 0,
      sessionAthletesDeleted: 0,
      athleteBandsDeleted: 0,
      athleteDeleted: true,
    });
  });

  it("should propagate transaction errors (rollback)", async () => {
    mockTransaction.mockRejectedValue(new Error("DB connection lost"));

    await expect(deleteAthleteData(ATHLETE_ID, GYM_ID)).rejects.toThrow(
      "DB connection lost"
    );
  });
});
