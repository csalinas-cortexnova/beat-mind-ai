// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// --- Hoisted mocks ---
const {
  mockAuth,
  mockQueryResults,
  mockGenerateReportToken,
  mockSendWhatsAppMessage,
  mockBuildSessionReportTemplate,
  mockFormatDuration,
  mockMaskPhone,
  mockLog,
  mockDbUpdate,
} = vi.hoisted(() => {
  const mockDbUpdate = vi.fn();
  return {
    mockAuth: vi.fn(),
    mockQueryResults: [] as unknown[][],
    mockGenerateReportToken: vi.fn(),
    mockSendWhatsAppMessage: vi.fn(),
    mockBuildSessionReportTemplate: vi.fn(),
    mockFormatDuration: vi.fn(),
    mockMaskPhone: vi.fn(),
    mockLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    mockDbUpdate,
  };
});

function queueResults(...results: unknown[][]) {
  mockQueryResults.push(...results);
}

function createChain(): unknown {
  const chain: Record<string, unknown> = {};
  const resolve = () => {
    const result = mockQueryResults.shift() ?? [];
    return Promise.resolve(result);
  };
  for (const method of [
    "from",
    "where",
    "orderBy",
    "limit",
    "offset",
    "groupBy",
    "leftJoin",
    "innerJoin",
  ]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (
    onFulfilled: (v: unknown) => unknown,
    onRejected?: (e: unknown) => unknown
  ) => resolve().then(onFulfilled, onRejected);
  return chain;
}

// --- Mocks ---

vi.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      sessions: {
        findFirst: vi.fn(() => {
          const result = mockQueryResults.shift() ?? undefined;
          return Promise.resolve(
            Array.isArray(result) ? result[0] ?? undefined : result
          );
        }),
      },
      gyms: {
        findFirst: vi.fn(() => {
          const result = mockQueryResults.shift() ?? undefined;
          return Promise.resolve(
            Array.isArray(result) ? result[0] ?? undefined : result
          );
        }),
      },
    },
    select: vi.fn(() => createChain()),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: mockDbUpdate,
      })),
    })),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  users: {
    id: "id",
    clerkUserId: "clerk_user_id",
    email: "email",
    isSuperadmin: "is_superadmin",
  },
  gyms: {
    id: "id",
    clerkOrgId: "clerk_org_id",
    name: "name",
  },
  sessions: {
    id: "id",
    gymId: "gym_id",
    trainerId: "trainer_id",
    classType: "class_type",
    status: "status",
    startedAt: "started_at",
    endedAt: "ended_at",
    durationSeconds: "duration_seconds",
    athleteCount: "athlete_count",
  },
  sessionAthletes: {
    id: "id",
    sessionId: "session_id",
    athleteId: "athlete_id",
    avgHr: "avg_hr",
    calories: "calories",
    whatsappSentAt: "whatsapp_sent_at",
    whatsappStatus: "whatsapp_status",
    reportToken: "report_token",
  },
  athletes: {
    id: "id",
    name: "name",
    phone: "phone",
    whatsappOptIn: "whatsapp_opt_in",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
  isNull: (col: unknown) => ({ isNull: col }),
  inArray: (col: unknown, vals: unknown) => ({ inArray: [col, vals] }),
}));

vi.mock("@/lib/reports/token", () => ({
  generateReportToken: mockGenerateReportToken,
}));

vi.mock("@/lib/whatsapp/client", () => ({
  sendWhatsAppMessage: mockSendWhatsAppMessage,
  maskPhone: mockMaskPhone,
}));

vi.mock("@/lib/whatsapp/templates", () => ({
  buildSessionReportTemplate: mockBuildSessionReportTemplate,
}));

vi.mock("@/lib/reports/generate", () => ({
  formatDuration: mockFormatDuration,
}));

vi.mock("@/lib/logger", () => ({
  log: mockLog,
}));

import { POST } from "../route";

// --- Constants ---
const DB_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const GYM_ID = "660e8400-e29b-41d4-a716-446655440001";
const SESSION_ID = "880e8400-e29b-41d4-a716-446655440003";
const ATHLETE_ID_1 = "990e8400-e29b-41d4-a716-446655440004";
const ATHLETE_ID_2 = "990e8400-e29b-41d4-a716-446655440005";

