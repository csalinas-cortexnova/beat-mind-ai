import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StatusBadge } from "../status-badge";

describe("StatusBadge", () => {
  afterEach(cleanup);

  it("should render the label text", () => {
    render(<StatusBadge variant="success" label="Active" />);
    expect(screen.getByText("Active")).toBeDefined();
  });

  it("should apply green classes for success variant", () => {
    render(<StatusBadge variant="success" label="Active" />);
    const badge = screen.getByText("Active");
    expect(badge.className).toContain("bg-green");
    expect(badge.className).toContain("text-green");
  });

  it("should apply amber classes for warning variant", () => {
    render(<StatusBadge variant="warning" label="Suspended" />);
    const badge = screen.getByText("Suspended");
    expect(badge.className).toContain("bg-amber");
    expect(badge.className).toContain("text-amber");
  });

  it("should apply red classes for danger variant", () => {
    render(<StatusBadge variant="danger" label="Cancelled" />);
    const badge = screen.getByText("Cancelled");
    expect(badge.className).toContain("bg-red");
    expect(badge.className).toContain("text-red");
  });

  it("should apply gray classes for neutral variant", () => {
    render(<StatusBadge variant="neutral" label="Offline" />);
    const badge = screen.getByText("Offline");
    expect(badge.className).toContain("bg-gray");
    expect(badge.className).toContain("text-gray");
  });

  it("should apply blue classes for info variant", () => {
    render(<StatusBadge variant="info" label="Trial" />);
    const badge = screen.getByText("Trial");
    expect(badge.className).toContain("bg-blue");
    expect(badge.className).toContain("text-blue");
  });

  it("should render as a span element", () => {
    render(<StatusBadge variant="success" label="Active" />);
    const badge = screen.getByText("Active");
    expect(badge.tagName).toBe("SPAN");
  });

  it("should include common badge styles", () => {
    render(<StatusBadge variant="success" label="Active" />);
    const badge = screen.getByText("Active");
    expect(badge.className).toContain("rounded");
    expect(badge.className).toContain("font-medium");
    expect(badge.className).toContain("text-xs");
  });
});
