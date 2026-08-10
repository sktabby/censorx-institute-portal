import { Collections } from "../config/collections";
import { db, newDocId, serverTimestamp } from "../repositories/firestoreRepository";
import {
  getEffectiveActivationCodeStatus,
  getEffectiveLicenseStatus,
  getEffectiveSubscriptionStatus,
} from "../repositories/organizationRepository";
import type {
  ActivationCodeStatus,
  OrganizationActivationCode,
  OrganizationBatch,
  OrganizationLicense,
  OrganizationSubscription,
} from "../models/types";

/** Codes an admin action retired — a renewal must never revive these. */
const TERMINAL_CODE_STATUSES = new Set<ActivationCodeStatus>(["REVOKED", "REPLACED", "DELETED"]);

/**
 * PENDING  — seats allocated, no codes generated yet (generate in Create Codes).
 * ACTIVE   — has codes, all within their window.
 * PARTIALLY_EXPIRED / EXPIRED — some / all codes past their window.
 * RETIRED  — every code is REVOKED, REPLACED or DELETED. restoreCoverage skips
 *            those statuses, so a RETIRED batch can never be extended; it is
 *            deliberately excluded from the renewable set.
 */
export type BatchStatus = "PENDING" | "ACTIVE" | "PARTIALLY_EXPIRED" | "EXPIRED" | "RETIRED";

export interface OrganizationBatchSummary {
  batchName: string;
  subscriptionId: string;
  codeCount: number;
  unusedCount: number;
  redeemedCount: number;
  expiredCount: number;
  revokedCount: number;
  replacedCount: number;
  deletedCount: number;
  /** Codes a renewal would move onto a new window. */
  renewableCount: number;
  status: BatchStatus;
  createdAt: string | null;
  expiresAt: string | null;
  /** Seats reserved for this batch. Only meaningful for allocated batches. */
  seatCount: number;
  /** True when seats are allocated but codes have not been generated yet. */
  isPending: boolean;
  /** Window inherited from the allocating renewal; null for legacy batches. */
  startAt: string | null;
  /** How many codes Create Codes should still generate for this batch. */
  pendingSeats: number;
  /**
   * Set when a later renewal moved this pending batch onto a newer window,
   * so the changed dates are visible rather than silent.
   */
  windowUpdatedAt: string | null;
}

function timestampToIso(value: unknown): string | null {
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as FirebaseFirestore.Timestamp).toDate().toISOString();
  }
  return null;
}

function timestampMillis(value: unknown): number {
  if (value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as FirebaseFirestore.Timestamp).toMillis();
  }
  return 0;
}

function resolveBatchStatus(summary: {
  unusedCount: number;
  redeemedCount: number;
  expiredCount: number;
  renewableCount: number;
}): BatchStatus {
  if (summary.renewableCount === 0) return "RETIRED";
  const live = summary.unusedCount + summary.redeemedCount;
  if (summary.expiredCount === 0) return "ACTIVE";
  if (live === 0) return "EXPIRED";
  return "PARTIALLY_EXPIRED";
}

/**
 * Records a named, sized seat allocation with no codes attached.
 *
 * Renew School owns seats and time; Create Codes owns codes and email. This is
 * the handoff between them — it reserves capacity under the renewal's own
 * window, and generation happens later against the inherited dates.
 */
export async function allocateBatch(input: {
  organizationId: string;
  batchName: string;
  seatCount: number;
  subscriptionId: string;
  startAt: FirebaseFirestore.Timestamp;
  expiresAt: FirebaseFirestore.Timestamp;
  actorUid: string;
}): Promise<{ batchId: string; batchName: string; seatCount: number }> {
  const batchId = newDocId(Collections.organizationBatches);
  const now = serverTimestamp();

  await db.collection(Collections.organizationBatches).doc(batchId).set({
    batchId,
    organizationId: input.organizationId,
    batchName: input.batchName,
    subscriptionId: input.subscriptionId,
    seatCount: input.seatCount,
    status: "PENDING",
    startAt: input.startAt,
    expiresAt: input.expiresAt,
    createdAt: now,
    createdBy: input.actorUid,
    updatedAt: now,
    generatedAt: null,
    windowUpdatedAt: null,
  });

  return { batchId, batchName: input.batchName, seatCount: input.seatCount };
}

