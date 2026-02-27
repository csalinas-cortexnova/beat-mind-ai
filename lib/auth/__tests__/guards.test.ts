// @vitest-environment node
import { describe, it, expect } from "vitest";
import { requireGymContext } from "../guards";

describe("requireGymContext (stub)", () => {
  it("should throw an error indicating it is a stub", () => {
    expect(() => requireGymContext()).toThrow(
      "requireGymContext() is a stub. Implement in Spec 02 (Authentication & Authorization)."
    );
  });

  it("should throw an Error instance", () => {
    expect(() => requireGymContext()).toThrowError(Error);
  });
});
