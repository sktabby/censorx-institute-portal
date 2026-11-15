import { Timestamp } from "firebase-admin/firestore";
import { Collections } from "../config/collections";
import { db, serverTimestamp } from "../repositories/firestoreRepository";
import { getEffectiveLicenseStatus } from "../repositories/organizationRepository";
import type {
  ActivationCodeStatus,
  LicenseStatus,
  OrganizationActivationCode,
  OrganizationLicense,
  OrganizationSubscription,
} from "../models/types";

/** Firestore caps a batch at 500 writes; leave headroom. */
const MAX_WRITES_PER_BATCH = 450;

const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** Statuses an admin action put a license into — never revived by a renewal. */
const TERMINAL_LICENSE_STATUSES = new Set<LicenseStatus>(["REVOKED", "DELETED"]);
const TERMINAL_CODE_STATUSES = new Set<ActivationCodeStatus>(["REVOKED", "REPLACED", "DELETED"]);

export interface RestoreCoverageInput {
  organizationId: string;
  /** Subscription the restored licenses/codes will be attached to. */
  targetSubscriptionId: string;
  /** New coverage end date written onto each restored license. */
  expiresAt: Timestamp;
  /**
   * Restrict the restore to these classes (sheet names). Omit, together with
   * subscriptionIds, to restore every non-terminal license in the school.
   */
  batchNames?: string[];
  /**
   * Restrict the restore to licences sitting on these batch periods. This is how a
   * batch renewal moves exactly its own classes onto the new period and nothing else.
   * When both filters are given a licence must match both.
   */
  subscriptionIds?: string[];
  actorUid: string;
}

export interface RestoreCoverageResult {
  licensesRestored: number;
  codesRestored: number;
  entitlementsRestored: number;
  /** Licenses that came back as ACTIVE because a student already holds them. */
  studentsReactivated: number;
  /** Recomputed activated-seat count for the school after the restore. */
  activatedSeats: number;
  batchNames: string[];
}

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
  };
}

export interface CarryOverResult {
  licensesCarried: number;
  codesCarried: number;
  entitlementsCarried: number;
}

/**
 * Moves licences that are still valid off a superseded subscription onto the
 * one that replaced it, WITHOUT changing their own expiresAt.
 *
 * A renewal marks the previous subscription RENEWED even when it renews no
 * batches (e.g. a seat-only allocation). That stranded every existing licence
 * on a superseded subscription. Coverage is preserved by the Step 1 model, but
 * leaving licences pointing at a superseded record is fragile — each further
 * renewal pushes them another link down a dead chain.
 *
 * expiresAt is deliberately untouched: carrying a licence over must not grant
 * free extra time to a batch that was not renewed. Effective coverage remains
 * the earlier of the licence's own date and the new subscription's window.
 */
export async function carryOverStrandedLicenses(input: {
  organizationId: string;
  fromSubscriptionId: string;
  toSubscriptionId: string;
}): Promise<CarryOverResult> {
  const result: CarryOverResult = { licensesCarried: 0, codesCarried: 0, entitlementsCarried: 0 };
  if (input.fromSubscriptionId === input.toSubscriptionId) return result;

  const now = Timestamp.now();
  const [licensesSnap, codesSnap] = await Promise.all([
    db
      .collection(Collections.organizationLicenses)
      .where("organizationId", "==", input.organizationId)
      .where("subscriptionId", "==", input.fromSubscriptionId)
      .get(),
    db
      .collection(Collections.organizationActivationCodes)
      .where("organizationId", "==", input.organizationId)
      .where("subscriptionId", "==", input.fromSubscriptionId)
      .get(),
  ]);

  if (licensesSnap.empty && codesSnap.empty) return result;

  const codesByLicenseId = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  codesSnap.docs.forEach((doc) => {
    const code = doc.data() as OrganizationActivationCode;
    codesByLicenseId.set(code.licenseId, doc as FirebaseFirestore.QueryDocumentSnapshot);
  });

  const writer = createBatchWriter();

  for (const licenseDoc of licensesSnap.docs) {
    const license = licenseDoc.data() as OrganizationLicense;
    if (TERMINAL_LICENSE_STATUSES.has(license.status)) continue;
    // Only carry licences that are genuinely still live on their own terms.
    if (license.status !== "ACTIVE" && license.status !== "UNUSED") continue;
    if (license.expiresAt.toMillis() <= now.toMillis()) continue;

    writer.add((batch) =>
      batch.update(licenseDoc.ref, { subscriptionId: input.toSubscriptionId, updatedAt: serverTimestamp() })
    );
    result.licensesCarried++;

    const codeDoc = codesByLicenseId.get(license.licenseId);
    if (codeDoc) {
      writer.add((batch) => batch.update(codeDoc.ref, { subscriptionId: input.toSubscriptionId }));
      result.codesCarried++;
    }

    if (license.status === "ACTIVE" && license.studentUid) {
      writer.add((batch) =>
        batch.set(
          db.collection(Collections.userOrganizationEntitlements).doc(license.studentUid!),
          { subscriptionId: input.toSubscriptionId, serverCheckedAt: now, updatedAt: now },
          { merge: true }
        )
      );
      result.entitlementsCarried++;
    }
  }

  await writer.commit();
  return result;
}

