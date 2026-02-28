import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockUsePathname = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

vi.mock("@clerk/nextjs", () => ({
  UserButton: () => <div data-testid="clerk-user-button" />,
}));

import { SuperAdminSidebar } from "../sidebar";

describe("SuperAdminSidebar", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("should render all three navigation links", () => {
    mockUsePathname.mockReturnValue("/superadmin");
    render(<SuperAdminSidebar />);
    // Both mobile + desktop sidebars render the same nav, so use getAllByText
    expect(screen.getAllByText("Overview").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Gyms").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Agents").length).toBeGreaterThanOrEqual(1);
  });

  it("should highlight Overview link when on /superadmin", () => {
    mockUsePathname.mockReturnValue("/superadmin");
    render(<SuperAdminSidebar />);
    // Check the desktop sidebar link (last instance)
    const overviewLinks = screen.getAllByText("Overview");
    const overviewLink = overviewLinks[overviewLinks.length - 1].closest("a");
    expect(overviewLink?.className).toContain("bg-gray-900");
  });

  it("should highlight Gyms link when on /superadmin/gyms subpath", () => {
    mockUsePathname.mockReturnValue("/superadmin/gyms/some-id");
    render(<SuperAdminSidebar />);
    const gymsLinks = screen.getAllByText("Gyms");
    const gymsLink = gymsLinks[gymsLinks.length - 1].closest("a");
    expect(gymsLink?.className).toContain("bg-gray-900");
    // Overview should NOT be highlighted
    const overviewLinks = screen.getAllByText("Overview");
    const overviewLink = overviewLinks[overviewLinks.length - 1].closest("a");
    expect(overviewLink?.className).not.toContain("bg-gray-900");
  });

  it("should render UserButton from Clerk", () => {
    mockUsePathname.mockReturnValue("/superadmin");
    render(<SuperAdminSidebar />);
    expect(screen.getAllByTestId("clerk-user-button").length).toBeGreaterThanOrEqual(1);
  });

  it("should toggle mobile menu on hamburger click", async () => {
    mockUsePathname.mockReturnValue("/superadmin");
    const user = userEvent.setup();
    render(<SuperAdminSidebar />);

    const hamburger = screen.getByRole("button", { name: /menu/i });
    // Menu should be hidden initially (mobile overlay not visible)
    expect(screen.queryByTestId("mobile-backdrop")).toBeNull();

    await user.click(hamburger);
    expect(screen.getByTestId("mobile-backdrop")).toBeDefined();

    // Click backdrop to close
    await user.click(screen.getByTestId("mobile-backdrop"));
    expect(screen.queryByTestId("mobile-backdrop")).toBeNull();
  });
});
