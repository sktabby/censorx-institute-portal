import { Collections } from "../config/collections";
import { collection } from "./firestoreRepository";
import { buildSeatUsage, type SeatUsage } from "../utils/seatAccounting";
import type {
  Organization,
  OrganizationSubscription,
  OrganizationLicense,
  OrganizationActivationCode,
  OrganizationStatus,
  SubscriptionStatus,
  LicenseStatus,
  ActivationCodeStatus,
} from "../models/types";

export const organizations = () => collection<Organization>(Collections.organizations);
export const subscriptions = () => collection<OrganizationSubscription>(Collections.organizationSubscriptions);
export const licenses = () => collection<OrganizationLicense>(Collections.organizationLicenses);
export const activationCodes = () => collection<OrganizationActivationCode>(Collections.organizationActivationCodes);

export async function getOrganization(organizationId: string): Promise<Organization | null> {
  const snap = await organizations().doc(organizationId).get();
  return snap.exists ? (snap.data() as Organization) : null;
}

export function getEffectiveSubscriptionStatus(
  subscription: Pick<OrganizationSubscription, "status" | "expiresAt">,
  now = new Date()
): SubscriptionStatus {
  if (subscription.status === "ACTIVE" && subscription.expiresAt.toMillis() <= now.getTime()) {
    return "EXPIRED";
  }
  return subscription.status;
}

/**
 * Admin states that withdraw service regardless of the remaining window.
 *
 * CANCELLED and SUSPENDED cutting access off IMMEDIATELY is a deliberate
 * product decision, confirmed 2026-08-05 — not an incidental side effect.
 * "Cancel" means access stops now, even if the school has paid-for time left.
 * Do not "fix" this to honour the remaining window.
 */
const COVERAGE_DENYING_STATUSES = new Set<SubscriptionStatus>(["CANCELLED", "SUSPENDED", "EXPIRED"]);

/**
 * Whether a subscription still entitles its licences to access.
 *
 * This is the access-control predicate, deliberately separate from
 * getEffectiveSubscriptionStatus (which exists for display and must keep
 * reporting RENEWED as RENEWED in the history view).
 *
 * RENEWED means "superseded by a newer subscription", NOT "lapsed". A renewal
 * that supersedes a subscription does not shorten the window the school
 * already paid for, so a RENEWED subscription keeps providing coverage until
 * its own expiresAt passes. Requiring the literal status "ACTIVE" here is what
 * locked out students whose licences were left on a superseded-but-valid
 * subscription.
 */
export function subscriptionProvidesCoverage(
  subscription: Pick<OrganizationSubscription, "status" | "expiresAt"> | null | undefined,
  now = new Date()
): boolean {
  if (!subscription) return false;
  if (COVERAGE_DENYING_STATUSES.has(subscription.status)) return false;
  return subscription.expiresAt.toMillis() > now.getTime();
}

export function withEffectiveSubscriptionStatus(subscription: OrganizationSubscription, now = new Date()): OrganizationSubscription {
  // Computed read-time value only: Firestore's stored status is not
  // automatically mutated when time passes. This mirrors the license expiry
  // checks elsewhere, where expiry is evaluated against server time on read.
  return { ...subscription, status: getEffectiveSubscriptionStatus(subscription, now) };
}

export function getEffectiveOrganizationStatus(
  organization: Pick<Organization, "status">,
  subscription: Pick<OrganizationSubscription, "status" | "expiresAt"> | null | undefined,
  now = new Date()
): OrganizationStatus {
  if (organization.status === "SUSPENDED" || organization.status === "ARCHIVED") {
    return organization.status;
  }
  if (subscription && getEffectiveSubscriptionStatus(subscription, now) === "EXPIRED") {
    return "EXPIRED";
  }
  return organization.status;
}

function isExpiredCoverage(
  subscription: Pick<OrganizationSubscription, "status" | "expiresAt"> | null | undefined,
  license: Pick<OrganizationLicense, "expiresAt"> | null | undefined,
  now: Date
) {
  // Uses the coverage predicate, not the display status: a RENEWED subscription
  // still inside its window keeps its licences alive, while a RENEWED one past
  // its window (previously invisible here) now correctly expires them.
  return (
    (subscription ? !subscriptionProvidesCoverage(subscription, now) : false) ||
    (license ? license.expiresAt.toMillis() <= now.getTime() : false)
  );
}

export function getEffectiveLicenseStatus(
  license: Pick<OrganizationLicense, "status" | "expiresAt">,
  subscription: Pick<OrganizationSubscription, "status" | "expiresAt"> | null | undefined,
  now = new Date()
): LicenseStatus {
  if ((license.status === "UNUSED" || license.status === "ACTIVE") && isExpiredCoverage(subscription, license, now)) {
    return "EXPIRED";
  }
  return license.status;
}

export function withEffectiveLicenseStatus(
  license: OrganizationLicense,
  subscription: Pick<OrganizationSubscription, "status" | "expiresAt"> | null | undefined,
  now = new Date()
): OrganizationLicense {
  return { ...license, status: getEffectiveLicenseStatus(license, subscription, now) };
}

