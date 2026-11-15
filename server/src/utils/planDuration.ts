import type { PlanDuration } from "../models/types";

/** Returns milliseconds for standard plan durations. CUSTOM relies on caller-supplied dates. */
export function planDurationToMs(plan: PlanDuration): number | null {
  const DAY = 24 * 60 * 60 * 1000;
  switch (plan) {
    case "MONTHLY":
      return 30 * DAY;
    case "THREE_MONTHS":
      return 90 * DAY;
    case "SIX_MONTHS":
      return 182 * DAY;
    case "YEARLY":
      return 365 * DAY;
    case "CUSTOM":
    default:
      return null;
  }
}

/**
 * Whole months a batch is billed for: 1, 3, 6 or 12 for the standard plans, and for custom
 * dates the days between them ÷ 30.4375 rounded to the nearest month (at least 1).
 * Must stay identical to client/src/utils/planDuration.ts → billingMonths.
 */
export function billingMonths(plan: PlanDuration, startAt: Date, expiresAt: Date): number {
  switch (plan) {
    case "MONTHLY":
      return 1;
    case "THREE_MONTHS":
      return 3;
    case "SIX_MONTHS":
      return 6;
    case "YEARLY":
      return 12;
    default: {
      const days = (expiresAt.getTime() - startAt.getTime()) / (24 * 60 * 60 * 1000);
      return Math.max(1, Math.round(days / 30.4375));
    }
  }
}
