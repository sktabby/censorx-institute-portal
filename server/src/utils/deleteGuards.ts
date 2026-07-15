import type { ActivationCodeStatus } from "../models/types";

const ACTIVE_CODE_STATUSES = new Set<ActivationCodeStatus>(["UNUSED", "REDEEMED"]);

export function isSchoolNameConfirmationValid(typedSchoolName: string, schoolName: string): boolean {
  return typedSchoolName.trim() === schoolName.trim();
}

export function hasActiveCodeStatuses(statuses: ActivationCodeStatus[]): boolean {
  return statuses.some((status) => ACTIVE_CODE_STATUSES.has(status));
}
