import { Timestamp } from "firebase-admin/firestore";
import { Collections } from "../config/collections";
import { db, serverTimestamp } from "../repositories/firestoreRepository";
import {
  getEffectiveActivationCodeStatus,
  getEffectiveLicenseStatus,
  getEffectiveSubscriptionStatus,
  isLiveBatch,
  sumLiveSeatLimit,
} from "../repositories/organizationRepository";
import { writeAuditLog } from "../repositories/auditLogRepository";
import type {
  Organization,
  OrganizationActivationCode,
  OrganizationLicense,
  OrganizationSubscription,
} from "../models/types";

/** Firestore caps a batch at 500 writes; leave headroom. */
const MAX_WRITES_PER_BATCH = 450;

export interface ExpirySweepResult {
  subscriptionsExpired: number;
  licensesExpired: number;
  codesExpired: number;
  entitlementsExpired: number;
  organizationsExpired: number;
  /** Activated seats released back to their school by expiring licenses. */
  seatsReleased: number;
  writes: number;
  durationMs: number;
}

/**
 * Accumulates writes across as many Firestore batches as needed.
 */
function createBatchWriter() {
  const batches: FirebaseFirestore.WriteBatch[] = [db.batch()];
  let writeCount = 0;
  let totalWrites = 0;

  return {
    add(fn: (batch: FirebaseFirestore.WriteBatch) => void) {
      if (writeCount >= MAX_WRITES_PER_BATCH) {
        batches.push(db.batch());
        writeCount = 0;
      }
      fn(batches[batches.length - 1]);
      writeCount++;
      totalWrites++;
    },
    async commit() {
      if (totalWrites === 0) return 0;
      for (const batch of batches) {
        await batch.commit();
      }
      return totalWrites;
    },
    get size() {
      return totalWrites;
    },
  };
}

/**
 * Materialises EXPIRED onto every past-due subscription, license and activation
 * code, and releases the activated seats those licenses were holding.
 *
 * This does NOT replace the read-time projection in organizationRepository —
 * getEffectiveLicenseStatus and friends remain the authority between sweeps and
 * are what keep the system correct if this job is disabled or fails. The sweep
 * exists so that stored status converges with reality, which is what queries
 * filtering on the raw field (and any external consumer, including the Android
 * app reading Firestore directly) actually see.
 *
 * Idempotent: only ever moves ACTIVE/UNUSED to EXPIRED, so re-running is a
 * no-op once converged.
 */
