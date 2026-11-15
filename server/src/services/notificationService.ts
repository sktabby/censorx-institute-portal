import { Timestamp } from "firebase-admin/firestore";
import { Collections } from "../config/collections";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { db, newDocId, serverTimestamp } from "../repositories/firestoreRepository";
import { getEffectiveSubscriptionStatus } from "../repositories/organizationRepository";
import { batchLabelOf, listClassNamesForSubscription } from "./batchService";
import { sendBatchEndedEmail, sendBatchEndingSoonEmail, sendPaymentReminderEmail, sendRenewalOfferEmail } from "./emailService";
import { installmentViews } from "./paymentSchedule";
import { countStudentsOnSubscription, subscriptionPlanName } from "./studentCounts";
import type {
  NotificationType,
  Organization,
  OrganizationNotification,
  OrganizationSubscription,
} from "../models/types";

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * A batch that ended longer ago than this gets no "ended" notice. Protects schools from a
 * flood of old notices the first time the job runs over historical data.
 */
const ENDED_NOTICE_WINDOW_MS = 14 * DAY_MS;

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

export interface CreateNotificationInput {
  organizationId: string;
  type: NotificationType;
  title: string;
  message: string;
  subscriptionId?: string | null;
  batchLabel?: string | null;
}

/** Writes one in-app notice for a school. Never throws: a failed notice must not fail the action. */
export async function createNotification(input: CreateNotificationInput): Promise<string | null> {
  try {
    const notificationId = newDocId(Collections.organizationNotifications);
    await db.collection(Collections.organizationNotifications).doc(notificationId).set({
      notificationId,
      organizationId: input.organizationId,
      type: input.type,
      title: input.title,
      message: input.message,
      subscriptionId: input.subscriptionId ?? null,
      batchLabel: input.batchLabel ?? null,
      createdAt: serverTimestamp(),
      readAt: null,
    });
    return notificationId;
  } catch (err) {
    logger.warn({ err, organizationId: input.organizationId, type: input.type }, "Could not write in-app notification");
    return null;
  }
}

export interface NotificationRow {
  notificationId: string;
  type: NotificationType;
  title: string;
  message: string;
  subscriptionId: string | null;
  batchLabel: string | null;
  createdAt: string | null;
  readAt: string | null;
}

export async function listNotifications(
  organizationId: string,
  options: { page?: number; pageSize?: number } = {}
) {
  const page = Math.max(1, Number(options.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(options.pageSize ?? 20)));

  const snap = await db
    .collection(Collections.organizationNotifications)
    .where("organizationId", "==", organizationId)
    .get();

  const rows = snap.docs
    .map((doc) => doc.data() as OrganizationNotification)
    .sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt));

  const unreadCount = rows.filter((row) => !row.readAt).length;
  const items: NotificationRow[] = rows.slice((page - 1) * pageSize, page * pageSize).map((row) => ({
    notificationId: row.notificationId,
    type: row.type,
    title: row.title,
    message: row.message,
    subscriptionId: row.subscriptionId ?? null,
    batchLabel: row.batchLabel ?? null,
    createdAt: timestampToIso(row.createdAt),
    readAt: timestampToIso(row.readAt),
  }));

  return {
    items,
    total: rows.length,
    unreadCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(rows.length / pageSize)),
  };
}

export async function countUnreadNotifications(organizationId: string): Promise<number> {
  const snap = await db
    .collection(Collections.organizationNotifications)
    .where("organizationId", "==", organizationId)
    .where("readAt", "==", null)
    .get();
  return snap.size;
}

/** Marks the given notices read, or every unread notice of the school when no ids are given. */
export async function markNotificationsRead(organizationId: string, notificationIds?: string[]): Promise<number> {
  const snap = await db
    .collection(Collections.organizationNotifications)
    .where("organizationId", "==", organizationId)
    .get();

  const wanted = notificationIds?.length ? new Set(notificationIds) : null;
  const targets = snap.docs.filter((doc) => {
    const row = doc.data() as OrganizationNotification;
    if (row.readAt) return false;
    return !wanted || wanted.has(row.notificationId);
  });
  if (targets.length === 0) return 0;

  const now = Timestamp.now();
  const batch = db.batch();
  targets.forEach((doc) => batch.update(doc.ref, { readAt: now }));
  await batch.commit();
  return targets.length;
}

// ---------------------------------------------------------------------------
// Daily job: "ends in N days" and "has ended" notices.
// ---------------------------------------------------------------------------

