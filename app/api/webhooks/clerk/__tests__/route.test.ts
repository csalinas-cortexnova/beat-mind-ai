// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// --- Hoisted mocks ---
const {
  mockVerify,
  mockHandleUserCreated,
  mockHandleUserUpdated,
  mockHandleUserDeleted,
  mockHandleOrganizationCreated,
  mockHandleMembershipCreated,
  mockHandleMembershipUpdated,
  mockHandleMembershipDeleted,
} = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockHandleUserCreated: vi.fn(),
  mockHandleUserUpdated: vi.fn(),
  mockHandleUserDeleted: vi.fn(),
  mockHandleOrganizationCreated: vi.fn(),
  mockHandleMembershipCreated: vi.fn(),
  mockHandleMembershipUpdated: vi.fn(),
  mockHandleMembershipDeleted: vi.fn(),
}));

vi.mock("svix", () => ({
  Webhook: class MockWebhook {
    verify = mockVerify;
  },
}));

vi.mock("@/lib/webhooks/clerk-handlers", () => ({
  handleUserCreated: mockHandleUserCreated,
  handleUserUpdated: mockHandleUserUpdated,
  handleUserDeleted: mockHandleUserDeleted,
  handleOrganizationCreated: mockHandleOrganizationCreated,
  handleMembershipCreated: mockHandleMembershipCreated,
  handleMembershipUpdated: mockHandleMembershipUpdated,
  handleMembershipDeleted: mockHandleMembershipDeleted,
}));

import { POST } from "../route";

// --- Helpers ---
const SVIX_HEADERS = {
  "svix-id": "msg_123",
  "svix-timestamp": "1234567890",
  "svix-signature": "v1,abc123",
};

function makeRequest(body: object, headers: Record<string, string> = SVIX_HEADERS): Request {
  return new Request("http://localhost:3000/api/webhooks/clerk", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

// =========================================================
// Webhook Route
// =========================================================

describe("POST /api/webhooks/clerk", () => {
  const originalEnv = process.env.CLERK_WEBHOOK_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLERK_WEBHOOK_SECRET = "whsec_test123";
  });

  afterAll(() => {
    process.env.CLERK_WEBHOOK_SECRET = originalEnv;
  });

  it("should return 500 when webhook secret is missing", async () => {
    delete process.env.CLERK_WEBHOOK_SECRET;
    const req = makeRequest({ type: "user.created", data: {} });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });

  it("should return 400 when svix-id header is missing", async () => {
    const req = makeRequest({ type: "user.created", data: {} }, {
      "svix-timestamp": "1234567890",
      "svix-signature": "v1,abc123",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("should return 400 when svix-timestamp header is missing", async () => {
    const req = makeRequest({ type: "user.created", data: {} }, {
      "svix-id": "msg_123",
      "svix-signature": "v1,abc123",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("should return 400 when svix-signature header is missing", async () => {
    const req = makeRequest({ type: "user.created", data: {} }, {
      "svix-id": "msg_123",
      "svix-timestamp": "1234567890",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("should return 400 when signature verification fails", async () => {
    mockVerify.mockImplementation(() => {
      throw new Error("Invalid signature");
    });
    const req = makeRequest({ type: "user.created", data: {} });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("should route user.created to handleUserCreated", async () => {
    const eventData = { id: "user_1", email_addresses: [] };
    mockVerify.mockReturnValue({ type: "user.created", data: eventData });
    mockHandleUserCreated.mockResolvedValue(undefined);

    const req = makeRequest({ type: "user.created", data: eventData });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockHandleUserCreated).toHaveBeenCalledWith(eventData);
  });

  it("should route user.updated to handleUserUpdated", async () => {
    const eventData = { id: "user_1" };
    mockVerify.mockReturnValue({ type: "user.updated", data: eventData });
    mockHandleUserUpdated.mockResolvedValue(undefined);

    const req = makeRequest({ type: "user.updated", data: eventData });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockHandleUserUpdated).toHaveBeenCalledWith(eventData);
  });

  it("should route user.deleted to handleUserDeleted", async () => {
    const eventData = { id: "user_1", deleted: true };
    mockVerify.mockReturnValue({ type: "user.deleted", data: eventData });
    mockHandleUserDeleted.mockResolvedValue(undefined);

    const req = makeRequest({ type: "user.deleted", data: eventData });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockHandleUserDeleted).toHaveBeenCalledWith(eventData);
  });

  it("should route organization.created to handleOrganizationCreated", async () => {
    const eventData = { id: "org_1", name: "Gym", slug: "gym" };
    mockVerify.mockReturnValue({ type: "organization.created", data: eventData });
    mockHandleOrganizationCreated.mockResolvedValue(undefined);

    const req = makeRequest({ type: "organization.created", data: eventData });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockHandleOrganizationCreated).toHaveBeenCalledWith(eventData);
  });

  it("should route organizationMembership.created to handleMembershipCreated", async () => {
    const eventData = { id: "mem_1", organization: { id: "org_1" } };
    mockVerify.mockReturnValue({ type: "organizationMembership.created", data: eventData });
    mockHandleMembershipCreated.mockResolvedValue(undefined);

    const req = makeRequest({ type: "organizationMembership.created", data: eventData });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockHandleMembershipCreated).toHaveBeenCalledWith(eventData);
  });

  it("should route organizationMembership.updated to handleMembershipUpdated", async () => {
    const eventData = { id: "mem_1" };
    mockVerify.mockReturnValue({ type: "organizationMembership.updated", data: eventData });
    mockHandleMembershipUpdated.mockResolvedValue(undefined);

    const req = makeRequest({ type: "organizationMembership.updated", data: eventData });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockHandleMembershipUpdated).toHaveBeenCalledWith(eventData);
  });

  it("should route organizationMembership.deleted to handleMembershipDeleted", async () => {
    const eventData = { id: "mem_1" };
    mockVerify.mockReturnValue({ type: "organizationMembership.deleted", data: eventData });
    mockHandleMembershipDeleted.mockResolvedValue(undefined);

    const req = makeRequest({ type: "organizationMembership.deleted", data: eventData });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockHandleMembershipDeleted).toHaveBeenCalledWith(eventData);
  });

  it("should return 200 for unknown event types", async () => {
    mockVerify.mockReturnValue({ type: "unknown.event", data: {} });

    const req = makeRequest({ type: "unknown.event", data: {} });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
  });

  it("should return 500 when handler throws", async () => {
    mockVerify.mockReturnValue({ type: "user.created", data: { id: "user_1" } });
    mockHandleUserCreated.mockRejectedValue(new Error("DB error"));

    const req = makeRequest({ type: "user.created", data: { id: "user_1" } });
    const res = await POST(req);

    expect(res.status).toBe(500);
  });
});