function buildRequest(body?: unknown): NextRequest {
  const url = `http://localhost:3000/api/v1/reports/session/${SESSION_ID}/send-whatsapp`;
  if (body !== undefined) {
    return new NextRequest(new URL(url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  return new NextRequest(new URL(url), { method: "POST" });
}

function setupGymAccess(role: string = "org:admin") {
  mockAuth.mockResolvedValue({
    userId: "clerk_user",
    orgId: "org_123",
    orgRole: role,
  });
  // findGymByOrg
  queueResults([{ id: GYM_ID }]);
  // findDbUser
  queueResults([
    {
      id: DB_USER_ID,
      clerkUserId: "clerk_user",
      email: "owner@test.com",
      isSuperadmin: false,
    },
  ]);
}

describe("POST /api/v1/reports/session/[id]/send-whatsapp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResults.length = 0;
    mockFormatDuration.mockReturnValue("60:00");
    mockMaskPhone.mockReturnValue("+55****1234");
    mockGenerateReportToken.mockReturnValue("mock-token");
    mockBuildSessionReportTemplate.mockReturnValue({
      templateName: "session_report",
      params: ["Alice", "Spin", "Test Gym", "60:00", "150", "500", "http://localhost:3000/reports/..."],
    });
    mockDbUpdate.mockResolvedValue(undefined);
  });

  it("should send WhatsApp to eligible athletes and return per-athlete results", async () => {
    setupGymAccess();

    // Session lookup (db.query.sessions.findFirst)
    queueResults([
      {
        id: SESSION_ID,
        gymId: GYM_ID,
        classType: "Spin",
        status: "completed",
        durationSeconds: 3600,
      },
    ]);

    // Athletes query (db.select().from(sessionAthletes).innerJoin(athletes))
    queueResults([
      {
        saId: "sa-1",
        athleteId: ATHLETE_ID_1,
        avgHr: 150,
        calories: 500,
        whatsappSentAt: null,
        athleteName: "Alice Athlete",
        phone: "+5511999998888",
        whatsappOptIn: true,
      },
    ]);

    // Gym lookup (db.query.gyms.findFirst)
    queueResults([{ name: "Test Gym" }]);

    // WhatsApp send succeeds
    mockSendWhatsAppMessage.mockResolvedValue({
      success: true,
      messageSid: "SM123",
    });

    const req = buildRequest();
    const res = await POST(req, {
      params: Promise.resolve({ id: SESSION_ID }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results).toHaveLength(1);
    expect(data.results[0].athleteId).toBe(ATHLETE_ID_1);
    expect(data.results[0].status).toBe("sent");
    expect(data.results[0].messageSid).toBe("SM123");
  });

  it("should skip athletes without opt-in", async () => {
    setupGymAccess();

    // Session
    queueResults([
      {
        id: SESSION_ID,
        gymId: GYM_ID,
        classType: "Spin",
        status: "completed",
        durationSeconds: 3600,
      },
    ]);

    // Athletes - one without opt-in
    queueResults([
      {
        saId: "sa-1",
        athleteId: ATHLETE_ID_1,
        avgHr: 150,
        calories: 500,
        whatsappSentAt: null,
        athleteName: "Bob NoOptIn",
        phone: "+5511999998888",
        whatsappOptIn: false,
      },
    ]);

    // Gym
    queueResults([{ name: "Test Gym" }]);

    const req = buildRequest();
    const res = await POST(req, {
      params: Promise.resolve({ id: SESSION_ID }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results).toHaveLength(1);
    expect(data.results[0].status).toBe("skipped");
    expect(data.results[0].reason).toBe("no_opt_in");
    // Should NOT have called sendWhatsAppMessage
    expect(mockSendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("should return 404 when session not found", async () => {
    setupGymAccess();

    // Session not found
    queueResults([]);

    const req = buildRequest();
    const res = await POST(req, {
      params: Promise.resolve({ id: SESSION_ID }),
    });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.code).toBe("NOT_FOUND");
  });

  it("should return 400 when session is not completed", async () => {
    setupGymAccess();

    // Session is active (not completed)
    queueResults([
      {
        id: SESSION_ID,
        gymId: GYM_ID,
        classType: "Spin",
        status: "active",
        durationSeconds: null,
      },
    ]);

    const req = buildRequest();
    const res = await POST(req, {
      params: Promise.resolve({ id: SESSION_ID }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe("BAD_REQUEST");
  });

  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const req = buildRequest();
    const res = await POST(req, {
      params: Promise.resolve({ id: SESSION_ID }),
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.code).toBe("UNAUTHORIZED");
  });
});
