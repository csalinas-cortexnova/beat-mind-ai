import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ErrorPage from "../error";

describe("ErrorPage", () => {
  afterEach(cleanup);
  it("should render heading", () => {
    render(
      <ErrorPage error={new Error("test")} reset={() => {}} />
    );
    expect(screen.getByText("Something went wrong")).toBeDefined();
  });

  it("should NOT show error.message or stack", () => {
    const err = new Error("secret internal error");
    render(<ErrorPage error={err} reset={() => {}} />);

    expect(screen.queryByText("secret internal error")).toBeNull();
    expect(screen.queryByText(/at /)).toBeNull(); // no stack traces
  });

  it("should show error digest when available", () => {
    const err = Object.assign(new Error("test"), { digest: "abc123" });
    render(<ErrorPage error={err} reset={() => {}} />);

    expect(screen.getByText(/abc123/)).toBeDefined();
  });

  it("should call reset when button is clicked", async () => {
    const resetFn = vi.fn();
    const user = userEvent.setup();
    render(<ErrorPage error={new Error("test")} reset={resetFn} />);

    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(resetFn).toHaveBeenCalledOnce();
  });
});
