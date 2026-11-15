import { Collections } from "../config/collections";
import { logger } from "../config/logger";
import { planName } from "../config/company";
import { db } from "../repositories/firestoreRepository";
import { billingMonths } from "../utils/planDuration";
import type { OrganizationSubscription } from "../models/types";

/**
 * Students on one batch period: licences of that period that a student redeemed and that were
 * not withdrawn. Read-only, used for the numbers in school emails. Returns null when the count
 * cannot be read, so an email is never blocked by it.
 */
export async function countStudentsOnSubscription(organizationId: string, subscriptionId: string): Promise<number | null> {
  try {
    const snap = await db
      .collection(Collections.organizationLicenses)
      .where("organizationId", "==", organizationId)
      .where("subscriptionId", "==", subscriptionId)
      .get();
    return snap.docs.filter((doc) => {
      const license = doc.data() as { studentUid?: string | null; status?: string };
      return !!license.studentUid && (license.status === "ACTIVE" || license.status === "EXPIRED");
    }).length;
  } catch (err) {
    logger.warn({ err, organizationId, subscriptionId }, "Student count for an email could not be read");
    return null;
  }
}

/** The plan name schools see for a batch period, e.g. "Yearly" or, for a custom window, "7-month". */
export function subscriptionPlanName(subscription: Pick<OrganizationSubscription, "planDuration" | "startAt" | "expiresAt">): string {
  try {
    return planName(
      subscription.planDuration,
      billingMonths(subscription.planDuration, subscription.startAt.toDate(), subscription.expiresAt.toDate())
    );
  } catch {
    return planName(subscription.planDuration);
  }
}