export interface BatchNotificationResult {
  remindersCreated: number;
  reminderEmailsSent: number;
  endedNoticesCreated: number;
  endedEmailsSent: number;
  /** Installment reminders (upcoming, due, overdue) sent. */
  paymentRemindersSent: number;
  /** "Still overdue" follow-ups (every 3 days after the overdue email, until paid). */
  paymentFollowUpsSent: number;
  /** Renewal emails for ended periods (every 4 days until renewed). */
  renewalOffersSent: number;
  emailFailures: number;
  durationMs: number;
}

const PAYMENT_REMINDER_DAYS_BEFORE = 3;
/**
 * After the overdue email, a follow-up goes every 3 days until the installment is paid; after
 * the "ended" email, a renewal email every 4 days until the period is renewed. The job runs once
 * a night, so a gap counts as reached a couple of hours early (the run time drifts a little).
 */
const PAYMENT_FOLLOW_UP_GAP_MS = 3 * DAY_MS - 2 * 60 * 60 * 1000;
const RENEWAL_OFFER_GAP_MS = 4 * DAY_MS - 2 * 60 * 60 * 1000;

function inr(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(value);
}

/**
 * Installment reminders for every bill with a balance: 3 days before the due date, on the due
 * date, and once 7 days overdue. Each stage is sent once per installment (in-app + email);
 * a stage that was missed (e.g. the job was off) is skipped in favour of the latest one.
 */
async function runPaymentReminders(
  subscriptionsSnap: FirebaseFirestore.QuerySnapshot,
  orgById: Map<string, Organization>,
  now: Date,
  result: BatchNotificationResult
) {
  const nowTimestamp = Timestamp.fromDate(now);
  for (const doc of subscriptionsSnap.docs) {
    const subscription = doc.data() as OrganizationSubscription;
    const payment = subscription.payment;
    if (!payment?.installmentPlan?.length || payment.pendingAmount <= 0) continue;
    if (subscription.status === "CANCELLED") continue;
    const org = orgById.get(subscription.organizationId);
    if (!org || org.status === "ARCHIVED") continue;

    const views = installmentViews(payment, { asOf: now });
    const plan = payment.installmentPlan.map((item) => ({ ...item }));
    let changed = false;
    const label = batchLabelOf(subscription);

    const sendEmail = async (view: (typeof views)[number], stage: "UPCOMING" | "DUE" | "OVERDUE" | "FOLLOW_UP", followUpNumber?: number) => {
      try {
        await sendPaymentReminderEmail({
          to: org.contactEmail,
          schoolName: org.name,
          contactName: org.contactName,
          planName: subscriptionPlanName(subscription),
          batchLabel: label,
          invoiceNumber: payment.billNumber,
          installmentNumber: view.number,
          installmentCount: plan.length,
          amount: view.remaining,
          dueDate: view.dueDate,
          total: payment.totalAmount,
          paid: payment.paidAmount,
          balance: payment.pendingAmount,
          daysOverdue: Math.max(0, Math.floor((now.getTime() - view.dueDate.getTime()) / DAY_MS)),
          studentCount:
            stage === "OVERDUE" || stage === "FOLLOW_UP" ? await countStudentsOnSubscription(org.organizationId, subscription.subscriptionId) : null,
          stage,
          followUpNumber,
        });
        return true;
      } catch (err) {
        result.emailFailures++;
        logger.warn({ err, organizationId: org.organizationId, subscriptionId: subscription.subscriptionId }, "Payment reminder email could not be sent");
        return false;
      }
    };

    for (const view of views) {
      const item = plan.find((entry) => entry.number === view.number);
      if (!item) continue;
      if (view.status === "PAID") {
        // Paid since: an email still waiting to be sent is no longer needed.
        if (item.reminderEmailPending) {
          item.reminderEmailPending = null;
          changed = true;
        }
        continue;
      }
      const msUntil = view.dueDate.getTime() - now.getTime();

      let stage: "UPCOMING" | "DUE" | "OVERDUE" | null = null;
      if (view.status === "OVERDUE" && !item.overdueNoticeAt) stage = "OVERDUE";
      else if (view.status === "DUE" && !item.dueNoticeAt) stage = "DUE";
      else if (msUntil > 0 && msUntil <= PAYMENT_REMINDER_DAYS_BEFORE * DAY_MS && !item.upcomingNoticeAt && !item.dueNoticeAt) stage = "UPCOMING";
      if (!stage) {
        // No new reminder today: retry an email that failed on an earlier night.
        if (item.reminderEmailPending) {
          if (await sendEmail(view, item.reminderEmailPending)) {
            item.reminderEmailPending = null;
            changed = true;
          }
          continue;
        }
        // Still overdue after the overdue email: a follow-up every 3 days until it is paid.
        // Email only (no new in-app notice each time). A failed one is simply tried next night.
        if (view.status === "OVERDUE" && item.overdueNoticeAt) {
          const last = timestampMillis(item.followUpEmailedAt) || timestampMillis(item.overdueNoticeAt);
          if (now.getTime() - last >= PAYMENT_FOLLOW_UP_GAP_MS) {
            const count = (item.followUpCount ?? 0) + 1;
            if (await sendEmail(view, "FOLLOW_UP", count)) {
              item.followUpEmailedAt = nowTimestamp;
              item.followUpCount = count;
              changed = true;
              result.paymentFollowUpsSent++;
            }
          }
        }
        continue;
      }

      const due = view.dueDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
      await createNotification({
        organizationId: org.organizationId,
        type: stage === "OVERDUE" ? "PAYMENT_OVERDUE" : "PAYMENT_DUE",
        title:
          stage === "UPCOMING"
            ? `${label}: installment ${view.number} due on ${due}`
            : stage === "DUE"
              ? `${label}: installment ${view.number} is due`
              : `${label}: installment ${view.number} is overdue`,
        message:
          `${inr(view.remaining)} for ${label} ${stage === "UPCOMING" ? "is due on" : "was due on"} ${due} (invoice ${payment.billNumber}). ` +
          (stage === "OVERDUE"
            ? "Please pay as soon as possible; access for this batch may be paused if payments stay overdue."
            : "If you have already paid, you can ignore this message."),
        subscriptionId: subscription.subscriptionId,
        batchLabel: label,
      });

      // A newer reminder replaces any older one still waiting to be emailed.
      item.reminderEmailPending = (await sendEmail(view, stage)) ? null : stage;

      // Later stages imply the earlier ones, so a missed earlier reminder is never sent late.
      item.upcomingNoticeAt = item.upcomingNoticeAt ?? nowTimestamp;
      if (stage === "DUE" || stage === "OVERDUE") item.dueNoticeAt = item.dueNoticeAt ?? nowTimestamp;
      if (stage === "OVERDUE") item.overdueNoticeAt = nowTimestamp;
      changed = true;
      result.paymentRemindersSent++;
    }

    if (changed) {
      await doc.ref.update({ payment: { ...payment, installmentPlan: plan }, updatedAt: serverTimestamp() });
    }
  }
}

