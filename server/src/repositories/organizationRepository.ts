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

type SubscriptionWindow = Pick<OrganizationSubscription, "status" | "expiresAt">;

/**
 * A batch period that currently counts for the school: stored ACTIVE and still inside its
 * window. RENEWED periods are excluded even when inside their window — the period that
 * renewed them carries their seats and classes now — and CANCELLED/SUSPENDED never count.
 */
export function isLiveBatch(subscription: SubscriptionWindow | null | undefined, now = new Date()): boolean {
  if (!subscription) return false;
  return getEffectiveSubscriptionStatus(subscription, now) === "ACTIVE";
}

/**
 * School status from ALL of its batches:
 *   - SUSPENDED / ARCHIVED set by an admin always win;
 *   - ACTIVE while at least one batch is live;
 *   - EXPIRED only once every batch has ended (or was cancelled);
 *   - a school with no batch yet keeps its stored status.
 *
 * Accepts a single subscription too, for callers that only know about one.
 */
export function getEffectiveOrganizationStatus(
  organization: Pick<Organization, "status">,
  subscriptions: SubscriptionWindow | SubscriptionWindow[] | null | undefined,
  now = new Date()
): OrganizationStatus {
  if (organization.status === "SUSPENDED" || organization.status === "ARCHIVED") {
    return organization.status;
  }
  const list = Array.isArray(subscriptions) ? subscriptions : subscriptions ? [subscriptions] : [];
  if (list.length === 0) return organization.status;
  return list.some((subscription) => isLiveBatch(subscription, now)) ? "ACTIVE" : "EXPIRED";
}

/** Seats of every live batch added together — what the school has bought and can still use. */
export function sumLiveSeatLimit(
  subscriptions: Array<SubscriptionWindow & Pick<OrganizationSubscription, "seatLimit">>,
  now = new Date()
): number {
  return subscriptions.reduce((sum, subscription) => sum + (isLiveBatch(subscription, now) ? subscription.seatLimit : 0), 0);
}

function timestampMillis(value: unknown): number {
  if (value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as FirebaseFirestore.Timestamp).toMillis();
  }
  return 0;
}

/** Every batch period of a school, statuses projected to read time, oldest first. */
export async function listOrganizationSubscriptions(
  organizationId: string,
  now = new Date()
): Promise<OrganizationSubscription[]> {
  const snap = await subscriptions().where("organizationId", "==", organizationId).get();
  return snap.docs
    .map((doc) => withEffectiveSubscriptionStatus(doc.data() as OrganizationSubscription, now))
    .sort((a, b) => timestampMillis(a.createdAt) - timestampMillis(b.createdAt));
}

/**
 * The batch an admin most likely means when they say "the school's plan": the live batch that
 * ends last, else the most recently created period. Null for a school with no batch.
 */
export function pickPrimarySubscription(
  list: OrganizationSubscription[],
  now = new Date()
): OrganizationSubscription | null {
  if (list.length === 0) return null;
  const live = list.filter((subscription) => isLiveBatch(subscription, now));
  if (live.length > 0) {
    return live.reduce((best, candidate) =>
      candidate.expiresAt.toMillis() > best.expiresAt.toMillis() ? candidate : best
    );
  }
  return list.reduce((best, candidate) =>
    timestampMillis(candidate.createdAt) >= timestampMillis(best.createdAt) ? candidate : best
  );
}

/** One batch period by id, scoped to the school. Status is projected to read time. */
export async function getSubscriptionById(
  organizationId: string,
  subscriptionId: string,
  now = new Date()
): Promise<OrganizationSubscription | null> {
  const snap = await subscriptions().doc(subscriptionId).get();
  if (!snap.exists) return null;
  const subscription = snap.data() as OrganizationSubscription;
  if (subscription.organizationId !== organizationId) return null;
  return withEffectiveSubscriptionStatus(subscription, now);
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

/**
 * The school's primary batch (see pickPrimarySubscription). Kept under its old name because
 * many callers only need "the plan to show"; anything that acts on a batch must take an explicit
 * subscriptionId instead.
 */
export async function getActiveSubscription(organizationId: string): Promise<OrganizationSubscription | null> {
  return pickPrimarySubscription(await listOrganizationSubscriptions(organizationId));
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
 * School-wide seat usage: every licence of the school, against the seats of every live batch
 * added together. This is the only place school-wide seat usage is produced for read paths;
 * the stored organization.purchasedSeats / activatedSeats counters remain solely as the
 * transaction-local guard used by redemption.
 *
 * Pass `scope` to measure against a different seat limit (used while a batch is being changed
 * and its new limit is not stored yet).
 */
export async function getOrganizationSeatUsage(
  organizationId: string,
  scope?: Pick<OrganizationSubscription, "seatLimit"> | null
): Promise<SeatUsage> {
  const [licenses, allSubscriptions] = await Promise.all([
    listOrganizationLicenses(organizationId),
    scope === undefined ? listOrganizationSubscriptions(organizationId) : Promise.resolve([]),
  ]);

  return buildSeatUsage({
    effectiveStatuses: licenses.map((license) => license.status),
    seatLimit: scope === undefined ? sumLiveSeatLimit(allSubscriptions) : scope?.seatLimit ?? 0,
  });
}

/**
 * Seat usage of ONE batch: only the licences sitting on that period, against that period's own
 * seat limit. Code generation gates on this, so one batch can never spend another's seats.
 */
export async function getSubscriptionSeatUsage(
  organizationId: string,
  subscription: Pick<OrganizationSubscription, "subscriptionId" | "seatLimit">
): Promise<SeatUsage> {
  const licenses = await listOrganizationLicenses(organizationId);
  return buildSeatUsage({
    effectiveStatuses: licenses
      .filter((license) => license.subscriptionId === subscription.subscriptionId)
      .map((license) => license.status),
    seatLimit: subscription.seatLimit,
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
