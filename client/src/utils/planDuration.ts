export const planOptions = ["MONTHLY", "THREE_MONTHS", "SIX_MONTHS", "YEARLY", "CUSTOM"] as const;

export type PlanDuration = (typeof planOptions)[number];

export function isPlanDuration(value: string | null | undefined): value is PlanDuration {
  return planOptions.includes(value as PlanDuration);
}

/** Keep duration values aligned with server/src/utils/planDuration.ts. */
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

export function formatDateInput(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dateInputToDate(value: string): Date | null {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

/**
 * Whole months a batch is billed for. Must stay identical to
 * server/src/utils/planDuration.ts → billingMonths (the server re-checks the bill).
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

export function calculatePlanExpiryDate(startDate: string, plan: PlanDuration) {
  const durationMs = planDurationToMs(plan);
  const start = dateInputToDate(startDate);
  if (!durationMs || !start) return "";
  return formatDateInput(new Date(start.getTime() + durationMs));
}
