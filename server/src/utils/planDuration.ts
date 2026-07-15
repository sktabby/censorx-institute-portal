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