/**
 * Re-points still-pending batches at a new subscription window.
 *
 * Without this, allocating seats and then renewing again before generating
 * would leave the pending batch stranded on the old window, and Create Codes
 * would later issue codes that were already expired.
 */
export async function repointPendingBatches(input: {
  organizationId: string;
  subscriptionId: string;
  startAt: FirebaseFirestore.Timestamp;
  expiresAt: FirebaseFirestore.Timestamp;
}): Promise<string[]> {
  const pendingSnap = await db
    .collection(Collections.organizationBatches)
    .where("organizationId", "==", input.organizationId)
    .where("status", "==", "PENDING")
    .get();

  if (pendingSnap.empty) return [];

  const repointed: string[] = [];
  const batch = db.batch();
  pendingSnap.docs.forEach((doc) => {
    const record = doc.data() as OrganizationBatch;
    // Already on this window (e.g. allocated by this same renewal) — nothing
    // moved, so do not report it as changed.
    if (record.subscriptionId === input.subscriptionId) return;

    repointed.push(record.batchName);
    batch.update(doc.ref, {
      subscriptionId: input.subscriptionId,
      startAt: input.startAt,
      expiresAt: input.expiresAt,
      windowUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  if (repointed.length === 0) return [];
  await batch.commit();

  return repointed.sort();
}

/** Marks an allocation as fulfilled once its codes have been generated. */
export async function markBatchGenerated(organizationId: string, batchName: string): Promise<void> {
  const snap = await db
    .collection(Collections.organizationBatches)
    .where("organizationId", "==", organizationId)
    .where("batchName", "==", batchName)
    .limit(1)
    .get();

  if (snap.empty) return;
  await snap.docs[0].ref.update({
    status: "GENERATED",
    generatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** Returns the pending allocation for a batch name, if one exists. */
export async function findPendingBatch(
  organizationId: string,
  batchName: string
): Promise<OrganizationBatch | null> {
  const snap = await db
    .collection(Collections.organizationBatches)
    .where("organizationId", "==", organizationId)
    .where("batchName", "==", batchName)
    .limit(1)
    .get();

  if (snap.empty) return null;
  const record = snap.docs[0].data() as OrganizationBatch;
  return record.status === "PENDING" ? record : null;
}

export interface SubscriptionHistoryRow {
  subscriptionId: string;
  planDuration: string;
  seatLimit: number;
  status: string;
  /** Stored status before read-time expiry projection, for auditability. */
  storedStatus: string;
  startAt: string | null;
  expiresAt: string | null;
  createdAt: string | null;
  renewedFromSubscriptionId: string | null;
  /** 1 for the school's first subscription, incrementing along the renewal chain. */
  sequence: number;
  isCurrent: boolean;
  /** Licenses currently attached to this subscription. */
  licenseCount: number;
  activeLicenseCount: number;
}

/**
 * Full subscription history for a school, ordered oldest-first by walking the
 * renewedFromSubscriptionId chain.
 *
 * The chain is the authoritative ordering — createdAt is only a fallback for
 * roots and for any record whose parent link is missing or broken, so a
 * corrupted link degrades to date ordering rather than dropping rows.
 */
export async function listSubscriptionHistory(organizationId: string): Promise<SubscriptionHistoryRow[]> {
  const [subscriptionsSnap, licensesSnap, orgSnap] = await Promise.all([
    db.collection(Collections.organizationSubscriptions).where("organizationId", "==", organizationId).get(),
    db.collection(Collections.organizationLicenses).where("organizationId", "==", organizationId).get(),
    db.collection(Collections.organizations).doc(organizationId).get(),
  ]);

  const currentSubscriptionId = orgSnap.exists
    ? ((orgSnap.data() as { currentSubscriptionId?: string | null }).currentSubscriptionId ?? null)
    : null;

  const now = new Date();
  const subscriptions = subscriptionsSnap.docs.map((doc) => doc.data() as OrganizationSubscription);

  const licenseCounts = new Map<string, { total: number; active: number }>();
  licensesSnap.docs.forEach((doc) => {
    const license = doc.data() as OrganizationLicense;
    const bucket = licenseCounts.get(license.subscriptionId) ?? { total: 0, active: 0 };
    bucket.total++;
    if (license.status !== "DELETED") {
      const subscription = subscriptions.find((s) => s.subscriptionId === license.subscriptionId);
      if (getEffectiveLicenseStatus(license, subscription, now) === "ACTIVE") bucket.active++;
    }
    licenseCounts.set(license.subscriptionId, bucket);
  });

  // Order by walking each renewal chain from its root.
  const byId = new Map(subscriptions.map((s) => [s.subscriptionId, s]));
  const childrenOf = new Map<string, OrganizationSubscription[]>();
  const roots: OrganizationSubscription[] = [];

  for (const subscription of subscriptions) {
    const parentId = subscription.renewedFromSubscriptionId;
    if (parentId && byId.has(parentId)) {
      const siblings = childrenOf.get(parentId) ?? [];
      siblings.push(subscription);
      childrenOf.set(parentId, siblings);
    } else {
      roots.push(subscription);
    }
  }

  const byCreatedAt = (a: OrganizationSubscription, b: OrganizationSubscription) =>
    timestampMillis(a.createdAt) - timestampMillis(b.createdAt);

  const ordered: OrganizationSubscription[] = [];
  const visited = new Set<string>();
  const visit = (subscription: OrganizationSubscription) => {
    if (visited.has(subscription.subscriptionId)) return;
    visited.add(subscription.subscriptionId);
    ordered.push(subscription);
    (childrenOf.get(subscription.subscriptionId) ?? []).sort(byCreatedAt).forEach(visit);
  };
  roots.sort(byCreatedAt).forEach(visit);
  // Safety net for any cycle that would otherwise hide records.
  subscriptions.sort(byCreatedAt).forEach(visit);

  return ordered.map((subscription, index) => {
    const counts = licenseCounts.get(subscription.subscriptionId) ?? { total: 0, active: 0 };
    return {
      subscriptionId: subscription.subscriptionId,
      planDuration: subscription.planDuration,
      seatLimit: subscription.seatLimit,
      status: getEffectiveSubscriptionStatus(subscription, now),
      storedStatus: subscription.status,
      startAt: timestampToIso(subscription.startAt),
      expiresAt: timestampToIso(subscription.expiresAt),
      createdAt: timestampToIso(subscription.createdAt),
      renewedFromSubscriptionId: subscription.renewedFromSubscriptionId ?? null,
      sequence: index + 1,
      isCurrent: subscription.subscriptionId === currentSubscriptionId,
      licenseCount: counts.total,
      activeLicenseCount: counts.active,
    };
  });
}

/**
 * Groups a school's activation codes into the batches they were issued as.
 *
 * Batch membership lives on the activation-code document (batchName), which is
 * authoritative and covers codes generated before the same field was
 * denormalized onto licenses. Statuses are effective, not stored, so a batch
 * reads as EXPIRED the moment its window closes rather than only after the
 * expiry sweep has run.
 */
export async function listOrganizationBatches(organizationId: string): Promise<OrganizationBatchSummary[]> {
  const [codesSnap, licensesSnap, subscriptionsSnap, batchesSnap] = await Promise.all([
    db.collection(Collections.organizationActivationCodes).where("organizationId", "==", organizationId).get(),
    db.collection(Collections.organizationLicenses).where("organizationId", "==", organizationId).get(),
    db.collection(Collections.organizationSubscriptions).where("organizationId", "==", organizationId).get(),
    db.collection(Collections.organizationBatches).where("organizationId", "==", organizationId).get(),
  ]);

  const batchRecordByName = new Map<string, OrganizationBatch>();
  batchesSnap.docs.forEach((doc) => {
    const record = doc.data() as OrganizationBatch;
    batchRecordByName.set(record.batchName, record);
  });

  const licenseById = new Map<string, OrganizationLicense>();
  licensesSnap.docs.forEach((doc) => licenseById.set(doc.id, doc.data() as OrganizationLicense));
  const subscriptionById = new Map<string, OrganizationSubscription>();
  subscriptionsSnap.docs.forEach((doc) => subscriptionById.set(doc.id, doc.data() as OrganizationSubscription));

  const now = new Date();
  const byBatch = new Map<string, OrganizationBatchSummary & { createdAtMillis: number }>();

  for (const doc of codesSnap.docs) {
    const code = doc.data() as OrganizationActivationCode;
    const batchName = code.batchName ?? "(unnamed)";
    const subscription = subscriptionById.get(code.subscriptionId);
    const license = licenseById.get(code.licenseId);
    const status = getEffectiveActivationCodeStatus(code, subscription, license, now);

    let summary = byBatch.get(batchName);
    if (!summary) {
      summary = {
        batchName,
        subscriptionId: code.subscriptionId,
        codeCount: 0,
        unusedCount: 0,
        redeemedCount: 0,
        expiredCount: 0,
        revokedCount: 0,
        replacedCount: 0,
        deletedCount: 0,
        renewableCount: 0,
        status: "ACTIVE",
        createdAt: null,
        expiresAt: null,
        seatCount: 0,
        isPending: false,
        startAt: null,
        pendingSeats: 0,
        windowUpdatedAt: null,
        createdAtMillis: Number.MAX_SAFE_INTEGER,
      };
      byBatch.set(batchName, summary);
    }

    summary.codeCount++;
    if (status === "UNUSED") summary.unusedCount++;
    else if (status === "REDEEMED") summary.redeemedCount++;
    else if (status === "EXPIRED") summary.expiredCount++;
    else if (status === "REVOKED") summary.revokedCount++;
    else if (status === "REPLACED") summary.replacedCount++;
    else if (status === "DELETED") summary.deletedCount++;

    if (!TERMINAL_CODE_STATUSES.has(status)) summary.renewableCount++;

    // A batch is stamped with its earliest code creation and the subscription
    // window the batch currently sits on.
    const createdMillis = timestampMillis(code.createdAt);
    if (createdMillis > 0 && createdMillis < summary.createdAtMillis) {
      summary.createdAtMillis = createdMillis;
      summary.createdAt = timestampToIso(code.createdAt);
      summary.subscriptionId = code.subscriptionId;
      summary.expiresAt = subscription ? timestampToIso(subscription.expiresAt) : null;
    }
  }

  // Allocated batches that have no codes yet exist only as records; batches
  // that do have codes take their seat allocation and inherited window from
  // the record when one exists.
  for (const [batchName, record] of batchRecordByName) {
    const existing = byBatch.get(batchName);
    if (existing) {
      existing.seatCount = record.seatCount;
      existing.startAt = timestampToIso(record.startAt);
      if (!existing.expiresAt) existing.expiresAt = timestampToIso(record.expiresAt);
      existing.pendingSeats = Math.max(0, record.seatCount - existing.codeCount);
      existing.windowUpdatedAt = timestampToIso(record.windowUpdatedAt);
      continue;
    }

    byBatch.set(batchName, {
      batchName,
      subscriptionId: record.subscriptionId,
      codeCount: 0,
      unusedCount: 0,
      redeemedCount: 0,
      expiredCount: 0,
      revokedCount: 0,
      replacedCount: 0,
      deletedCount: 0,
      // Nothing to extend until codes exist, so a pending batch is not renewable.
      renewableCount: 0,
      status: "PENDING",
      createdAt: timestampToIso(record.createdAt),
      expiresAt: timestampToIso(record.expiresAt),
      seatCount: record.seatCount,
      isPending: true,
      startAt: timestampToIso(record.startAt),
      pendingSeats: record.seatCount,
      windowUpdatedAt: timestampToIso(record.windowUpdatedAt),
      createdAtMillis: timestampMillis(record.createdAt),
    });
  }

  return Array.from(byBatch.values())
    .map(({ createdAtMillis, ...summary }) => ({
      ...summary,
      status: summary.isPending ? ("PENDING" as const) : resolveBatchStatus(summary),
      sortMillis: createdAtMillis === Number.MAX_SAFE_INTEGER ? 0 : createdAtMillis,
    }))
    .sort((a, b) => b.sortMillis - a.sortMillis)
    .map(({ sortMillis: _sortMillis, ...summary }) => summary);
}