/**
 * Looks at every batch period and, once per period:
 *   - within the last N days before its end: in-app notice + email to the school's contact;
 *   - after it has ended (and not renewed or cancelled): in-app notice + email with our
 *     contact details, so the school knows how to renew.
 *
 * The in-app notice is created exactly once (…SentAt). The email is retried on later runs
 * until the mail server accepts it (…EmailedAt), so a one-off SMTP outage does not lose it.
 * Suspended and archived schools get nothing.
 */
export async function runBatchNotifications(
  options: { now?: Date; reminderDays?: number } = {}
): Promise<BatchNotificationResult> {
  const startedAt = Date.now();
  const now = options.now ?? new Date();
  const reminderDays = options.reminderDays ?? env.BATCH_REMINDER_DAYS;
  const nowMillis = now.getTime();
  const nowTimestamp = Timestamp.fromDate(now);

  const result: BatchNotificationResult = {
    remindersCreated: 0,
    reminderEmailsSent: 0,
    endedNoticesCreated: 0,
    endedEmailsSent: 0,
    paymentRemindersSent: 0,
    paymentFollowUpsSent: 0,
    renewalOffersSent: 0,
    emailFailures: 0,
    durationMs: 0,
  };

  const [subscriptionsSnap, orgsSnap] = await Promise.all([
    db.collection(Collections.organizationSubscriptions).get(),
    db.collection(Collections.organizations).get(),
  ]);
  const orgById = new Map<string, Organization>();
  orgsSnap.docs.forEach((doc) => orgById.set(doc.id, doc.data() as Organization));

  for (const doc of subscriptionsSnap.docs) {
    const subscription = doc.data() as OrganizationSubscription;
    if (subscription.status !== "ACTIVE" && subscription.status !== "EXPIRED") continue;

    const org = orgById.get(subscription.organizationId);
    if (!org || org.status === "SUSPENDED" || org.status === "ARCHIVED") continue;

    const expiresMillis = timestampMillis(subscription.expiresAt);
    if (!expiresMillis) continue;
    const msLeft = expiresMillis - nowMillis;
    const label = batchLabelOf(subscription);
    const expiresAt = new Date(expiresMillis);
    const effective = getEffectiveSubscriptionStatus(subscription, now);

    // --- Ending soon -------------------------------------------------------
    if (effective === "ACTIVE" && msLeft > 0 && msLeft <= reminderDays * DAY_MS) {
      const daysLeft = Math.max(1, Math.ceil(msLeft / DAY_MS));
      const update: Record<string, unknown> = {};

      if (!subscription.renewalReminderSentAt) {
        await createNotification({
          organizationId: org.organizationId,
          type: "BATCH_ENDING_SOON",
          title: `${label} ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
          message:
            `${label} ends on ${expiresAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}. ` +
            "After that the students in its classes cannot use the app until it is renewed. Contact CensorX to renew — the same codes keep working.",
          subscriptionId: subscription.subscriptionId,
          batchLabel: label,
        });
        update.renewalReminderSentAt = nowTimestamp;
        result.remindersCreated++;
      }

      if (!subscription.renewalReminderEmailedAt) {
        try {
          await sendBatchEndingSoonEmail({
            to: org.contactEmail,
            schoolName: org.name,
            contactName: org.contactName,
            planName: subscriptionPlanName(subscription),
            batchLabel: label,
            classNames: await listClassNamesForSubscription(org.organizationId, subscription.subscriptionId),
            expiresAt,
            daysLeft,
            activeCount: await countStudentsOnSubscription(org.organizationId, subscription.subscriptionId),
          });
          update.renewalReminderEmailedAt = nowTimestamp;
          result.reminderEmailsSent++;
        } catch (err) {
          result.emailFailures++;
          logger.warn(
            { err, organizationId: org.organizationId, subscriptionId: subscription.subscriptionId },
            "Batch ending-soon email could not be sent"
          );
        }
      }

      if (Object.keys(update).length > 0) {
        update.updatedAt = serverTimestamp();
        await doc.ref.update(update);
      }
      continue;
    }

    // --- Ended ---------------------------------------------------------------
    if (effective === "EXPIRED" && msLeft <= 0 && -msLeft <= ENDED_NOTICE_WINDOW_MS) {
      const update: Record<string, unknown> = {};

      if (!subscription.endedNoticeSentAt) {
        await createNotification({
          organizationId: org.organizationId,
          type: "BATCH_ENDED",
          title: `${label} has ended`,
          message:
            `${label} ended on ${expiresAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}. ` +
            "Students in its classes can no longer use the app. Contact CensorX to renew — the same codes will work again.",
          subscriptionId: subscription.subscriptionId,
          batchLabel: label,
        });
        update.endedNoticeSentAt = nowTimestamp;
        result.endedNoticesCreated++;
      }

      if (!subscription.endedEmailedAt) {
        try {
          await sendBatchEndedEmail({
            to: org.contactEmail,
            schoolName: org.name,
            contactName: org.contactName,
            planName: subscriptionPlanName(subscription),
            batchLabel: label,
            classNames: await listClassNamesForSubscription(org.organizationId, subscription.subscriptionId),
            expiresAt,
            affectedCount: await countStudentsOnSubscription(org.organizationId, subscription.subscriptionId),
          });
          update.endedEmailedAt = nowTimestamp;
          result.endedEmailsSent++;
        } catch (err) {
          result.emailFailures++;
          logger.warn(
            { err, organizationId: org.organizationId, subscriptionId: subscription.subscriptionId },
            "Batch ended email could not be sent"
          );
        }
      }

      if (Object.keys(update).length > 0) {
        update.updatedAt = serverTimestamp();
        await doc.ref.update(update);
      }
    }

    // --- Renewal emails (marketing) -------------------------------------------------
    // Every 4 days after the "ended" email, until the period is renewed (it is then RENEWED and
    // skipped above), cancelled, or the admin stops them. Periods that ended before the "ended"
    // email existed get none.
    if (effective === "EXPIRED" && msLeft <= 0 && subscription.endedEmailedAt && !subscription.renewalEmailsStoppedAt) {
      const last = timestampMillis(subscription.renewalOfferEmailedAt) || timestampMillis(subscription.endedEmailedAt);
      if (nowMillis - last >= RENEWAL_OFFER_GAP_MS) {
        const count = (subscription.renewalOfferCount ?? 0) + 1;
        try {
          await sendRenewalOfferEmail({
            to: org.contactEmail,
            schoolName: org.name,
            contactName: org.contactName,
            planName: subscriptionPlanName(subscription),
            batchLabel: label,
            classNames: await listClassNamesForSubscription(org.organizationId, subscription.subscriptionId),
            expiresAt,
            affectedCount: await countStudentsOnSubscription(org.organizationId, subscription.subscriptionId),
            offerNumber: count,
          });
          await doc.ref.update({ renewalOfferEmailedAt: nowTimestamp, renewalOfferCount: count, updatedAt: serverTimestamp() });
          result.renewalOffersSent++;
        } catch (err) {
          result.emailFailures++;
          logger.warn({ err, organizationId: org.organizationId, subscriptionId: subscription.subscriptionId }, "Renewal email could not be sent");
        }
      }
    }
  }

  await runPaymentReminders(subscriptionsSnap, orgById, now, result);

  result.durationMs = Date.now() - startedAt;
  return result;
}