/**
 * Extends coverage onto the licenses and activation codes themselves.
 *
 * A license stores its own expiresAt, copied from the subscription when it was
 * generated. Renewing or extending only the subscription document therefore
 * left every existing license past-due, so students stayed locked out after a
 * renewal. This walks the affected licenses/codes and moves them onto the new
 * window, reviving the exact same codes rather than issuing new ones.
 *
 * A license that a student already redeemed comes back as ACTIVE; one that was
 * never redeemed comes back as UNUSED. Admin-terminal states (REVOKED,
 * REPLACED, DELETED) are never resurrected.
 */
export async function restoreCoverage(input: RestoreCoverageInput): Promise<RestoreCoverageResult> {
  const [licensesSnap, codesSnap, subscriptionsSnap] = await Promise.all([
    db.collection(Collections.organizationLicenses).where("organizationId", "==", input.organizationId).get(),
    db.collection(Collections.organizationActivationCodes).where("organizationId", "==", input.organizationId).get(),
    db.collection(Collections.organizationSubscriptions).where("organizationId", "==", input.organizationId).get(),
  ]);

  const subscriptionById = new Map<string, OrganizationSubscription>();
  subscriptionsSnap.docs.forEach((doc) => subscriptionById.set(doc.id, doc.data() as OrganizationSubscription));

  const codesByLicenseId = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  codesSnap.docs.forEach((doc) => {
    const code = doc.data() as OrganizationActivationCode;
    codesByLicenseId.set(code.licenseId, doc as FirebaseFirestore.QueryDocumentSnapshot);
  });

  const batchFilter = input.batchNames?.length ? new Set(input.batchNames) : null;
  const subscriptionFilter = input.subscriptionIds?.length ? new Set(input.subscriptionIds) : null;
  const writer = createBatchWriter();
  const now = Timestamp.now();

  const result: RestoreCoverageResult = {
    licensesRestored: 0,
    codesRestored: 0,
    entitlementsRestored: 0,
    studentsReactivated: 0,
    activatedSeats: 0,
    batchNames: [],
  };
  const touchedBatches = new Set<string>();

  for (const licenseDoc of licensesSnap.docs) {
    const license = licenseDoc.data() as OrganizationLicense;
    const codeDoc = codesByLicenseId.get(license.licenseId);
    const code = codeDoc ? (codeDoc.data() as OrganizationActivationCode) : null;
    const batchName = code?.batchName ?? null;

    const inBatchScope = !batchFilter || (batchName !== null && batchFilter.has(batchName));
    const inSubscriptionScope = !subscriptionFilter || subscriptionFilter.has(license.subscriptionId);
    const inScope = inBatchScope && inSubscriptionScope;
    const restorable = inScope && !TERMINAL_LICENSE_STATUSES.has(license.status);

    // Effective, not stored: a locked-out student's document still reads ACTIVE
    // until the expiry sweep runs, so only the projection tells us whether this
    // renewal is actually giving access back.
    const effectiveStatus = getEffectiveLicenseStatus(
      license,
      subscriptionById.get(license.subscriptionId),
      now.toDate()
    );

    if (!restorable) {
      // Out-of-scope licenses still hold a seat if their coverage is live.
      if (effectiveStatus === "ACTIVE") result.activatedSeats++;
      continue;
    }

    // Redeemed licenses return to ACTIVE; never-redeemed ones return to UNUSED.
    const restoredStatus: LicenseStatus = license.studentUid ? "ACTIVE" : "UNUSED";

    writer.add((batch) =>
      batch.update(licenseDoc.ref, {
        status: restoredStatus,
        subscriptionId: input.targetSubscriptionId,
        expiresAt: input.expiresAt,
        updatedAt: serverTimestamp(),
      })
    );
    result.licensesRestored++;
    if (batchName) touchedBatches.add(batchName);

    if (restoredStatus === "ACTIVE") {
      result.activatedSeats++;
      if (effectiveStatus !== "ACTIVE") result.studentsReactivated++;

      if (license.studentUid) {
        writer.add((batch) =>
          batch.set(
            db.collection(Collections.userOrganizationEntitlements).doc(license.studentUid!),
            {
              status: "ACTIVE",
              subscriptionId: input.targetSubscriptionId,
              expiresAt: input.expiresAt,
              serverCheckedAt: now,
              offlineValidUntil: Timestamp.fromMillis(now.toMillis() + OFFLINE_GRACE_MS),
              updatedAt: now,
            },
            { merge: true }
          )
        );
        result.entitlementsRestored++;
      }
    }

    if (codeDoc && code && !TERMINAL_CODE_STATUSES.has(code.status)) {
      // A code that was already redeemed stays REDEEMED — it has been used, and
      // reviving it to UNUSED would let it be redeemed a second time.
      const restoredCodeStatus: ActivationCodeStatus = code.status === "REDEEMED" ? "REDEEMED" : "UNUSED";
      writer.add((batch) =>
        batch.update(codeDoc.ref, {
          status: restoredCodeStatus,
          subscriptionId: input.targetSubscriptionId,
        })
      );
      result.codesRestored++;
    }
  }

  await writer.commit();

  result.batchNames = Array.from(touchedBatches).sort();
  return result;
}
