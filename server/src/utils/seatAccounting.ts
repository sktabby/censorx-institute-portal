import type { LicenseStatus } from "../models/types";

/**
 * Single source of truth for seat arithmetic.
 *
 * Every seat number surfaced by the API — admin dashboard, school dashboard,
 * organization detail, and the code-generation capacity gate — is produced
 * here. Clients render these values and must not recompute them locally;
 * that is what previously allowed the three divergent formulas to drift.
 *
 * All inputs are EFFECTIVE license statuses (see getEffectiveLicenseStatus),
 * never the raw stored status, so past-due licenses stop consuming seats even
 * before the expiry sweep has materialised them.
 */
export interface SeatUsage {
  /** Licenses that exist and are not soft-deleted. */
  totalSeats: number;
  /** Licenses currently redeemed and still within their coverage window. */
  activatedSeats: number;
  /** Generated-but-unredeemed licenses still within their coverage window. */
  unusedCodes: number;
  /** Licenses past their coverage window. */
  expiredSeats: number;
  /** Licenses revoked by an admin. */
  revokedSeats: number;
  /** Contractual cap from the subscription; 0 when there is no subscription. */
  seatLimit: number;
  /** Seats left to hand out: seatLimit - activated - unused. Never negative. */
  remainingCapacity: number;
  /** Seats not currently held by a student: seatLimit - activated. Never negative. */
  availableSeats: number;
}

/**
 * The one capacity formula. Unused codes are already-committed seats: they
 * have been handed to a school and may be redeemed at any time, so they are
 * subtracted alongside activated seats.
 */
export function calculateRemainingCapacity(
  seatLimit: number,
  activatedSeats: number,
  unusedCodes: number
): number {
  return Math.max(0, seatLimit - activatedSeats - unusedCodes);
}

export function calculateAvailableSeats(seatLimit: number, activatedSeats: number): number {
  return Math.max(0, seatLimit - activatedSeats);
}

/**
 * Derives seat totals from effective license statuses.
 *
 * Total seats deliberately counts REVOKED and EXPIRED licenses: a seat that
 * was issued still represents a provisioned seat for reporting purposes.
 * Only DELETED (soft-deleted) licenses drop out entirely.
 */
export function buildSeatUsage(input: {
  effectiveStatuses: LicenseStatus[];
  seatLimit: number;
}): SeatUsage {
  let totalSeats = 0;
  let activatedSeats = 0;
  let unusedCodes = 0;
  let expiredSeats = 0;
  let revokedSeats = 0;

  for (const status of input.effectiveStatuses) {
    if (status === "DELETED") continue;
    totalSeats++;
    if (status === "ACTIVE") activatedSeats++;
    else if (status === "UNUSED") unusedCodes++;
    else if (status === "EXPIRED") expiredSeats++;
    else if (status === "REVOKED") revokedSeats++;
  }

  const seatLimit = Math.max(0, input.seatLimit);

  return {
    totalSeats,
    activatedSeats,
    unusedCodes,
    expiredSeats,
    revokedSeats,
    seatLimit,
    remainingCapacity: calculateRemainingCapacity(seatLimit, activatedSeats, unusedCodes),
    availableSeats: calculateAvailableSeats(seatLimit, activatedSeats),
  };
}

/** Adds two usage summaries — used for cross-organization dashboard totals. */
export function mergeSeatUsage(a: SeatUsage, b: SeatUsage): SeatUsage {
  const seatLimit = a.seatLimit + b.seatLimit;
  const activatedSeats = a.activatedSeats + b.activatedSeats;
  const unusedCodes = a.unusedCodes + b.unusedCodes;

  return {
    totalSeats: a.totalSeats + b.totalSeats,
    activatedSeats,
    unusedCodes,
    expiredSeats: a.expiredSeats + b.expiredSeats,
    revokedSeats: a.revokedSeats + b.revokedSeats,
    seatLimit,
    remainingCapacity: calculateRemainingCapacity(seatLimit, activatedSeats, unusedCodes),
    availableSeats: calculateAvailableSeats(seatLimit, activatedSeats),
  };
}

export const EMPTY_SEAT_USAGE: SeatUsage = buildSeatUsage({ effectiveStatuses: [], seatLimit: 0 });
