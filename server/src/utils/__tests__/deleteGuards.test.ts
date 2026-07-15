import { describe, expect, it } from "vitest";
import { hasActiveCodeStatuses, isSchoolNameConfirmationValid } from "../deleteGuards";

describe("delete guards", () => {
  it("requires the exact school name for sheet deletion confirmation", () => {
    expect(isSchoolNameConfirmationValid("Moonstar Academy", "Moonstar Academy")).toBe(true);
    expect(isSchoolNameConfirmationValid("moonstar academy", "Moonstar Academy")).toBe(false);
  });

  it("blocks school deletion when active code statuses remain", () => {
    expect(hasActiveCodeStatuses(["UNUSED"])).toBe(true);
    expect(hasActiveCodeStatuses(["REDEEMED"])).toBe(true);
    expect(hasActiveCodeStatuses(["DELETED", "REVOKED", "EXPIRED"])).toBe(false);
  });
});
