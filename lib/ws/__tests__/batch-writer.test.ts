import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { HRReadingInsert } from "../types";

// ─── Mocks ─────────────────────────────────────────────────────────────────────

const mockValues = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({
  db: { insert: () => ({ values: mockValues }) },
}));
vi.mock("@/lib/db/schema", () => ({
  hrReadings: { _: { name: "hr_readings" } },
}));
vi.mock("@/lib/logger", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── Helpers ───────────────────────────────────────────────────────────────────

const GYM_A = "550e8400-e29b-41d4-a716-446655440000";
const GYM_B = "550e8400-e29b-41d4-a716-446655440001";
const ATHLETE = "550e8400-e29b-41d4-a716-446655440010";
const SESSION = "550e8400-e29b-41d4-a716-446655440020";

function makeReading(overrides: Partial<HRReadingInsert> = {}): HRReadingInsert {
  return {
    sessionId: SESSION,
    gymId: GYM_A,
    athleteId: ATHLETE,
    sensorId: 101,
    heartRateBpm: 145,
    hrZone: 3,
    hrZoneName: "Cardio",
    hrZoneColor: "#00FF00",
    hrMaxPercent: "76",
    beatTime: new Date("2026-02-27T12:00:00Z"),
    beatCount: 1,
    deviceActive: true,
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("BatchWriter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockValues.mockClear();
    mockValues.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Lazy import so mocks are registered first
  async function createWriter(flushInterval = 5000, maxBuffer = 1000) {
    const { BatchWriter } = await import("../batch-writer");
    return new BatchWriter(flushInterval, maxBuffer);
  }

  it("enqueue() adds readings to buffer", async () => {
    const writer = await createWriter();
    const readings = [makeReading(), makeReading({ sensorId: 102 })];

    writer.enqueue(GYM_A, readings);

    expect(writer.getBufferedCount()).toBe(2);
  });

  it("flush() batch inserts and clears buffer", async () => {
    const writer = await createWriter();
    const readings = [makeReading(), makeReading({ sensorId: 102 })];

    writer.enqueue(GYM_A, readings);
    await writer.flush();

    expect(mockValues).toHaveBeenCalledTimes(1);
    expect(mockValues).toHaveBeenCalledWith(readings);
    expect(writer.getBufferedCount()).toBe(0);
  });

  it("flush() with empty buffer is a no-op (no DB call)", async () => {
    const writer = await createWriter();

    await writer.flush();

    expect(mockValues).not.toHaveBeenCalled();
  });

  it("DB error retains readings in buffer for next cycle", async () => {
    mockValues.mockRejectedValueOnce(new Error("connection refused"));
    const writer = await createWriter();
    const readings = [makeReading()];

    writer.enqueue(GYM_A, readings);
    await writer.flush();

    // Readings should still be in buffer
    expect(writer.getBufferedCount()).toBe(1);

    // Second flush succeeds
    mockValues.mockResolvedValueOnce(undefined);
    await writer.flush();
    expect(writer.getBufferedCount()).toBe(0);
    expect(mockValues).toHaveBeenCalledTimes(2);
  });

  it("buffer overflow (>maxBuffer per gym) drops oldest 50%", async () => {
    const writer = await createWriter(5000, 10); // maxBuffer = 10
    const readings = Array.from({ length: 12 }, (_, i) =>
      makeReading({ sensorId: i, beatCount: i })
    );

    writer.enqueue(GYM_A, readings);

    // 12 > 10 → drop floor(12/2) = 6 oldest → 6 remain
    expect(writer.getBufferedCount()).toBe(6);
  });

  it("shutdown() calls final flush and clears interval", async () => {
    const writer = await createWriter();
    writer.start();
    writer.enqueue(GYM_A, [makeReading()]);

    await writer.shutdown();

    // Final flush should have been called
    expect(mockValues).toHaveBeenCalledTimes(1);
    expect(writer.getBufferedCount()).toBe(0);
  });

  it("multiple gyms flush independently", async () => {
    const writer = await createWriter();
    const readingsA = [makeReading({ gymId: GYM_A })];
    const readingsB = [makeReading({ gymId: GYM_B, sensorId: 201 })];

    writer.enqueue(GYM_A, readingsA);
    writer.enqueue(GYM_B, readingsB);

    expect(writer.getBufferedCount()).toBe(2);

    // Fail only the first gym flush
    mockValues.mockRejectedValueOnce(new Error("timeout"));
    mockValues.mockResolvedValueOnce(undefined);

    await writer.flush();

    // GYM_A retained (error), GYM_B flushed (success)
    expect(writer.getBufferedCount()).toBe(1);
  });

  it("enqueue() after shutdown is a no-op", async () => {
    const writer = await createWriter();
    await writer.shutdown();

    writer.enqueue(GYM_A, [makeReading()]);

    expect(writer.getBufferedCount()).toBe(0);
  });

  it("correct HRReadingInsert shape for DB insert", async () => {
    const writer = await createWriter();
    const reading = makeReading();

    writer.enqueue(GYM_A, [reading]);
    await writer.flush();

    const insertedValues = mockValues.mock.calls[0][0];
    expect(insertedValues).toHaveLength(1);

    const inserted = insertedValues[0];
    expect(inserted).toMatchObject({
      sessionId: SESSION,
      gymId: GYM_A,
      athleteId: ATHLETE,
      sensorId: 101,
      heartRateBpm: 145,
      hrZone: 3,
      hrZoneName: "Cardio",
      hrZoneColor: "#00FF00",
      hrMaxPercent: "76",
      beatCount: 1,
      deviceActive: true,
    });
    expect(inserted.beatTime).toBeInstanceOf(Date);
  });

  it("getBufferedCount() returns total across all gyms", async () => {
    const writer = await createWriter();

    writer.enqueue(GYM_A, [makeReading(), makeReading({ sensorId: 102 })]);
    writer.enqueue(GYM_B, [makeReading({ sensorId: 201 })]);

    expect(writer.getBufferedCount()).toBe(3);
  });

  it("start() triggers flush on interval", async () => {
    const writer = await createWriter(5000);
    writer.start();
    writer.enqueue(GYM_A, [makeReading()]);

    // Advance past flush interval
    await vi.advanceTimersByTimeAsync(5000);

    expect(mockValues).toHaveBeenCalledTimes(1);
    expect(writer.getBufferedCount()).toBe(0);

    // Cleanup
    await writer.shutdown();
  });

  it("enqueue() with empty readings array is a no-op", async () => {
    const writer = await createWriter();

    writer.enqueue(GYM_A, []);

    expect(writer.getBufferedCount()).toBe(0);
  });
});
