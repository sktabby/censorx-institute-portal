import { Timestamp } from "firebase-admin/firestore";
import { Collections } from "../config/collections";
import { logger } from "../config/logger";
import { db, newDocId, serverTimestamp } from "../repositories/firestoreRepository";
import {
  getOrganization,
  getSubscriptionById,
  isLiveBatch,
  listOrganizationLicenses,
  listOrganizationSubscriptions,
  sumLiveSeatLimit,
} from "../repositories/organizationRepository";
import { writeAuditLog } from "../repositories/auditLogRepository";
import { ApiError } from "../middleware/errorHandler";
import { restoreCoverage } from "./coverageRenewalService";
import {
  batchLabelOf,
  buildClassRecord,
  findClassRecord,
  listClassNamesForSubscription,
  listClassSeatsForSubscription,
  listOrganizationBatches,
  repointPendingBatches,
  updateClassRecordsWindow,
} from "./batchService";
import { buildPaymentRecord, sendBillForOrganization } from "./billService";
import { billingMonths } from "../utils/planDuration";
import { MAX_CODES_PER_CLASS } from "../config/limits";
import { sendBatchAccessEmail, sendBatchCreatedEmail, sendBatchRenewalEmail } from "./emailService";
import { createNotification } from "./notificationService";
import { countStudentsOnSubscription, subscriptionPlanName } from "./studentCounts";
import { addChargeToBill } from "./paymentService";
import type { Organization, OrganizationPayment, OrganizationSubscription, PaymentMethod, PaymentMethodDetails } from "../models/types";
import type { CreateBatchInput, RenewBatchInput } from "../types/serviceInputs";

export interface EmailOutcome {
  sent: boolean;
  to: string;
  warning?: string;
}

export interface CreateBatchResult {
  subscriptionId: string;
  batchNumber: number;
  batchLabel: string;
  seatLimit: number;
  classes: Array<{ batchId: string; batchName: string; seatCount: number }>;
  billNumber: string | null;
  batchEmail?: EmailOutcome;
  billEmail?: EmailOutcome;
}

export interface RenewBatchResult {
  subscriptionId: string;
  previousSubscriptionId: string;
  batchNumber: number;
  batchLabel: string;
  seatLimit: number;
  classes: string[];
  licensesRestored: number;
  codesRestored: number;
  studentsReactivated: number;
  pendingClassesMoved: string[];
  billNumber: string | null;
  renewalEmail?: EmailOutcome;
  billEmail?: EmailOutcome;
}

function assertSchoolCanChange(org: Organization) {
  if (org.status === "ARCHIVED") {
    throw new ApiError(409, "ORG_ARCHIVED", "This school has been archived and cannot be modified.");
  }
  if (org.status === "SUSPENDED") {
    throw new ApiError(409, "ORG_SUSPENDED", "This school is suspended. Reactivate it first.");
  }
}

function parseWindow(startAt: string, expiresAt: string) {
  const start = new Date(startAt);
  const end = new Date(expiresAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new ApiError(400, "INVALID_PLAN_DATES", "Start and end dates must be valid dates.");
  }
  if (end.getTime() <= start.getTime()) {
    throw new ApiError(400, "INVALID_PLAN_DATES", "Expiry date must be after start date.");
  }
  return { start, end };
}

async function assertNotDuplicate(idempotencyKey: string) {
  const ref = db.collection(Collections.organizationAuditLogs).doc(`idem_${idempotencyKey}`);
  if ((await ref.get()).exists) {
    throw new ApiError(409, "DUPLICATE_REQUEST", "This request has already been processed.");
  }
  return ref;
}

function describeClasses(classes: Array<{ batchName: string; seatCount: number }>) {
  return classes.map((item) => `${item.batchName} (${item.seatCount} code${item.seatCount === 1 ? "" : "s"})`).join(", ");
}

/**
 * Rewrites the school's stored aggregates from its batches and licences:
 *   purchasedSeats = seats of every live batch, activatedSeats = students holding a seat,
 *   status ACTIVE while any batch is live, EXPIRED once all have ended.
 * SUSPENDED/ARCHIVED are left alone. This is the one place the aggregates are recomputed in
 * full; redemption keeps reading them unchanged.
 */