/**
 * DISPLAY-ONLY projection. Both UNUSED and REDEEMED codes read as EXPIRED once
 * their coverage lapses, so two codes on the same dead subscription never show
 * different statuses to an admin.
 *
 * This must never be written back to Firestore. restoreCoverage() branches on
 * the STORED status to decide whether a code returns to UNUSED on renewal; if
 * EXPIRED were persisted over a stored REDEEMED, an already-used code would be
 * restored as redeemable. The sweep therefore skips non-UNUSED codes, and
 * stored REDEEMED stays REDEEMED forever.
 */
export function getEffectiveActivationCodeStatus(
  code: Pick<OrganizationActivationCode, "status">,
  subscription: Pick<OrganizationSubscription, "status" | "expiresAt"> | null | undefined,
  license: Pick<OrganizationLicense, "status" | "expiresAt"> | null | undefined,
  now = new Date()
): ActivationCodeStatus {
  const coverageBound = code.status === "UNUSED" || code.status === "REDEEMED";
  if (coverageBound && isExpiredCoverage(subscription, license, now)) {
    return "EXPIRED";
  }
  return code.status;
}

export function withEffectiveActivationCodeStatus(
  code: OrganizationActivationCode,
  subscription: Pick<OrganizationSubscription, "status" | "expiresAt"> | null | undefined,
  license: Pick<OrganizationLicense, "status" | "expiresAt"> | null | undefined,
  now = new Date()
): OrganizationActivationCode {
  return { ...code, status: getEffectiveActivationCodeStatus(code, subscription, license, now) };
}

export async function getCurrentSubscription(
  organizationId: string,
  options: { effectiveStatus?: boolean } = {}
): Promise<OrganizationSubscription | null> {
  const org = await getOrganization(organizationId);
  if (!org?.currentSubscriptionId) return null;
  const snap = await subscriptions().doc(org.currentSubscriptionId).get();
  if (!snap.exists) return null;

  const subscription = snap.data() as OrganizationSubscription;
  return options.effectiveStatus === false ? subscription : withEffectiveSubscriptionStatus(subscription);
}

export async function getActiveSubscription(organizationId: string): Promise<OrganizationSubscription | null> {
  return getCurrentSubscription(organizationId);
}

export async function listOrganizationCodes(organizationId: string, limit?: number) {
  let query: FirebaseFirestore.Query<OrganizationActivationCode> = activationCodes().where("organizationId", "==", organizationId);
  if (limit) query = query.limit(limit);
  const [codesSnap, licensesSnap, subscriptionsSnap] = await Promise.all([
    query.get(),
    licenses().where("organizationId", "==", organizationId).get(),
    subscriptions().where("organizationId", "==", organizationId).get(),
  ]);
  const now = new Date();
  const licenseById = new Map<string, OrganizationLicense>();
  licensesSnap.docs.forEach((doc) => licenseById.set(doc.id, doc.data() as OrganizationLicense));
  const subscriptionById = new Map<string, OrganizationSubscription>();
  subscriptionsSnap.docs.forEach((doc) => subscriptionById.set(doc.id, doc.data() as OrganizationSubscription));

  return codesSnap.docs.map((d) => {
    const code = d.data();
    return withEffectiveActivationCodeStatus(
      code,
      subscriptionById.get(code.subscriptionId),
      licenseById.get(code.licenseId),
      now
    );
  });
}

/**
 * Loads a school's licenses once and derives every seat number from their
 * effective statuses. This is the only place seat usage is produced for
 * read paths; the stored organization.purchasedSeats / activatedSeats
 * counters remain solely as the transaction-local guard used by redemption.
 */
export async function getOrganizationSeatUsage(
  organizationId: string,
  subscription?: Pick<OrganizationSubscription, "seatLimit"> | null
): Promise<SeatUsage> {
  const [licenses, currentSubscription] = await Promise.all([
    listOrganizationLicenses(organizationId),
    subscription === undefined ? getCurrentSubscription(organizationId) : Promise.resolve(subscription),
  ]);

  return buildSeatUsage({
    effectiveStatuses: licenses.map((license) => license.status),
    seatLimit: currentSubscription?.seatLimit ?? 0,
  });
}

export async function listOrganizationLicenses(organizationId: string, limit?: number) {
  let query: FirebaseFirestore.Query<OrganizationLicense> = licenses().where("organizationId", "==", organizationId);
  if (limit) query = query.limit(limit);
  const [licensesSnap, subscriptionsSnap] = await Promise.all([
    query.get(),
    subscriptions().where("organizationId", "==", organizationId).get(),
  ]);
  const now = new Date();
  const subscriptionById = new Map<string, OrganizationSubscription>();
  subscriptionsSnap.docs.forEach((doc) => subscriptionById.set(doc.id, doc.data() as OrganizationSubscription));

  return licensesSnap.docs.map((d) => {
    const license = d.data();
    return withEffectiveLicenseStatus(license, subscriptionById.get(license.subscriptionId), now);
  });
}
