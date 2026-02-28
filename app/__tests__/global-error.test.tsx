import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GlobalError from "../global-error";

describe("GlobalError", () => {
  afterEach(cleanup);
  it("should render heading", () => {
    render(
      <GlobalError error={new Error("test")} reset={() => {}} />
    );
    expect(screen.getByText("Something went wrong")).toBeDefined();
  });

  it("should call reset when button is clicked", async () => {
    const resetFn = vi.fn();
    const user = userEvent.setup();
    render(<GlobalError error={new Error("test")} reset={resetFn} />);

    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(resetFn).toHaveBeenCalledOnce();
  });
});
