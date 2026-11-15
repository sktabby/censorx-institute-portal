import { Collections } from "../config/collections";
import { db, newDocId, serverTimestamp } from "../repositories/firestoreRepository";
import {
  getEffectiveActivationCodeStatus,
  getEffectiveLicenseStatus,
  getEffectiveSubscriptionStatus,
  isLiveBatch,
} from "../repositories/organizationRepository";
import { buildSeatUsage, type SeatUsage } from "../utils/seatAccounting";
import { CODE_STATUS_FIELDS, LICENSE_DASHBOARD_FIELDS, LICENSE_STATUS_FIELDS, onlyFields } from "../utils/firestoreFields";
import { amountDueNow, firstUnpaid, installmentViews, issuedBills, paymentTransactions, type InstallmentStatus } from "./paymentSchedule";
import type {
  ActivationCodeStatus,
  OrganizationActivationCode,
  OrganizationBatch,
  OrganizationLicense,
  OrganizationPayment,
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
  /** Label of the batch period this class sits on, e.g. "Batch 2". Null for legacy records. */
  batchLabel: string | null;
  /** Read-time status of that batch period (ACTIVE, EXPIRED, RENEWED, CANCELLED) or NONE. */
  subscriptionStatus: string;
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

export interface ClassRecordInput {
  organizationId: string;
  batchName: string;
  seatCount: number;
  subscriptionId: string;
  startAt: FirebaseFirestore.Timestamp;
  expiresAt: FirebaseFirestore.Timestamp;
  actorUid: string;
}

/** The document written for a class (sheet) that has seats but no codes yet. */
export function buildClassRecord(batchId: string, input: ClassRecordInput) {
  const now = serverTimestamp();
  return {
    batchId,
    organizationId: input.organizationId,
    batchName: input.batchName,
    subscriptionId: input.subscriptionId,
    seatCount: input.seatCount,
    status: "PENDING" as const,
    startAt: input.startAt,
    expiresAt: input.expiresAt,
    createdAt: now,
    createdBy: input.actorUid,
    updatedAt: now,
    generatedAt: null,
    windowUpdatedAt: null,
  };
}

/**
 * Records a named, sized seat allocation with no codes attached.
 *
 * The Subscription page owns seats and time; Create Codes owns codes and email. This
 * is the handoff between them — it reserves capacity under the batch's own window,
 * and generation happens later against those dates.
 */
export async function allocateBatch(input: ClassRecordInput): Promise<{ batchId: string; batchName: string; seatCount: number }> {
  const batchId = newDocId(Collections.organizationBatches);
  await db.collection(Collections.organizationBatches).doc(batchId).set(buildClassRecord(batchId, input));
  return { batchId, batchName: input.batchName, seatCount: input.seatCount };
}

/**
 * Moves the still-pending classes of ONE batch period onto the period that renewed it.
 *
 * Without this, adding a class and then renewing the batch before its codes were made
 * would leave the class stranded on the old period, and Create Codes would later issue
 * codes that were already expired. Classes of other batches are never touched.
 */
export async function repointPendingBatches(input: {
  organizationId: string;
  /** Only classes currently on this period move. */
  fromSubscriptionId: string;
  subscriptionId: string;
  startAt: FirebaseFirestore.Timestamp;
  expiresAt: FirebaseFirestore.Timestamp;
}): Promise<string[]> {
  if (input.fromSubscriptionId === input.subscriptionId) return [];

  const pendingSnap = await db
    .collection(Collections.organizationBatches)
    .where("organizationId", "==", input.organizationId)
    .where("subscriptionId", "==", input.fromSubscriptionId)
    .get();

  if (pendingSnap.empty) return [];

  const repointed: string[] = [];
  const batch = db.batch();
  pendingSnap.docs.forEach((doc) => {
    const record = doc.data() as OrganizationBatch;
    if (record.status !== "PENDING") return;

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

/** Writes a new end date onto every class record of a batch period (used when a batch is extended). */
export async function updateClassRecordsWindow(input: {
  organizationId: string;
  subscriptionId: string;
  expiresAt: FirebaseFirestore.Timestamp;
}): Promise<number> {
  const snap = await db
    .collection(Collections.organizationBatches)
    .where("organizationId", "==", input.organizationId)
    .where("subscriptionId", "==", input.subscriptionId)
    .get();
  if (snap.empty) return 0;

  const batch = db.batch();
  snap.docs.forEach((doc) => batch.update(doc.ref, { expiresAt: input.expiresAt, updatedAt: serverTimestamp() }));
  await batch.commit();
  return snap.size;
}

/** The class record for a sheet name, pending or not. */
export async function findClassRecord(organizationId: string, batchName: string): Promise<OrganizationBatch | null> {
  const snap = await db
    .collection(Collections.organizationBatches)
    .where("organizationId", "==", organizationId)
    .where("batchName", "==", batchName)
    .limit(1)
    .get();
  return snap.empty ? null : (snap.docs[0].data() as OrganizationBatch);
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
  /** 1 for the school's first period, incrementing along each renewal chain. */
  sequence: number;
  /** True while this period is live (stored ACTIVE and inside its window). */
  isCurrent: boolean;
  /** Licenses currently attached to this subscription. */
  licenseCount: number;
  activeLicenseCount: number;
  batchNumber: number;
  batchLabel: string;
  billNumber: string | null;
}

/** Display label for a batch period; records written before batches existed read as Batch 1. */
export function batchLabelOf(subscription: Pick<OrganizationSubscription, "batchNumber" | "batchLabel">): string {
  return subscription.batchLabel ?? `Batch ${subscription.batchNumber ?? 1}`;
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
  const [subscriptionsSnap, licensesSnap] = await Promise.all([
    db.collection(Collections.organizationSubscriptions).where("organizationId", "==", organizationId).get(),
    db.collection(Collections.organizationLicenses).where("organizationId", "==", organizationId).get(),
  ]);

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
      isCurrent: isLiveBatch(subscription, now),
      licenseCount: counts.total,
      activeLicenseCount: counts.active,
      batchNumber: subscription.batchNumber ?? 1,
      batchLabel: batchLabelOf(subscription),
      billNumber: subscription.payment?.billNumber ?? null,
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
        batchLabel: subscription ? batchLabelOf(subscription) : null,
        subscriptionStatus: subscription ? getEffectiveSubscriptionStatus(subscription, now) : "NONE",
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
      summary.batchLabel = subscription ? batchLabelOf(subscription) : null;
      summary.subscriptionStatus = subscription ? getEffectiveSubscriptionStatus(subscription, now) : "NONE";
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
      // Codes added to a class that already has some ("Add codes to a class"): its record goes
      // back to PENDING, and the extra seats wait in Create Codes like any new class.
      existing.isPending = record.status === "PENDING" && existing.pendingSeats > 0;
      existing.windowUpdatedAt = timestampToIso(record.windowUpdatedAt);
      continue;
    }

    const recordSubscription = subscriptionById.get(record.subscriptionId);
    byBatch.set(batchName, {
      batchName,
      subscriptionId: record.subscriptionId,
      batchLabel: recordSubscription ? batchLabelOf(recordSubscription) : null,
      subscriptionStatus: recordSubscription ? getEffectiveSubscriptionStatus(recordSubscription, now) : "NONE",
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
      // A class with codes keeps the status of its codes, even while extra seats wait.
      status: summary.isPending && summary.codeCount === 0 ? ("PENDING" as const) : resolveBatchStatus(summary),
      sortMillis: createdAtMillis === Number.MAX_SAFE_INTEGER ? 0 : createdAtMillis,
    }))
    .sort((a, b) => b.sortMillis - a.sortMillis)
    .map(({ sortMillis: _sortMillis, ...summary }) => summary);
}

// ---------------------------------------------------------------------------
// Batch view: one entry per batch period, with its classes and seat usage.
// ---------------------------------------------------------------------------

export interface BatchClassView {
  batchName: string;
  seatCount: number;
  codeCount: number;
  unusedCount: number;
  redeemedCount: number;
  expiredCount: number;
  revokedCount: number;
  replacedCount: number;
  deletedCount: number;
  pendingSeats: number;
  isPending: boolean;
  status: BatchStatus;
}

/** What a school may see about a payment. Method details (cheque, UPI, card) stay admin-only. */
export interface PaymentSchoolView {
  billNumber: string;
  billDate: string | null;
  status: OrganizationPayment["status"];
  totalAmount: number;
  grossAmount: number;
  discountPercent: number;
  discountAmount: number;
  /** Price per code per month, when the bill was priced that way. Used to price extra codes. */
  amountPerCode: number | null;
  /** Paid when the batch was set up, separate from the installments (0 on older bills). */
  upfrontAmount: number;
  paidAmount: number;
  pendingAmount: number;
  installments: number;
  method: OrganizationPayment["method"];
  description: string | null;
  /** Installments with due dates and their state today. Empty for bills without a dated plan. */
  schedule: Array<{
    number: number;
    amount: number;
    dueDate: string;
    paid: number;
    remaining: number;
    status: InstallmentStatus;
    daysLate: number;
  }>;
  /** Past its due date and still unpaid. */
  amountDueNow: number;
  /** Any installment 7 or more days late. */
  isOverdue: boolean;
  nextDue: { number: number; dueDate: string; remaining: number } | null;
  /** Every bill issued, newest last. */
  bills: Array<{
    billNumber: string;
    issuedAt: string | null;
    kind: "INVOICE" | "PAYMENT" | "ADJUSTMENT";
    paidToDate: number;
    balance: number;
    note: string | null;
    reason: "EXTRA_CODES" | "SCHEDULE_CHANGE" | null;
  }>;
  /** Payments received, oldest first. */
  transactions: Array<{ transactionId: string; amount: number; paidAt: string | null; method: string; billNumber: string }>;
}

export interface PaymentAdminView extends PaymentSchoolView {
  methodDetails: OrganizationPayment["methodDetails"];
  transactionDetails: Array<{ transactionId: string; methodDetails: OrganizationPayment["methodDetails"] }>;
}

export interface BatchView {
  subscriptionId: string;
  batchNumber: number;
  batchLabel: string;
  planDuration: string;
  startAt: string | null;
  expiresAt: string | null;
  createdAt: string | null;
  /** Read-time status: ACTIVE, EXPIRED, RENEWED, CANCELLED, SUSPENDED. */
  status: string;
  storedStatus: string;
  /** Stored ACTIVE and inside its window: students in these classes can use the app. */
  isLive: boolean;
  /** False for periods that were renewed (history); the renewing period is the one to act on. */
  isCurrentPeriod: boolean;
  /** Whole days until the end date; negative once ended. */
  daysRemaining: number;
  seatLimit: number;
  seatUsage: SeatUsage;
  classes: BatchClassView[];
  renewedFromSubscriptionId: string | null;
  renewedToSubscriptionId: string | null;
  payment: PaymentSchoolView | PaymentAdminView | null;
  notes: string | null;
  cancelledAt: string | null;
  /** Access stopped by the admin (status SUSPENDED). */
  isPaused: boolean;
  pausedAt: string | null;
  pauseReason: string | null;
  /** Renewal (marketing) emails after the period ended: false once the admin stopped them. */
  renewalEmails: boolean;
  /** How many renewal emails were sent after the period ended. */
  renewalEmailsSent: number;
}

export function buildPaymentView(payment: OrganizationPayment | null | undefined, audience: "admin" | "school", now = new Date()) {
  if (!payment) return null;
  const views = installmentViews(payment, { asOf: now });
  const next = firstUnpaid(views);
  const transactions = paymentTransactions(payment);
  const base: PaymentSchoolView = {
    billNumber: payment.billNumber,
    billDate: timestampToIso(payment.billDate),
    status: payment.status,
    totalAmount: payment.totalAmount,
    grossAmount: payment.grossAmount ?? payment.totalAmount,
    discountPercent: payment.discountPercent ?? 0,
    discountAmount: payment.discountAmount ?? 0,
    amountPerCode: payment.amountPerCode ?? null,
    upfrontAmount: payment.upfrontAmount ?? 0,
    paidAmount: payment.paidAmount,
    pendingAmount: payment.pendingAmount,
    installments: payment.installments,
    method: payment.method,
    description: payment.description ?? null,
    schedule: views.map((item) => ({ ...item, dueDate: item.dueDate.toISOString() })),
    amountDueNow: amountDueNow(payment, now),
    isOverdue: views.some((item) => item.status === "OVERDUE"),
    nextDue: next ? { number: next.number, dueDate: next.dueDate.toISOString(), remaining: next.remaining } : null,
    bills: issuedBills(payment).map((bill) => ({
      billNumber: bill.billNumber,
      issuedAt: timestampToIso(bill.issuedAt),
      kind: bill.kind,
      paidToDate: bill.paidToDate,
      balance: bill.balance,
      note: bill.note ?? null,
      reason: bill.reason ?? null,
    })),
    transactions: transactions.map((txn) => ({
      transactionId: txn.transactionId,
      amount: txn.amount,
      paidAt: timestampToIso(txn.paidAt),
      method: txn.method,
      billNumber: txn.billNumber,
    })),
  };
  return audience === "admin"
    ? {
        ...base,
        methodDetails: payment.methodDetails,
        transactionDetails: transactions.map((txn) => ({ transactionId: txn.transactionId, methodDetails: txn.methodDetails })),
      }
    : base;
}

/**
 * Every batch period of a school with its classes, oldest batch first. Codes and class records
 * are attributed to the period they currently sit on, so a renewed batch's classes show under
 * the renewing period and the renewed (RENEWED) period reads as history.
 */
export async function listBatchSubscriptions(
  organizationId: string,
  options: { audience: "admin" | "school"; now?: Date }
): Promise<BatchView[]> {
  const data = await loadSchoolData(organizationId);
  return buildBatchViews(data, options);
}

/** A school's batches, codes, licences and class records, each read once (trimmed to what views need). */
export interface SchoolData {
  subscriptions: OrganizationSubscription[];
  codes: OrganizationActivationCode[];
  /** Keyed by licence id. Only status/batch fields, plus dashboard fields when asked for. */
  licenseById: Map<string, OrganizationLicense>;
  records: OrganizationBatch[];
}

export async function loadSchoolData(organizationId: string, options: { withStudentDetails?: boolean } = {}): Promise<SchoolData> {
  const byOrg = (name: string) => db.collection(name).where("organizationId", "==", organizationId);
  const [subscriptionsSnap, codesSnap, licensesSnap, recordsSnap] = await Promise.all([
    byOrg(Collections.organizationSubscriptions).get(),
    onlyFields(byOrg(Collections.organizationActivationCodes), CODE_STATUS_FIELDS).get(),
    onlyFields(byOrg(Collections.organizationLicenses), options.withStudentDetails ? LICENSE_DASHBOARD_FIELDS : LICENSE_STATUS_FIELDS).get(),
    byOrg(Collections.organizationBatches).get(),
  ]);
  const licenseById = new Map<string, OrganizationLicense>();
  licensesSnap.docs.forEach((doc) => licenseById.set(doc.id, { ...(doc.data() as OrganizationLicense), licenseId: doc.id }));
  return {
    subscriptions: subscriptionsSnap.docs.map((doc) => doc.data() as OrganizationSubscription),
    codes: codesSnap.docs.map((doc) => doc.data() as OrganizationActivationCode),
    licenseById,
    records: recordsSnap.docs.map((doc) => doc.data() as OrganizationBatch),
  };
}

/** Builds every batch view from data already read (see loadSchoolData). */
export function buildBatchViews(data: SchoolData, options: { audience: "admin" | "school"; now?: Date }): BatchView[] {
  const now = options.now ?? new Date();
  const { subscriptions, licenseById } = data;
  const subscriptionById = new Map(subscriptions.map((s) => [s.subscriptionId, s]));

  const renewedTo = new Map<string, string>();
  subscriptions.forEach((s) => {
    if (s.renewedFromSubscriptionId) renewedTo.set(s.renewedFromSubscriptionId, s.subscriptionId);
  });

  // Classes per period, built from codes first and then class records.
  const classesBySubscription = new Map<string, Map<string, BatchClassView>>();
  const classFor = (subscriptionId: string, batchName: string) => {
    let bucket = classesBySubscription.get(subscriptionId);
    if (!bucket) {
      bucket = new Map();
      classesBySubscription.set(subscriptionId, bucket);
    }
    let view = bucket.get(batchName);
    if (!view) {
      view = {
        batchName,
        seatCount: 0,
        codeCount: 0,
        unusedCount: 0,
        redeemedCount: 0,
        expiredCount: 0,
        revokedCount: 0,
        replacedCount: 0,
        deletedCount: 0,
        pendingSeats: 0,
        isPending: false,
        status: "ACTIVE",
      };
      bucket.set(batchName, view);
    }
    return view;
  };

  data.codes.forEach((code) => {
    const subscription = subscriptionById.get(code.subscriptionId);
    const status = getEffectiveActivationCodeStatus(code, subscription, licenseById.get(code.licenseId), now);
    const view = classFor(code.subscriptionId, code.batchName ?? "(unnamed)");
    view.codeCount++;
    if (status === "UNUSED") view.unusedCount++;
    else if (status === "REDEEMED") view.redeemedCount++;
    else if (status === "EXPIRED") view.expiredCount++;
    else if (status === "REVOKED") view.revokedCount++;
    else if (status === "REPLACED") view.replacedCount++;
    else if (status === "DELETED") view.deletedCount++;
  });

  data.records.forEach((record) => {
    const view = classFor(record.subscriptionId, record.batchName);
    view.seatCount = record.seatCount;
    view.pendingSeats = Math.max(0, record.seatCount - view.codeCount);
    view.isPending = record.status === "PENDING" && view.pendingSeats > 0;
  });

  // Seat usage per period from the licences sitting on it.
  const statusesBySubscription = new Map<string, OrganizationLicense["status"][]>();
  licenseById.forEach((license) => {
    const status = getEffectiveLicenseStatus(license, subscriptionById.get(license.subscriptionId), now);
    const bucket = statusesBySubscription.get(license.subscriptionId) ?? [];
    bucket.push(status);
    statusesBySubscription.set(license.subscriptionId, bucket);
  });

  const DAY = 24 * 60 * 60 * 1000;

  return subscriptions
    .map((subscription): BatchView => {
      const classes = Array.from(classesBySubscription.get(subscription.subscriptionId)?.values() ?? [])
        .map((view) => {
          if (view.seatCount === 0) view.seatCount = view.codeCount;
          const renewableCount = view.codeCount - view.revokedCount - view.replacedCount - view.deletedCount;
          const status: BatchStatus =
            view.isPending || view.codeCount === 0 ? "PENDING" : resolveBatchStatus({ ...view, renewableCount });
          return { ...view, status };
        })
        .sort((a, b) => a.batchName.localeCompare(b.batchName));

      return {
        subscriptionId: subscription.subscriptionId,
        batchNumber: subscription.batchNumber ?? 1,
        batchLabel: batchLabelOf(subscription),
        planDuration: subscription.planDuration,
        startAt: timestampToIso(subscription.startAt),
        expiresAt: timestampToIso(subscription.expiresAt),
        createdAt: timestampToIso(subscription.createdAt),
        status: getEffectiveSubscriptionStatus(subscription, now),
        storedStatus: subscription.status,
        isLive: isLiveBatch(subscription, now),
        isCurrentPeriod: subscription.status !== "RENEWED",
        daysRemaining: Math.floor((timestampMillis(subscription.expiresAt) - now.getTime()) / DAY),
        seatLimit: subscription.seatLimit,
        seatUsage: buildSeatUsage({
          effectiveStatuses: statusesBySubscription.get(subscription.subscriptionId) ?? [],
          seatLimit: subscription.seatLimit,
        }),
        classes,
        renewedFromSubscriptionId: subscription.renewedFromSubscriptionId ?? null,
        renewedToSubscriptionId: renewedTo.get(subscription.subscriptionId) ?? null,
        payment: buildPaymentView(subscription.payment, options.audience, now),
        notes: subscription.notes ?? null,
        cancelledAt: timestampToIso(subscription.cancelledAt),
        isPaused: subscription.status === "SUSPENDED",
        pausedAt: timestampToIso(subscription.pausedAt),
        pauseReason: subscription.pauseReason ?? null,
        renewalEmails: !subscription.renewalEmailsStoppedAt,
        renewalEmailsSent: subscription.renewalOfferCount ?? 0,
      };
    })
    .sort(
      (a, b) =>
        a.batchNumber - b.batchNumber ||
        timestampMillis(subscriptionById.get(a.subscriptionId)?.createdAt) -
          timestampMillis(subscriptionById.get(b.subscriptionId)?.createdAt)
    );
}

/**
 * The classes of a batch period with their number of codes: the seats reserved on the class
 * record, or the number of codes made for classes that have no record (older data).
 */
export async function listClassSeatsForSubscription(
  organizationId: string,
  subscriptionId: string
): Promise<Array<{ name: string; codes: number }>> {
  const [recordsSnap, codesSnap] = await Promise.all([
    db
      .collection(Collections.organizationBatches)
      .where("organizationId", "==", organizationId)
      .where("subscriptionId", "==", subscriptionId)
      .get(),
    db
      .collection(Collections.organizationActivationCodes)
      .where("organizationId", "==", organizationId)
      .where("subscriptionId", "==", subscriptionId)
      .get(),
  ]);
  const seats = new Map<string, number>();
  const codeCounts = new Map<string, number>();
  codesSnap.docs.forEach((doc) => {
    const code = doc.data() as OrganizationActivationCode;
    if (!code.batchName || TERMINAL_CODE_STATUSES.has(code.status)) return;
    codeCounts.set(code.batchName, (codeCounts.get(code.batchName) ?? 0) + 1);
  });
  recordsSnap.docs.forEach((doc) => {
    const record = doc.data() as OrganizationBatch;
    seats.set(record.batchName, record.seatCount);
  });
  codeCounts.forEach((count, name) => {
    if (!seats.has(name)) seats.set(name, count);
  });
  return Array.from(seats.entries())
    .map(([name, codes]) => ({ name, codes }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Names of the classes (sheets) that sit on a batch period, from its codes and class records. */
export async function listClassNamesForSubscription(organizationId: string, subscriptionId: string): Promise<string[]> {
  const [recordsSnap, codesSnap] = await Promise.all([
    db
      .collection(Collections.organizationBatches)
      .where("organizationId", "==", organizationId)
      .where("subscriptionId", "==", subscriptionId)
      .get(),
    db
      .collection(Collections.organizationActivationCodes)
      .where("organizationId", "==", organizationId)
      .where("subscriptionId", "==", subscriptionId)
      .get(),
  ]);
  const names = new Set<string>();
  recordsSnap.docs.forEach((doc) => names.add((doc.data() as OrganizationBatch).batchName));
  codesSnap.docs.forEach((doc) => {
    const name = (doc.data() as OrganizationActivationCode).batchName;
    if (name) names.add(name);
  });
  return Array.from(names).sort();
}
