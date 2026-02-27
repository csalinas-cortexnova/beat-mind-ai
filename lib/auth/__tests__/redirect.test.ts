// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRedirect, mockAuth } = vi.hoisted(() => ({
  mockRedirect: vi.fn((url: string) => {
    const error = new Error("NEXT_REDIRECT") as Error & { digest: string };
    error.digest = `NEXT_REDIRECT;replace;${url};303`;
    throw error;
  }),
  mockAuth: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
}));

import { getRedirectPath } from "../redirect";

/** Helper to extract redirect URL from the NEXT_REDIRECT error */
async function getRedirectUrl(fn: () => Promise<never>): Promise<string> {
  try {
    await fn();
    throw new Error("Expected redirect to be called");
  } catch (error) {
    if (
      error instanceof Error &&
      (error as Error & { digest?: string }).digest?.startsWith("NEXT_REDIRECT")
    ) {
      return (error as Error & { digest: string }).digest.split(";")[2];
    }
    throw error;
  }
}

describe("getRedirectPath", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedirect.mockImplementation((url: string) => {
      const error = new Error("NEXT_REDIRECT") as Error & { digest: string };
      error.digest = `NEXT_REDIRECT;replace;${url};303`;
      throw error;
    });
  });

  it("should redirect to /sign-in when no user", async () => {
    mockAuth.mockResolvedValue({ userId: null, orgId: null, orgRole: null });
    const url = await getRedirectUrl(() => getRedirectPath());
    expect(url).toBe("/sign-in");
  });

  it("should redirect to /superadmin for superadmin users", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_123",
      orgId: null,
      orgRole: null,
      sessionClaims: { metadata: { isSuperAdmin: true } },
    });
    const url = await getRedirectUrl(() => getRedirectPath());
    expect(url).toBe("/superadmin");
  });

  it("should redirect to /org-selection when user has no org", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_123",
      orgId: null,
      orgRole: null,
      sessionClaims: { metadata: {} },
    });
    const url = await getRedirectUrl(() => getRedirectPath());
    expect(url).toBe("/org-selection");
  });

  it("should redirect to /gym for org:admin role", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_123",
      orgId: "org_123",
      orgRole: "org:admin",
      sessionClaims: { metadata: {} },
    });
    const url = await getRedirectUrl(() => getRedirectPath());
    expect(url).toBe("/gym");
  });

  it("should redirect to /gym for org:trainer role", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_123",
      orgId: "org_123",
      orgRole: "org:trainer",
      sessionClaims: { metadata: {} },
    });
    const url = await getRedirectUrl(() => getRedirectPath());
    expect(url).toBe("/gym");
  });

  it("should redirect to /athlete for org:athlete role", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_123",
      orgId: "org_123",
      orgRole: "org:athlete",
      sessionClaims: { metadata: {} },
    });
    const url = await getRedirectUrl(() => getRedirectPath());
    expect(url).toBe("/athlete");
  });

  it("should redirect to /unauthorized for unknown role", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_123",
      orgId: "org_123",
      orgRole: "org:unknown",
      sessionClaims: { metadata: {} },
    });
    const url = await getRedirectUrl(() => getRedirectPath());
    expect(url).toBe("/unauthorized");
  });
});
