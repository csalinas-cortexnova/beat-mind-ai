import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import NotFound from "../not-found";

describe("NotFound", () => {
  afterEach(cleanup);

  it("should render 404 text", () => {
    render(<NotFound />);
    expect(screen.getByText("404")).toBeDefined();
    expect(screen.getByText("Page not found")).toBeDefined();
  });

  it("should have a link to home page", () => {
    render(<NotFound />);
    const link = screen.getByRole("link", { name: /go home/i });
    expect(link.getAttribute("href")).toBe("/");
  });
});