export async function runExpirySweep(
  options: { now?: Date; actorUid?: string } = {}
): Promise<ExpirySweepResult> {
  const startedAt = Date.now();
  const now = options.now ?? new Date();
  const actorUid = options.actorUid ?? "system:expiry-sweep";
  const nowTimestamp = Timestamp.fromDate(now);

  const [subscriptionsSnap, licensesSnap, codesSnap, orgsSnap] = await Promise.all([
    db.collection(Collections.organizationSubscriptions).get(),
    db.collection(Collections.organizationLicenses).get(),
    db.collection(Collections.organizationActivationCodes).get(),
    db.collection(Collections.organizations).get(),
  ]);

  const subscriptionById = new Map<string, OrganizationSubscription>();
  subscriptionsSnap.docs.forEach((doc) =>
    subscriptionById.set(doc.id, doc.data() as OrganizationSubscription)
  );
  const licenseById = new Map<string, OrganizationLicense>();
  licensesSnap.docs.forEach((doc) => licenseById.set(doc.id, doc.data() as OrganizationLicense));

  const writer = createBatchWriter();
  const result: ExpirySweepResult = {
    subscriptionsExpired: 0,
    licensesExpired: 0,
    codesExpired: 0,
    entitlementsExpired: 0,
    organizationsExpired: 0,
    seatsReleased: 0,
    writes: 0,
    durationMs: 0,
  };

  // 1. Subscriptions whose window has closed.
  subscriptionsSnap.docs.forEach((doc) => {
    const subscription = doc.data() as OrganizationSubscription;
    if (subscription.status !== "ACTIVE") return;
    if (getEffectiveSubscriptionStatus(subscription, now) !== "EXPIRED") return;

    writer.add((batch) => batch.update(doc.ref, { status: "EXPIRED", updatedAt: serverTimestamp() }));
    result.subscriptionsExpired++;
  });

  // A student accumulates many licences over time, but holds exactly ONE
  // entitlement document. Expiring a stale licence must therefore never be
  // allowed to speak for the student as a whole — that is what locked out
  // students who had a perfectly valid current licence alongside old ones.
  const licensesByStudent = new Map<string, OrganizationLicense[]>();
  licensesSnap.docs.forEach((doc) => {
    const license = doc.data() as OrganizationLicense;
    if (!license.studentUid) return;
    const bucket = licensesByStudent.get(license.studentUid);
    if (bucket) bucket.push(license);
    else licensesByStudent.set(license.studentUid, [license]);
  });

  const stillLiveAfterSweep = (studentUid: string, expiringLicenseIds: Set<string>) =>
    (licensesByStudent.get(studentUid) ?? []).some(
      (candidate) =>
        !expiringLicenseIds.has(candidate.licenseId) &&
        candidate.status === "ACTIVE" &&
        getEffectiveLicenseStatus(candidate, subscriptionById.get(candidate.subscriptionId), now) === "ACTIVE"
    );

  // 2. Licenses past their own expiry or covered by an expired subscription.
  //    ACTIVE -> EXPIRED also frees the seat the student was holding.
  const seatsReleasedByOrg = new Map<string, number>();
  const expiringLicenseIds = new Set<string>();
  const expiringWithStudent: OrganizationLicense[] = [];

  licensesSnap.docs.forEach((doc) => {
    const license = doc.data() as OrganizationLicense;
    if (license.status !== "ACTIVE" && license.status !== "UNUSED") return;

    const subscription = subscriptionById.get(license.subscriptionId);
    if (getEffectiveLicenseStatus(license, subscription, now) !== "EXPIRED") return;

    writer.add((batch) => batch.update(doc.ref, { status: "EXPIRED", updatedAt: serverTimestamp() }));
    result.licensesExpired++;
    expiringLicenseIds.add(license.licenseId);

    if (license.status === "ACTIVE") {
      seatsReleasedByOrg.set(
        license.organizationId,
        (seatsReleasedByOrg.get(license.organizationId) ?? 0) + 1
      );
      if (license.studentUid) expiringWithStudent.push(license);
    }
  });

  // 2b. Expire an entitlement only when the licence it actually points at is
  //     the one going away AND the student has nothing else still live.
  const entitlementsHandled = new Set<string>();
  for (const license of expiringWithStudent) {
    const studentUid = license.studentUid!;
    if (entitlementsHandled.has(studentUid)) continue;
    entitlementsHandled.add(studentUid);

    const entitlementRef = db.collection(Collections.userOrganizationEntitlements).doc(studentUid);
    const entitlementSnap = await entitlementRef.get();
    if (!entitlementSnap.exists) continue;

    const entitlement = entitlementSnap.data() as { status?: string; licenseId?: string };
    if (entitlement.status === "EXPIRED") continue;

    // Pointing at a different licence: this expiry does not describe them.
    if (entitlement.licenseId && !expiringLicenseIds.has(entitlement.licenseId)) continue;

    // Still holding a live licence elsewhere: leave access intact.
    if (stillLiveAfterSweep(studentUid, expiringLicenseIds)) continue;

    writer.add((batch) =>
      batch.set(
        entitlementRef,
        { status: "EXPIRED", serverCheckedAt: nowTimestamp, updatedAt: nowTimestamp },
        { merge: true }
      )
    );
    result.entitlementsExpired++;
  }

  // 3. Unredeemed codes whose coverage has lapsed.
  codesSnap.docs.forEach((doc) => {
    const code = doc.data() as OrganizationActivationCode;
    // DO NOT widen this to REDEEMED. A lapsed redeemed code *displays* as
    // EXPIRED via getEffectiveActivationCodeStatus, but its stored status must
    // stay REDEEMED: restoreCoverage() reads the stored value and would restore
    // anything not stored as REDEEMED back to UNUSED, making a code that a
    // student already used redeemable again.
    if (code.status !== "UNUSED") return;

    const subscription = subscriptionById.get(code.subscriptionId);
    const license = licenseById.get(code.licenseId);
    if (getEffectiveActivationCodeStatus(code, subscription, license, now) !== "EXPIRED") return;

    writer.add((batch) => batch.update(doc.ref, { status: "EXPIRED" }));
    result.codesExpired++;
  });

  // 4. Release seats, shrink the purchased-seat aggregate to the batches still live, and
  //    flag schools whose EVERY batch has ended. A school with one ended batch and one live
  //    batch stays ACTIVE: only the ended batch's students lose access.
  const subscriptionsByOrg = new Map<string, OrganizationSubscription[]>();
  subscriptionsSnap.docs.forEach((doc) => {
    const subscription = doc.data() as OrganizationSubscription;
    const bucket = subscriptionsByOrg.get(subscription.organizationId) ?? [];
    bucket.push(subscription);
    subscriptionsByOrg.set(subscription.organizationId, bucket);
  });

  orgsSnap.docs.forEach((doc) => {
    const org = doc.data() as Organization;
    const released = seatsReleasedByOrg.get(org.organizationId) ?? 0;
    const orgSubscriptions = subscriptionsByOrg.get(org.organizationId) ?? [];
    const hasBatches = orgSubscriptions.length > 0;
    const anyLive = orgSubscriptions.some((subscription) => isLiveBatch(subscription, now));
    const shouldExpireOrg = org.status === "ACTIVE" && hasBatches && !anyLive;

    const livePurchased = sumLiveSeatLimit(orgSubscriptions, now);
    const purchasedChanged =
      hasBatches && org.status !== "ARCHIVED" && org.status !== "SUSPENDED" && (org.purchasedSeats ?? 0) !== livePurchased;

    if (released === 0 && !shouldExpireOrg && !purchasedChanged) return;

    const update: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (released > 0) {
      update.activatedSeats = Math.max(0, (org.activatedSeats ?? 0) - released);
      result.seatsReleased += released;
    }
    if (purchasedChanged) {
      update.purchasedSeats = livePurchased;
    }
    if (shouldExpireOrg) {
      update.status = "EXPIRED";
      result.organizationsExpired++;
    }

    writer.add((batch) => batch.update(doc.ref, update));
  });

  result.writes = await writer.commit();
  result.durationMs = Date.now() - startedAt;

  if (result.writes > 0) {
    await writeAuditLog({
      actorUid,
      actorRole: "SYSTEM",
      action: "EXPIRY_SWEEP_COMPLETED",
      organizationId: null,
      targetType: "system",
      targetId: "expiry-sweep",
      metadata: { ...result },
    });
  }

  return result;
}