export async function recomputeOrganizationAggregates(organizationId: string, actorUid: string): Promise<void> {
  const [org, subscriptions, licenses] = await Promise.all([
    getOrganization(organizationId),
    listOrganizationSubscriptions(organizationId),
    listOrganizationLicenses(organizationId),
  ]);
  if (!org) return;

  const update: Record<string, unknown> = {
    purchasedSeats: sumLiveSeatLimit(subscriptions),
    activatedSeats: licenses.filter((license) => license.status === "ACTIVE").length,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  if (org.status === "ACTIVE" || org.status === "EXPIRED") {
    if (subscriptions.length > 0) {
      update.status = subscriptions.some((subscription) => isLiveBatch(subscription)) ? "ACTIVE" : "EXPIRED";
    }
  }

  await db.collection(Collections.organizations).doc(organizationId).update(update);
}

async function sendBill(org: Organization, payment: OrganizationPayment): Promise<EmailOutcome> {
  try {
    await sendBillForOrganization(org, payment);
    return { sent: true, to: org.contactEmail };
  } catch (err) {
    logger.warn({ err, organizationId: org.organizationId, billNumber: payment.billNumber }, "Bill email could not be sent");
    return {
      sent: false,
      to: org.contactEmail,
      warning: "The bill email could not be sent. You can resend it from the school page.",
    };
  }
}

/**
 * Creates a new, independent batch for a school: its own dates, seats, payment and classes.
 * Nothing already in the school is touched — other batches keep their own dates and codes.
 * Classes are created with seats only; their codes are generated later in Create Codes.
 */
export async function createBatch(
  organizationId: string,
  input: CreateBatchInput,
  actorUid: string,
  options: { notify?: boolean } = {}
): Promise<CreateBatchResult> {
  const notify = options.notify ?? true;
  const org = await getOrganization(organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  assertSchoolCanChange(org);

  const classes = (input.classes ?? []).map((item) => ({
    batchName: item.batchName.trim(),
    seatCount: item.seatCount,
  }));
  if (classes.length === 0) {
    throw new ApiError(400, "CLASSES_REQUIRED", "Add at least one class with its number of codes.");
  }
  if (classes.some((item) => !item.batchName)) {
    throw new ApiError(400, "BATCH_NAME_REQUIRED", "Every class needs a name.");
  }
  if (classes.some((item) => !Number.isInteger(item.seatCount) || item.seatCount <= 0)) {
    throw new ApiError(400, "INVALID_SEAT_COUNT", "Every class needs a whole number of codes above 0.");
  }
  const tooBig = classes.find((item) => item.seatCount > MAX_CODES_PER_CLASS);
  if (tooBig) {
    throw new ApiError(
      400,
      "CLASS_TOO_LARGE",
      `A class can have at most ${MAX_CODES_PER_CLASS} codes (${tooBig.batchName} has ${tooBig.seatCount}). Split it into two classes.`
    );
  }
  const lowerNames = classes.map((item) => item.batchName.toLowerCase());
  if (new Set(lowerNames).size !== lowerNames.length) {
    throw new ApiError(409, "BATCH_NAME_TAKEN", "Each class needs its own name.");
  }
  const existing = await listOrganizationBatches(organizationId);
  const existingLower = new Set(existing.map((item) => item.batchName.toLowerCase()));
  const taken = classes.find((item) => existingLower.has(item.batchName.toLowerCase()));
  if (taken) {
    throw new ApiError(409, "BATCH_NAME_TAKEN", `A class named "${taken.batchName}" already exists for this school.`);
  }

  const { start, end } = parseWindow(input.startAt, input.expiresAt);
  const idempotencyRef = await assertNotDuplicate(input.idempotencyKey);

  const subscriptions = await listOrganizationSubscriptions(organizationId);
  const batchNumber = subscriptions.reduce((max, s) => Math.max(max, s.batchNumber ?? 1), 0) + 1;
  const batchLabel = `Batch ${batchNumber}`;
  const seatLimit = classes.reduce((sum, item) => sum + item.seatCount, 0);

  const subscriptionId = newDocId(Collections.organizationSubscriptions);
  const startAt = Timestamp.fromDate(start);
  const expiresAt = Timestamp.fromDate(end);
  const payment = input.payment
    ? buildPaymentRecord(input.payment, organizationId, new Date(), {
        reference: subscriptionId,
        description: `${batchLabel} — ${describeClasses(classes)}`,
        codeCount: seatLimit,
        recordedBy: actorUid,
        months: billingMonths(input.planDuration, start, end),
        invoice: {
          kind: "NEW",
          batchLabel,
          startAt: start,
          expiresAt: end,
          classes: classes.map((item) => ({ name: item.batchName, codes: item.seatCount })),
        },
      })
    : null;

  const classRecords = classes.map((item) => ({
    batchId: newDocId(Collections.organizationBatches),
    ...item,
  }));

  await db.runTransaction(async (tx) => {
    const now = serverTimestamp();
    tx.set(db.collection(Collections.organizationSubscriptions).doc(subscriptionId), {
      subscriptionId,
      organizationId,
      planDuration: input.planDuration,
      startAt,
      expiresAt,
      seatLimit,
      status: "ACTIVE",
      billingReference: input.billingReference ?? null,
      notes: input.notes ?? null,
      createdAt: now,
      createdBy: actorUid,
      updatedAt: now,
      renewedFromSubscriptionId: null,
      batchNumber,
      batchLabel,
      payment,
      cancelledAt: null,
      renewalReminderSentAt: null,
      renewalReminderEmailedAt: null,
      endedNoticeSentAt: null,
      endedEmailedAt: null,
    });

    classRecords.forEach((record) => {
      tx.set(
        db.collection(Collections.organizationBatches).doc(record.batchId),
        buildClassRecord(record.batchId, {
          organizationId,
          batchName: record.batchName,
          seatCount: record.seatCount,
          subscriptionId,
          startAt,
          expiresAt,
          actorUid,
        })
      );
    });

    tx.set(idempotencyRef, {
      auditId: idempotencyRef.id,
      actorUid,
      actorRole: "SUPER_ADMIN",
      action: "BATCH_CREATE_IDEMPOTENCY_LOCK",
      organizationId,
      targetType: "subscription",
      targetId: subscriptionId,
      metadata: { batchLabel, seatLimit },
      createdAt: now,
    });

    // The new batch is live from now (or from its start date), so the school is ACTIVE again
    // even if every earlier batch had ended. SUSPENDED/ARCHIVED were rejected above.
    tx.update(db.collection(Collections.organizations).doc(organizationId), {
      purchasedSeats: sumLiveSeatLimit(subscriptions) + seatLimit,
      status: "ACTIVE",
      currentSubscriptionId: subscriptionId,
      updatedAt: now,
      updatedBy: actorUid,
    });
  });

  let batchEmail: EmailOutcome | undefined;
  let billEmail: EmailOutcome | undefined;
  if (notify) {
    try {
      await sendBatchCreatedEmail({
        to: org.contactEmail,
        schoolName: org.name,
        planName: subscriptionPlanName({ planDuration: input.planDuration, startAt, expiresAt }),
        batchLabel,
        classes,
        startAt: start,
        expiresAt: end,
        totalSeats: seatLimit,
      });
      batchEmail = { sent: true, to: org.contactEmail };
    } catch (err) {
      logger.warn({ err, organizationId, subscriptionId }, "Batch created email could not be sent");
      batchEmail = {
        sent: false,
        to: org.contactEmail,
        warning: "The batch was created, but the email telling the school about it could not be sent.",
      };
    }
    if (payment) billEmail = await sendBill(org, payment);

    await createNotification({
      organizationId,
      type: "BATCH_CREATED",
      title: `${batchLabel} set up`,
      message: `${batchLabel} runs from ${start.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })} to ${end.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })} with ${classes.length} class${classes.length === 1 ? "" : "es"} (${seatLimit} codes): ${describeClasses(classes)}. Codes are emailed per class once generated and can be downloaded from Download Codes.`,
      subscriptionId,
      batchLabel,
    });
  }

  await writeAuditLog({
    actorUid,
    actorRole: "SUPER_ADMIN",
    action: "BATCH_CREATED",
    organizationId,
    targetType: "subscription",
    targetId: subscriptionId,
    metadata: {
      batchNumber,
      batchLabel,
      seatLimit,
      classes: classes.map((item) => ({ name: item.batchName, seats: item.seatCount })),
      billNumber: payment?.billNumber ?? null,
      startAt: start.toISOString(),
      expiresAt: end.toISOString(),
    },
  });

  return {
    subscriptionId,
    batchNumber,
    batchLabel,
    seatLimit,
    classes: classRecords,
    billNumber: payment?.billNumber ?? null,
    batchEmail,
    billEmail,
  };
}

/**
 * Renews ONE batch: a new period with new dates (and its own payment/bill) takes over the
 * batch's classes and seats; the renewed period is marked RENEWED. The same activation
 * codes keep working — only this batch's licences move, nothing else in the school changes.
 */
export async function renewBatch(
  organizationId: string,
  subscriptionId: string,
  input: RenewBatchInput,
  actorUid: string
): Promise<RenewBatchResult> {
  const org = await getOrganization(organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  assertSchoolCanChange(org);

  const { start, end } = parseWindow(input.startAt, input.expiresAt);

  const old = await getSubscriptionById(organizationId, subscriptionId);
  if (!old) throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "Batch not found for this school.");
  if (old.status === "RENEWED") {
    throw new ApiError(409, "BATCH_ALREADY_RENEWED", "This period was already renewed. Renew the batch's latest period instead.");
  }
  if (old.status === "CANCELLED") {
    throw new ApiError(409, "BATCH_CANCELLED", "This batch was cancelled and cannot be renewed. Create a new batch instead.");
  }
  if (old.status === "SUSPENDED") {
    // Renewing would give students access again and quietly undo the pause.
    throw new ApiError(409, "BATCH_PAUSED", "This batch is paused. Restart its access first, then renew it.");
  }
  if (end.getTime() <= old.expiresAt.toMillis()) {
    throw new ApiError(400, "INVALID_PLAN_DATES", "The new end date must be later than the batch's current end date.");
  }

  const idempotencyRef = await assertNotDuplicate(input.idempotencyKey);
  const classSeats = await listClassSeatsForSubscription(organizationId, subscriptionId);
  const classes = classSeats.map((item) => item.name);
  const subscriptions = await listOrganizationSubscriptions(organizationId);

  const newSubscriptionId = newDocId(Collections.organizationSubscriptions);
  const batchNumber = old.batchNumber ?? 1;
  const batchLabel = batchLabelOf(old);
  const seatLimit = input.seatLimit ?? old.seatLimit;
  const startAt = Timestamp.fromDate(start);
  const expiresAt = Timestamp.fromDate(end);
  const payment = input.payment
    ? buildPaymentRecord(input.payment, organizationId, new Date(), {
        reference: newSubscriptionId,
        description: `${batchLabel} renewal${classes.length ? ` — ${classes.join(", ")}` : ""}`,
        codeCount: seatLimit,
        recordedBy: actorUid,
        months: billingMonths(input.planDuration, start, end),
        invoice: { kind: "RENEWAL", batchLabel, startAt: start, expiresAt: end, classes: classSeats },
      })
    : null;

  await db.runTransaction(async (tx) => {
    const now = serverTimestamp();
    tx.set(db.collection(Collections.organizationSubscriptions).doc(newSubscriptionId), {
      subscriptionId: newSubscriptionId,
      organizationId,
      planDuration: input.planDuration,
      startAt,
      expiresAt,
      seatLimit,
      status: "ACTIVE",
      billingReference: input.billingReference ?? null,
      notes: input.notes ?? null,
      createdAt: now,
      createdBy: actorUid,
      updatedAt: now,
      renewedFromSubscriptionId: old.subscriptionId,
      batchNumber,
      batchLabel,
      payment,
      cancelledAt: null,
      renewalReminderSentAt: null,
      renewalReminderEmailedAt: null,
      endedNoticeSentAt: null,
      endedEmailedAt: null,
    });

    tx.update(db.collection(Collections.organizationSubscriptions).doc(old.subscriptionId), {
      status: "RENEWED",
      updatedAt: now,
    });

    tx.set(idempotencyRef, {
      auditId: idempotencyRef.id,
      actorUid,
      actorRole: "SUPER_ADMIN",
      action: "BATCH_RENEW_IDEMPOTENCY_LOCK",
      organizationId,
      targetType: "subscription",
      targetId: newSubscriptionId,
      metadata: { previousSubscriptionId: old.subscriptionId },
      createdAt: now,
    });

    // The renewed period stops counting (RENEWED) and the new one takes its place.
    const othersLive = sumLiveSeatLimit(subscriptions.filter((s) => s.subscriptionId !== old.subscriptionId));
    tx.update(db.collection(Collections.organizations).doc(organizationId), {
      purchasedSeats: othersLive + seatLimit,
      status: "ACTIVE",
      currentSubscriptionId: newSubscriptionId,
      updatedAt: now,
      updatedBy: actorUid,
    });
  });

  // Only this batch's licences and codes move onto the new period.
  const restored = await restoreCoverage({
    organizationId,
    targetSubscriptionId: newSubscriptionId,
    expiresAt,
    subscriptionIds: [old.subscriptionId],
    actorUid,
  });

  const pendingClassesMoved = await repointPendingBatches({
    organizationId,
    fromSubscriptionId: old.subscriptionId,
    subscriptionId: newSubscriptionId,
    startAt,
    expiresAt,
  });

  await db.collection(Collections.organizations).doc(organizationId).update({
    activatedSeats: restored.activatedSeats,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  let renewalEmail: EmailOutcome | undefined;
  try {
    await sendBatchRenewalEmail({
      to: org.contactEmail,
      schoolName: org.name,
      contactName: org.contactName,
      planName: subscriptionPlanName({ planDuration: input.planDuration, startAt, expiresAt }),
      batchLabel,
      batchNames: classes,
      startAt: start,
      expiresAt: end,
      activeCount: await countStudentsOnSubscription(organizationId, newSubscriptionId),
      billSent: !!payment,
    });
    renewalEmail = { sent: true, to: org.contactEmail };
  } catch (err) {
    logger.warn({ err, organizationId, subscriptionId: newSubscriptionId }, "Batch renewal email could not be sent");
    renewalEmail = {
      sent: false,
      to: org.contactEmail,
      warning: "The batch was renewed, but the notification email to the school could not be sent.",
    };
  }
  const billEmail = payment ? await sendBill(org, payment) : undefined;

  await createNotification({
    organizationId,
    type: "BATCH_RENEWED",
    title: `${batchLabel} renewed`,
    message: `${batchLabel} now runs until ${end.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}. The same codes keep working; students who were locked out can open the app again.`,
    subscriptionId: newSubscriptionId,
    batchLabel,
  });

  await writeAuditLog({
    actorUid,
    actorRole: "SUPER_ADMIN",
    action: "BATCH_RENEWED",
    organizationId,
    targetType: "subscription",
    targetId: newSubscriptionId,
    metadata: {
      previousSubscriptionId: old.subscriptionId,
      batchLabel,
      classes,
      seatLimit,
      licensesRestored: restored.licensesRestored,
      codesRestored: restored.codesRestored,
      studentsReactivated: restored.studentsReactivated,
      pendingClassesMoved,
      billNumber: payment?.billNumber ?? null,
      startAt: start.toISOString(),
      expiresAt: end.toISOString(),
    },
  });

  return {
    subscriptionId: newSubscriptionId,
    previousSubscriptionId: old.subscriptionId,
    batchNumber,
    batchLabel,
    seatLimit,
    classes,
    licensesRestored: restored.licensesRestored,
    codesRestored: restored.codesRestored,
    studentsReactivated: restored.studentsReactivated,
    pendingClassesMoved,
    billNumber: payment?.billNumber ?? null,
    renewalEmail,
    billEmail,
  };
}

/**
 * Cancels ONE batch. Access for its classes stops immediately (a deliberate product decision,
 * see organizationRepository); other batches are untouched. The school only becomes EXPIRED
 * if no live batch remains.
 */
export async function cancelBatch(organizationId: string, subscriptionId: string, actorUid: string) {
  const org = await getOrganization(organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  if (org.status === "ARCHIVED") {
    throw new ApiError(409, "ORG_ARCHIVED", "This school has been archived and cannot be modified.");
  }

  const subscription = await getSubscriptionById(organizationId, subscriptionId);
  if (!subscription) throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "Batch not found for this school.");
  if (subscription.status === "CANCELLED") return { cancelled: true, alreadyCancelled: true };
  if (subscription.status === "RENEWED") {
    throw new ApiError(409, "BATCH_ALREADY_RENEWED", "This period was renewed; cancel the batch's latest period instead.");
  }

  await db.collection(Collections.organizationSubscriptions).doc(subscriptionId).update({
    status: "CANCELLED",
    cancelledAt: Timestamp.now(),
    updatedAt: serverTimestamp(),
  });

  await recomputeOrganizationAggregates(organizationId, actorUid);

  await writeAuditLog({
    actorUid,
    actorRole: "SUPER_ADMIN",
    action: "BATCH_CANCELLED",
    organizationId,
    targetType: "subscription",
    targetId: subscriptionId,
    metadata: { batchLabel: batchLabelOf(subscription) },
  });

  return { cancelled: true, alreadyCancelled: false };
}

/**
 * Stops access for ONE batch, by hand (e.g. payment overdue). Its period is marked SUSPENDED,
 * which the app's own checks already treat as "no coverage", so its students lose access; their
 * entitlements are marked EXPIRED straight away. Codes and licences are kept as they are, and
 * other batches are untouched. Undo with resumeBatch.
 */
export async function pauseBatch(organizationId: string, subscriptionId: string, reason: string | null, actorUid: string) {
  const org = await getOrganization(organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  if (org.status === "ARCHIVED") throw new ApiError(409, "ORG_ARCHIVED", "This school has been archived.");

  const subscription = await getSubscriptionById(organizationId, subscriptionId);
  if (!subscription) throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "Batch not found for this school.");
  if (subscription.status === "SUSPENDED") return { paused: true, alreadyPaused: true, studentsAffected: 0 };
  if (subscription.status !== "ACTIVE") {
    throw new ApiError(409, "BATCH_NOT_LIVE", `${batchLabelOf(subscription)} is ${subscription.status.toLowerCase()}, so there is no access to stop.`);
  }

  const now = Timestamp.now();
  await db.collection(Collections.organizationSubscriptions).doc(subscriptionId).update({
    status: "SUSPENDED",
    pausedAt: now,
    pauseReason: reason?.trim() || null,
    updatedAt: serverTimestamp(),
  });

  // Students of this batch: their single entitlement goes EXPIRED only when it points at a
  // licence of this batch (a student whose entitlement belongs to another batch keeps it).
  const licensesSnap = await db
    .collection(Collections.organizationLicenses)
    .where("organizationId", "==", organizationId)
    .where("subscriptionId", "==", subscriptionId)
    .get();
  const batchLicenseIds = new Set(licensesSnap.docs.map((doc) => doc.id));
  const students = Array.from(
    new Set(
      licensesSnap.docs
        .map((doc) => doc.data() as { studentUid?: string | null; status?: string })
        .filter((license) => license.studentUid && license.status === "ACTIVE")
        .map((license) => license.studentUid as string)
    )
  );

  let studentsAffected = 0;
  for (const studentUid of students) {
    const ref = db.collection(Collections.userOrganizationEntitlements).doc(studentUid);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const entitlement = snap.data() as { licenseId?: string; status?: string };
    if (!entitlement.licenseId || !batchLicenseIds.has(entitlement.licenseId) || entitlement.status !== "ACTIVE") continue;
    await ref.set({ status: "EXPIRED", serverCheckedAt: now, updatedAt: now }, { merge: true });
    studentsAffected++;
  }

  await recomputeOrganizationAggregates(organizationId, actorUid);

  const label = batchLabelOf(subscription);
  const classNames = await listClassNamesForSubscription(organizationId, subscriptionId);
  try {
    await sendBatchAccessEmail({
      to: org.contactEmail,
      schoolName: org.name,
      contactName: org.contactName,
      planName: subscriptionPlanName(subscription),
      batchLabel: label,
      classNames,
      paused: true,
      at: now.toDate(),
      studentCount: students.length,
      reason,
      invoiceNumber: subscription.payment?.billNumber ?? null,
    });
  } catch (err) {
    logger.warn({ err, organizationId, subscriptionId }, "Access paused email could not be sent");
  }
  await createNotification({
    organizationId,
    type: "BATCH_PAUSED",
    title: `${label} access paused`,
    message:
      `Access for ${label} has been paused${reason?.trim() ? `: ${reason.trim()}` : ""}. ` +
      "Students in its classes cannot use the app until it is restored. Their codes are kept. Contact CensorX to restore access.",
    subscriptionId,
    batchLabel: label,
  });

  await writeAuditLog({
    actorUid,
    actorRole: "SUPER_ADMIN",
    action: "BATCH_PAUSED",
    organizationId,
    targetType: "subscription",
    targetId: subscriptionId,
    metadata: { batchLabel: label, reason: reason ?? null, studentsAffected },
  });

  return { paused: true, alreadyPaused: false, studentsAffected };
}

/**
 * Turns the renewal (marketing) emails for an ended period off or on again, e.g. when the school
 * asks to stop them. Nothing else about the batch changes.
 */
export async function setRenewalEmails(organizationId: string, subscriptionId: string, enabled: boolean, actorUid: string) {
  const subscription = await getSubscriptionById(organizationId, subscriptionId);
  if (!subscription) throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "Batch not found for this school.");
  await db
    .collection(Collections.organizationSubscriptions)
    .doc(subscriptionId)
    .update({ renewalEmailsStoppedAt: enabled ? null : Timestamp.now(), updatedAt: serverTimestamp() });
  await writeAuditLog({
    actorUid,
    actorRole: "SUPER_ADMIN",
    action: enabled ? "RENEWAL_EMAILS_RESUMED" : "RENEWAL_EMAILS_STOPPED",
    organizationId,
    targetType: "subscription",
    targetId: subscriptionId,
    metadata: { batchLabel: batchLabelOf(subscription) },
  });
  return { renewalEmails: enabled };
}

/** Restarts access for a paused batch. The same codes work again until the batch's own end date. */
export async function resumeBatch(organizationId: string, subscriptionId: string, actorUid: string) {
  const org = await getOrganization(organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  if (org.status === "ARCHIVED") throw new ApiError(409, "ORG_ARCHIVED", "This school has been archived.");

  const subscription = await getSubscriptionById(organizationId, subscriptionId);
  if (!subscription) throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "Batch not found for this school.");
  if (subscription.status !== "SUSPENDED") {
    throw new ApiError(409, "BATCH_NOT_PAUSED", `${batchLabelOf(subscription)} is not paused.`);
  }

  // Same mechanism as a renewal, keeping the batch's own end date: licences, codes and
  // entitlements of this batch come back. Run while the batch still reads as paused, so the
  // count of students given access back is right.
  const ended = subscription.expiresAt.toMillis() <= Date.now();
  const restored = ended
    ? { licensesRestored: 0, studentsReactivated: 0 }
    : await restoreCoverage({
        organizationId,
        targetSubscriptionId: subscriptionId,
        expiresAt: subscription.expiresAt,
        subscriptionIds: [subscriptionId],
        actorUid,
      });

  await db.collection(Collections.organizationSubscriptions).doc(subscriptionId).update({
    status: "ACTIVE",
    pausedAt: null,
    pauseReason: null,
    updatedAt: serverTimestamp(),
  });

  await recomputeOrganizationAggregates(organizationId, actorUid);

  const label = batchLabelOf(subscription);
  const classNames = await listClassNamesForSubscription(organizationId, subscriptionId);
  try {
    await sendBatchAccessEmail({
      to: org.contactEmail,
      schoolName: org.name,
      contactName: org.contactName,
      planName: subscriptionPlanName(subscription),
      batchLabel: label,
      classNames,
      paused: false,
      at: new Date(),
      studentCount: ended ? null : await countStudentsOnSubscription(organizationId, subscriptionId),
      expiresAt: subscription.expiresAt.toDate(),
      ended,
    });
  } catch (err) {
    logger.warn({ err, organizationId, subscriptionId }, "Access restored email could not be sent");
  }
  await createNotification({
    organizationId,
    type: "BATCH_RESUMED",
    title: `${label} access restored`,
    message: ended
      ? `${label} is no longer paused, but its end date has passed. Renew it to give students access again.`
      : `Access for ${label} has been restored. Students can open the app again with the same codes.`,
    subscriptionId,
    batchLabel: label,
  });

  await writeAuditLog({
    actorUid,
    actorRole: "SUPER_ADMIN",
    action: "BATCH_RESUMED",
    organizationId,
    targetType: "subscription",
    targetId: subscriptionId,
    metadata: { batchLabel: label, licensesRestored: restored.licensesRestored, studentsReactivated: restored.studentsReactivated, ended },
  });

  return { resumed: true, ended, studentsReactivated: restored.studentsReactivated };
}

/** Pushes ONE batch's end date later. Its licences, codes, entitlements and class records follow. */
export async function extendBatch(organizationId: string, subscriptionId: string, newExpiresAt: string, actorUid: string) {
  const org = await getOrganization(organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  assertSchoolCanChange(org);

  const subscription = await getSubscriptionById(organizationId, subscriptionId);
  if (!subscription) throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "Batch not found for this school.");
  if (subscription.status === "SUSPENDED") {
    throw new ApiError(409, "BATCH_PAUSED", "This batch is paused. Restart its access first.");
  }
  if (subscription.status === "RENEWED" || subscription.status === "CANCELLED") {
    throw new ApiError(409, "BATCH_NOT_EXTENDABLE", "Only a batch's latest, non-cancelled period can be extended.");
  }

  const newExpiry = Timestamp.fromDate(new Date(newExpiresAt));
  if (Number.isNaN(newExpiry.toMillis()) || newExpiry.toMillis() <= subscription.expiresAt.toMillis()) {
    throw new ApiError(400, "INVALID_EXPIRY", "New expiry date must be later than the current expiry date.");
  }

  await db
    .collection(Collections.organizationSubscriptions)
    .doc(subscriptionId)
    .update({ expiresAt: newExpiry, status: "ACTIVE", updatedAt: serverTimestamp() });

  const restored = await restoreCoverage({
    organizationId,
    targetSubscriptionId: subscriptionId,
    expiresAt: newExpiry,
    subscriptionIds: [subscriptionId],
    actorUid,
  });
  await updateClassRecordsWindow({ organizationId, subscriptionId, expiresAt: newExpiry });
  await recomputeOrganizationAggregates(organizationId, actorUid);

  await writeAuditLog({
    actorUid,
    actorRole: "SUPER_ADMIN",
    action: "BATCH_EXTENDED",
    organizationId,
    targetType: "subscription",
    targetId: subscriptionId,
    metadata: {
      batchLabel: batchLabelOf(subscription),
      newExpiresAt,
      licensesRestored: restored.licensesRestored,
      studentsReactivated: restored.studentsReactivated,
    },
  });

  return restored;
}

/** Whole months left in a batch (at least 1), the same way the portal works out the default price. */
export function monthsLeft(expiresAt: Date, now = new Date()) {
  const days = (expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
  return Math.max(1, Math.round(days / 30.4375));
}

/** Price for extra codes added to a class. `amount` 0 means the codes are free. */
export interface ExtraCodesCharge {
  amount: number;
  /** When the extra amount is due (ISO). Required when amount > 0. */
  dueDate?: string;
  /** Set when the amount was worked out as codes × rate × months left. */
  ratePerCodePerMonth?: number;
  months?: number;
  /** Paid on the spot: recorded with the charge, so no installment or due date is added. */
  paidNow?: { method: PaymentMethod; methodDetails?: PaymentMethodDetails };
}

/**
 * Adds a few more codes to a class that already exists, inside the same batch — for the
 * "one or two students joined later" case. The batch's seat limit grows by the same amount
 * and the class goes back to waiting in Create Codes for exactly those extra codes.
 * With a price, the batch's bill gets a new line and installment, and a new bill is issued.
 */
export async function addSeatsToClass(
  organizationId: string,
  subscriptionId: string,
  batchName: string,
  extraSeats: number,
  actorUid: string,
  charge?: ExtraCodesCharge
) {
  const org = await getOrganization(organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  assertSchoolCanChange(org);
  if (!Number.isInteger(extraSeats) || extraSeats <= 0) {
    throw new ApiError(400, "INVALID_SEAT_COUNT", "Enter a whole number of codes above 0.");
  }

  const subscription = await getSubscriptionById(organizationId, subscriptionId);
  if (!subscription) throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "Batch not found for this school.");
  if (!isLiveBatch(subscription)) {
    throw new ApiError(409, "BATCH_NOT_LIVE", "This batch is not live. Renew it first, or create a new batch.");
  }

  // Checked before anything changes, so a refused charge never leaves seats half-added.
  const charged = !!charge && charge.amount > 0;
  if (charged) {
    if (!subscription.payment) {
      throw new ApiError(409, "BILL_NOT_FOUND", "This batch has no bill to add the charge to. Set the price to 0, or record it separately.");
    }
    if (!charge!.paidNow && (!charge!.dueDate || Number.isNaN(new Date(charge!.dueDate).getTime()))) {
      throw new ApiError(400, "VALIDATION_ERROR", "Choose when the extra amount is due.");
    }
  }

  const record = await findClassRecord(organizationId, batchName.trim());
  const codesSnap = await db
    .collection(Collections.organizationActivationCodes)
    .where("organizationId", "==", organizationId)
    .where("batchName", "==", batchName.trim())
    .get();
  const codeSubscriptionIds = new Set(codesSnap.docs.map((doc) => (doc.data() as { subscriptionId: string }).subscriptionId));

  if (!record && codesSnap.empty) {
    throw new ApiError(404, "BATCH_NOT_FOUND", `Class not found: ${batchName}`);
  }
  const classSubscriptionId = record?.subscriptionId ?? Array.from(codeSubscriptionIds)[0];
  if (classSubscriptionId !== subscriptionId) {
    throw new ApiError(409, "CLASS_BATCH_MISMATCH", "This class belongs to a different batch.");
  }

  const existingCodes = codesSnap.size;
  const newSeatCount = (record?.seatCount ?? existingCodes) + extraSeats;
  if (newSeatCount > MAX_CODES_PER_CLASS) {
    throw new ApiError(
      400,
      "CLASS_TOO_LARGE",
      `A class can have at most ${MAX_CODES_PER_CLASS} codes. ${batchName.trim()} would have ${newSeatCount}. Add a new class for the rest.`
    );
  }
  const recordId = record?.batchId ?? newDocId(Collections.organizationBatches);

  await db.runTransaction(async (tx) => {
    const now = serverTimestamp();
    const recordRef = db.collection(Collections.organizationBatches).doc(recordId);
    if (record) {
      tx.update(recordRef, { seatCount: newSeatCount, status: "PENDING", updatedAt: now });
    } else {
      tx.set(recordRef, {
        ...buildClassRecord(recordId, {
          organizationId,
          batchName: batchName.trim(),
          seatCount: newSeatCount,
          subscriptionId,
          startAt: subscription.startAt,
          expiresAt: subscription.expiresAt,
          actorUid,
        }),
      });
    }
    tx.update(db.collection(Collections.organizationSubscriptions).doc(subscriptionId), {
      seatLimit: subscription.seatLimit + extraSeats,
      updatedAt: now,
    });
    tx.update(db.collection(Collections.organizations).doc(organizationId), {
      purchasedSeats: (org.purchasedSeats ?? 0) + extraSeats,
      updatedAt: now,
      updatedBy: actorUid,
    });
  });

  await writeAuditLog({
    actorUid,
    actorRole: "SUPER_ADMIN",
    action: "CLASS_SEATS_ADDED",
    organizationId,
    targetType: "codeBatch",
    targetId: batchName.trim(),
    metadata: { subscriptionId, extraSeats, newSeatCount, batchLabel: batchLabelOf(subscription), charge: charge?.amount ?? 0 },
  });

  let bill: Awaited<ReturnType<typeof addChargeToBill>> | null = null;
  if (charged) {
    const name = batchName.trim();
    const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
    bill = await addChargeToBill(
      organizationId,
      subscriptionId,
      {
        item: `${name} — ${extraSeats} extra code${extraSeats === 1 ? "" : "s"}`,
        detail: `${batchLabelOf(subscription)} · added ${today}`,
        quantity: extraSeats,
        ratePerCodePerMonth: charge!.ratePerCodePerMonth,
        months: charge!.months,
        amount: charge!.amount,
        dueDate: charge!.dueDate,
        paidNow: charge!.paidNow,
        note: `${extraSeats} extra code${extraSeats === 1 ? "" : "s"} added to ${name} on ${today}`,
      },
      actorUid
    );
  }

  return {
    batchName: batchName.trim(),
    subscriptionId,
    seatCount: newSeatCount,
    pendingSeats: Math.max(0, newSeatCount - existingCodes),
    seatLimit: subscription.seatLimit + extraSeats,
    bill,
  };
}

/** The bill (payment record) of one batch period, or null when none was recorded. */
export async function getBatchPayment(organizationId: string, subscriptionId: string) {
  const subscription = await getSubscriptionById(organizationId, subscriptionId);
  if (!subscription) throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "Batch not found for this school.");
  return { subscription, payment: subscription.payment ?? null };
}

export type { OrganizationSubscription };
