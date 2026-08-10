import { describe, expect, it } from "vitest";
import {
  buildSeatUsage,
  calculateAvailableSeats,
  calculateRemainingCapacity,
  mergeSeatUsage,
  EMPTY_SEAT_USAGE,
} from "../seatAccounting";
import type { LicenseStatus } from "../../models/types";

describe("calculateRemainingCapacity", () => {
  it("subtracts both activated seats and outstanding unused codes", () => {
    expect(calculateRemainingCapacity(100, 30, 20)).toBe(50);
  });

  it("never returns a negative capacity when the limit is oversubscribed", () => {
    expect(calculateRemainingCapacity(10, 8, 5)).toBe(0);
  });

  it("returns zero for a school with no subscription", () => {
    expect(calculateRemainingCapacity(0, 0, 0)).toBe(0);
  });
});

describe("calculateAvailableSeats", () => {
  it("ignores unused codes and counts only redeemed seats", () => {
    expect(calculateAvailableSeats(100, 30)).toBe(70);
  });

  it("clamps at zero", () => {
    expect(calculateAvailableSeats(5, 9)).toBe(0);
  });
});

describe("buildSeatUsage", () => {
  const statuses = (list: LicenseStatus[]) => list;

  it("derives total seats as every license that is not soft-deleted", () => {
    const usage = buildSeatUsage({
      effectiveStatuses: statuses(["ACTIVE", "UNUSED", "EXPIRED", "REVOKED", "DELETED"]),
      seatLimit: 10,
    });

    expect(usage.totalSeats).toBe(4);
    expect(usage.activatedSeats).toBe(1);
    expect(usage.unusedCodes).toBe(1);
    expect(usage.expiredSeats).toBe(1);
    expect(usage.revokedSeats).toBe(1);
  });

  it("stops counting expired licenses as activated seats", () => {
    const before = buildSeatUsage({ effectiveStatuses: statuses(["ACTIVE", "ACTIVE"]), seatLimit: 10 });
    const after = buildSeatUsage({ effectiveStatuses: statuses(["ACTIVE", "EXPIRED"]), seatLimit: 10 });

    expect(before.activatedSeats).toBe(2);
    expect(after.activatedSeats).toBe(1);
    expect(after.availableSeats).toBe(9);
    // The expired seat is freed for reuse rather than being held forever.
    expect(after.remainingCapacity).toBe(9);
  });

  it("charges unused codes against remaining capacity but not against available seats", () => {
    const usage = buildSeatUsage({
      effectiveStatuses: statuses(["ACTIVE", "UNUSED", "UNUSED"]),
      seatLimit: 10,
    });

    expect(usage.remainingCapacity).toBe(7);
    expect(usage.availableSeats).toBe(9);
  });

  it("treats an empty school as fully empty", () => {
    expect(buildSeatUsage({ effectiveStatuses: [], seatLimit: 0 })).toEqual(EMPTY_SEAT_USAGE);
  });

  it("never reports negative seat limits", () => {
    expect(buildSeatUsage({ effectiveStatuses: [], seatLimit: -5 }).seatLimit).toBe(0);
  });
});

describe("mergeSeatUsage", () => {
  it("sums organizations and recomputes capacity from the merged totals", () => {
    const a = buildSeatUsage({ effectiveStatuses: ["ACTIVE", "UNUSED"], seatLimit: 10 });
    const b = buildSeatUsage({ effectiveStatuses: ["ACTIVE", "EXPIRED"], seatLimit: 5 });
    const merged = mergeSeatUsage(a, b);

    expect(merged.totalSeats).toBe(4);
    expect(merged.activatedSeats).toBe(2);
    expect(merged.unusedCodes).toBe(1);
    expect(merged.expiredSeats).toBe(1);
    expect(merged.seatLimit).toBe(15);
    expect(merged.remainingCapacity).toBe(12);
    expect(merged.availableSeats).toBe(13);
  });

  it("is identity-preserving against an empty usage", () => {
    const a = buildSeatUsage({ effectiveStatuses: ["ACTIVE"], seatLimit: 3 });
    expect(mergeSeatUsage(EMPTY_SEAT_USAGE, a)).toEqual(a);
  });
});
