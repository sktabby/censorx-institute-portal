import crypto from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { Collections } from "../config/collections";
import { logger } from "../config/logger";
import { db, serverTimestamp } from "../repositories/firestoreRepository";
import { getOrganization } from "../repositories/organizationRepository";
import { writeAuditLog } from "../repositories/auditLogRepository";
import { ApiError } from "../middleware/errorHandler";
import { batchLabelOf } from "./batchService";
import { derivePaymentStatus, pickDetails, sendBillForOrganization } from "./billService";
import { createNotification } from "./notificationService";
import { installmentTotal, issuedBills, paymentTransactions, resolveInstallmentAmounts, splitInstallments } from "./paymentSchedule";
import type {
  OrganizationPayment,
  OrganizationSubscription,
  PaymentInstallment,
  PaymentMethod,
  PaymentMethodDetails,
} from "../models/types";

const round2 = (value: number) => Math.round(value * 100) / 100;

export interface RecordPaymentInput {
  amount: number;
  /** When the money was received (ISO). Defaults to now. */
  paidAt?: string;
  method: PaymentMethod;
  methodDetails?: PaymentMethodDetails;
}

function formatDay(value: Date) {
  return value.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

function formatInr(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(value);
}

/**
 * Records money received against a batch's bill (e.g. the 2nd or 3rd installment) and issues a
 * new bill showing what has been paid so far. The new bill is emailed to the school and appears
 * in both portals. The original invoice stays as it was.
 */
export async function recordPayment(
  organizationId: string,
  subscriptionId: string,
  input: RecordPaymentInput,
  actorUid: string
) {
  const org = await getOrganization(organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  if (org.status === "ARCHIVED") throw new ApiError(409, "ORG_ARCHIVED", "This school has been archived.");

  const amount = round2(input.amount);
  if (!(amount > 0)) throw new ApiError(400, "VALIDATION_ERROR", "Enter an amount above 0.");
  const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
  if (Number.isNaN(paidAt.getTime())) throw new ApiError(400, "VALIDATION_ERROR", "Enter a valid payment date.");

  const ref = db.collection(Collections.organizationSubscriptions).doc(subscriptionId);
  const now = Timestamp.now();

  const updated = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "Batch not found for this school.");
    const subscription = snap.data() as OrganizationSubscription;
    if (subscription.organizationId !== organizationId) {
      throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "Batch not found for this school.");
    }
    const payment = subscription.payment;
    if (!payment) throw new ApiError(404, "BILL_NOT_FOUND", "No bill was issued for this batch, so there is nothing to pay.");
    if (payment.pendingAmount <= 0) throw new ApiError(409, "BILL_ALREADY_PAID", "This bill is already fully paid.");
    if (amount > round2(payment.pendingAmount)) {
      throw new ApiError(400, "PAYMENT_TOO_LARGE", `The balance due is ${formatInr(payment.pendingAmount)}. Enter that amount or less.`);
    }

    const bills = issuedBills(payment);
    const billNumber = `${bills[0].billNumber}-${bills.length + 1}`;
    const transactionId = crypto.randomBytes(6).toString("hex");
    const paidAmount = round2(payment.paidAmount + amount);
    const pendingAmount = round2(payment.totalAmount - paidAmount);
    const methodDetails = pickDetails(input.method, input.methodDetails);

    const next: OrganizationPayment = {
      ...payment,
      paidAmount,
      pendingAmount,
      status: derivePaymentStatus(payment.totalAmount, paidAmount),
      method: input.method,
      methodDetails,
      transactions: [
        ...paymentTransactions(payment),
        {
          transactionId,
          amount,
          paidAt: Timestamp.fromDate(paidAt),
          method: input.method,
          methodDetails,
          recordedBy: actorUid,
          recordedAt: now,
          billNumber,
        },
      ],
      bills: [
        ...bills,
        {
          billNumber,
          issuedAt: now,
          kind: "PAYMENT",
          transactionId,
          paidToDate: paidAmount,
          balance: pendingAmount,
          totalAtBill: payment.totalAmount,
          note: null,
        },
      ],
    };

    tx.update(ref, { payment: next, updatedAt: serverTimestamp() });
    return { subscription: { ...subscription, payment: next }, billNumber };
  });

  const { subscription, billNumber } = updated;
  const payment = subscription.payment!;
  const label = batchLabelOf(subscription);

  let billEmail: { sent: boolean; to: string; warning?: string };
  try {
    await sendBillForOrganization(org, payment, billNumber);
    billEmail = { sent: true, to: org.contactEmail };
  } catch (err) {
    logger.warn({ err, organizationId, billNumber }, "Updated bill email could not be sent");
    billEmail = {
      sent: false,
      to: org.contactEmail,
      warning: "The payment was recorded, but the new bill could not be emailed. You can send it again from the batch.",
    };
  }

  await createNotification({
    organizationId,
    type: "PAYMENT_RECEIVED",
    title: `Payment received for ${label}`,
    message:
      `We received ${formatInr(amount)} for ${label}. ` +
      (payment.pendingAmount > 0
        ? `Balance due: ${formatInr(payment.pendingAmount)}. `
        : "The bill is now fully paid. Thank you! ") +
      `Your updated bill ${billNumber} is on the batch page and was emailed to you.`,
    subscriptionId,
    batchLabel: label,
  });

  await writeAuditLog({
    actorUid,
    actorRole: "SUPER_ADMIN",
    action: "PAYMENT_RECORDED",
    organizationId,
    targetType: "subscription",
    targetId: subscriptionId,
    metadata: {
      amount,
      method: input.method,
      paidAt: paidAt.toISOString(),
      billNumber,
      paidAmount: payment.paidAmount,
      pendingAmount: payment.pendingAmount,
    },
  });

  return {
    billNumber,
    paidAmount: payment.paidAmount,
    pendingAmount: payment.pendingAmount,
    status: payment.status,
    billEmail,
  };
}

export interface AddChargeInput {
  /** Main text of the new bill line, e.g. "Class 5A — 2 extra codes". */
  item: string;
  detail: string;
  quantity: number;
  /** Price per code per month, when the charge was worked out that way. */
  ratePerCodePerMonth?: number;
  months?: number;
  amount: number;
  /** When the extra amount is due (ISO). Not needed when it is paid now. */
  dueDate?: string;
  /** Paid on the spot: recorded with the charge, kept outside the installments (no due date). */
  paidNow?: { method: PaymentMethod; methodDetails?: PaymentMethodDetails };
  /** Printed on the new bill, e.g. "2 extra codes added to Class 5A on 14 Feb 2027". */
  note: string;
}

/**
 * Adds a charge to a batch's bill (e.g. extra codes for a class): a new bill line, a new
 * installment with its own due date, a higher total and balance, and a new bill that is
 * emailed to the school and shown in its portal. Earlier bills keep showing what they showed.
 */
export async function addChargeToBill(
  organizationId: string,
  subscriptionId: string,
  input: AddChargeInput,
  actorUid: string
) {
  const org = await getOrganization(organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new ApiError(400, "VALIDATION_ERROR", "The charge must be more than 0.");
  const dueDate = input.paidNow ? new Date() : new Date(input.dueDate ?? "");
  if (Number.isNaN(dueDate.getTime())) throw new ApiError(400, "VALIDATION_ERROR", "Choose a valid due date for the extra amount.");

  const ref = db.collection(Collections.organizationSubscriptions).doc(subscriptionId);
  const now = Timestamp.now();

  const { subscription, billNumber } = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "Batch not found for this school.");
    const current = snap.data() as OrganizationSubscription;
    if (current.organizationId !== organizationId) throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "Batch not found for this school.");
    const payment = current.payment;
    if (!payment) {
      throw new ApiError(409, "BILL_NOT_FOUND", "This batch has no bill to add to. Add the codes with a price of 0, or record the payment separately.");
    }

    const bills = issuedBills(payment);
    const number = `${bills[0].billNumber}-${bills.length + 1}`;
    const perMonth = input.ratePerCodePerMonth !== undefined && input.months !== undefined;
    const expected = perMonth ? round2(input.ratePerCodePerMonth! * input.quantity * input.months!) : amount;
    const totalAmount = round2(payment.totalAmount + amount);

    // Older bills carry no item lines: start from the single line they show, so nothing is lost.
    const existingLines = payment.lineItems?.length
      ? payment.lineItems
      : [
          {
            item: "CensorX for Schools — school subscription",
            detail: payment.batchLabel ?? null,
            quantity: 1,
            unit: "item",
            rate: payment.grossAmount ?? payment.totalAmount,
            months: null,
            amount: payment.grossAmount ?? payment.totalAmount,
            addedOnBill: null,
          },
        ];
    // Paid in full at the start: there is no plan to add to, so the extra charge is the only installment.
    const fullyPaidUpfront = !payment.installmentPlan?.length && installmentTotal(payment) <= 0;
    const plan = payment.installmentPlan?.length
      ? payment.installmentPlan
      : fullyPaidUpfront
        ? []
        : splitInstallments(installmentTotal(payment), payment.installments).map((part, index) => ({
          number: index + 1,
          amount: part,
          // No dates were chosen for this older bill: treat its parts as due on the bill date.
          dueDate: payment.billDate,
          upcomingNoticeAt: now,
          dueNoticeAt: now,
          overdueNoticeAt: now,
          addedOnBill: null,
        }));

    // Paid now: the money comes in with the charge and stays outside the installments.
    const paidNow = input.paidNow ?? null;
    const transactionId = paidNow ? crypto.randomBytes(6).toString("hex") : null;
    const paidAmount = paidNow ? round2(payment.paidAmount + amount) : payment.paidAmount;
    const balance = round2(totalAmount - paidAmount);
    const methodDetails = paidNow ? pickDetails(paidNow.method, paidNow.methodDetails) : null;

    const next: OrganizationPayment = {
      ...payment,
      totalAmount,
      grossAmount: round2((payment.grossAmount ?? payment.totalAmount) + amount),
      pendingAmount: balance,
      paidAmount,
      status: derivePaymentStatus(totalAmount, paidAmount),
      ...(paidNow
        ? {
            method: paidNow.method,
            methodDetails,
            upfrontAmount: round2((payment.upfrontAmount ?? 0) + amount),
          }
        : {}),
      installments: paidNow ? payment.installments : plan.length + 1,
      lineItems: [
        ...existingLines,
        {
          item: input.item,
          detail: input.detail,
          quantity: input.quantity,
          unit: "codes",
          rate: perMonth && Math.abs(expected - amount) < 0.01 ? input.ratePerCodePerMonth! : round2(amount / input.quantity),
          months: perMonth && Math.abs(expected - amount) < 0.01 ? input.months! : null,
          amount,
          addedOnBill: number,
        },
      ],
      installmentPlan: paidNow
        ? payment.installmentPlan ?? null
        : [
            ...plan,
            {
              number: plan.length + 1,
              amount,
              dueDate: Timestamp.fromDate(dueDate),
              upcomingNoticeAt: null,
              dueNoticeAt: null,
              overdueNoticeAt: null,
              addedOnBill: number,
            },
          ],
      transactions: [
        ...paymentTransactions(payment),
        ...(paidNow && transactionId
          ? [
              {
                transactionId,
                amount,
                paidAt: now,
                method: paidNow.method,
                methodDetails,
                recordedBy: actorUid,
                recordedAt: now,
                billNumber: number,
              },
            ]
          : []),
      ],
      bills: [
        ...bills,
        {
          billNumber: number,
          issuedAt: now,
          kind: "ADJUSTMENT",
          transactionId,
          paidToDate: paidAmount,
          balance,
          totalAtBill: totalAmount,
          note: paidNow ? `${input.note}, paid on the spot` : input.note,
          reason: "EXTRA_CODES",
        },
      ],
    };

    tx.update(ref, { payment: next, updatedAt: serverTimestamp() });
    return { subscription: { ...current, payment: next }, billNumber: number };
  });

  const payment = subscription.payment!;
  const label = batchLabelOf(subscription);

  let billEmail: { sent: boolean; to: string; warning?: string };
  try {
    await sendBillForOrganization(org, payment, billNumber);
    billEmail = { sent: true, to: org.contactEmail };
  } catch (err) {
    logger.warn({ err, organizationId, billNumber }, "Updated bill email (extra charge) could not be sent");
    billEmail = {
      sent: false,
      to: org.contactEmail,
      warning: "The codes were added, but the updated bill could not be emailed. You can send it again from the batch.",
    };
  }

  await createNotification({
    organizationId,
    type: "PAYMENT_DUE",
    title: `Updated bill for ${label}`,
    message: input.paidNow
      ? `${input.note}. ${formatInr(amount)} was added to your bill and paid. Thank you! Your updated bill ${billNumber} is on the batch page and was emailed to you.`
      : `${input.note}. ${formatInr(amount)} has been added to your bill, due on ${dueDate.toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          timeZone: "Asia/Kolkata",
        })}. Your updated bill ${billNumber} is on the batch page and was emailed to you.`,
    subscriptionId,
    batchLabel: label,
  });

  await writeAuditLog({
    actorUid,
    actorRole: "SUPER_ADMIN",
    action: "BILL_CHARGE_ADDED",
    organizationId,
    targetType: "subscription",
    targetId: subscriptionId,
    metadata: {
      amount,
      billNumber,
      item: input.item,
      dueDate: input.paidNow ? null : dueDate.toISOString(),
      paidNow: input.paidNow?.method ?? null,
      totalAmount: payment.totalAmount,
    },
  });

  return { billNumber, amount, totalAmount: payment.totalAmount, pendingAmount: payment.pendingAmount, billEmail };
}

/**
 * Sets the due date (and, optionally, the amount) of every installment of a batch's bill.
 * Amounts must add up to the bill's total; when not given, the current amounts are kept.
 * Reminders already sent for an installment are reset when its date or amount changes, so the
 * school is reminded again.
 *
 * When anything actually changed, a new bill with the new schedule is issued (it replaces the
 * earlier bills of the series), emailed to the school and shown in its portal.
 */
export async function updateInstallmentDueDates(
  organizationId: string,
  subscriptionId: string,
  dueDates: string[],
  actorUid: string,
  newAmounts?: number[]
) {
  const org = await getOrganization(organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  const ref = db.collection(Collections.organizationSubscriptions).doc(subscriptionId);
  const now = Timestamp.now();

  const { plan, billNumber, subscription } = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "Batch not found for this school.");
    const subscription = snap.data() as OrganizationSubscription;
    if (subscription.organizationId !== organizationId) throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "Batch not found for this school.");
    const payment = subscription.payment;
    if (!payment) throw new ApiError(404, "BILL_NOT_FOUND", "No bill was issued for this batch.");
    if (dueDates.length !== payment.installments) {
      throw new ApiError(400, "VALIDATION_ERROR", `Give ${payment.installments} due date(s), one for each installment.`);
    }

    let amounts: number[];
    try {
      // Installments add up to the total less any amount paid at the start.
      const planTotal = installmentTotal(payment);
      amounts = newAmounts?.length
        ? resolveInstallmentAmounts(planTotal, payment.installments, newAmounts)
        : payment.installmentPlan?.length === payment.installments
          ? payment.installmentPlan.map((item) => item.amount)
          : splitInstallments(planTotal, payment.installments);
    } catch (err) {
      throw new ApiError(400, (err as { code?: string }).code ?? "VALIDATION_ERROR", (err as Error).message);
    }
    const nextPlan: PaymentInstallment[] = dueDates.map((value, index) => {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) throw new ApiError(400, "VALIDATION_ERROR", `Installment ${index + 1} has no valid due date.`);
      const previous = payment.installmentPlan?.[index];
      const same = previous && previous.dueDate.toMillis() === date.getTime() && Math.abs(previous.amount - amounts[index]) < 0.005;
      return {
        number: index + 1,
        amount: amounts[index],
        dueDate: Timestamp.fromDate(date),
        upcomingNoticeAt: same ? previous.upcomingNoticeAt ?? null : null,
        dueNoticeAt: same ? previous.dueNoticeAt ?? null : null,
        overdueNoticeAt: same ? previous.overdueNoticeAt ?? null : null,
        reminderEmailPending: same ? previous.reminderEmailPending ?? null : null,
        followUpEmailedAt: same ? previous.followUpEmailedAt ?? null : null,
        followUpCount: same ? previous.followUpCount ?? 0 : 0,
        addedOnBill: previous?.addedOnBill ?? null,
      };
    });

    const changed =
      (payment.installmentPlan?.length ?? 0) !== nextPlan.length ||
      nextPlan.some((item, index) => {
        const previous = payment.installmentPlan?.[index];
        return !previous || previous.dueDate.toMillis() !== item.dueDate.toMillis() || Math.abs(previous.amount - item.amount) >= 0.005;
      });

    let next: OrganizationPayment = { ...payment, installmentPlan: nextPlan };
    let number: string | null = null;
    if (changed) {
      const bills = issuedBills(payment);
      number = `${bills[0].billNumber}-${bills.length + 1}`;
      next = {
        ...next,
        transactions: paymentTransactions(payment),
        bills: [
          ...bills,
          {
            billNumber: number,
            issuedAt: now,
            kind: "ADJUSTMENT",
            transactionId: null,
            paidToDate: payment.paidAmount,
            balance: payment.pendingAmount,
            totalAtBill: payment.totalAmount,
            note: `installment schedule changed on ${formatDay(now.toDate())}`,
            reason: "SCHEDULE_CHANGE",
          },
        ],
      };
    }

    tx.update(ref, { payment: next, updatedAt: serverTimestamp() });
    return { plan: nextPlan, billNumber: number, subscription: { ...subscription, payment: next } };
  });

  let billEmail: { sent: boolean; to: string; warning?: string } | undefined;
  if (billNumber) {
    const label = batchLabelOf(subscription);
    try {
      await sendBillForOrganization(org, subscription.payment!, billNumber);
      billEmail = { sent: true, to: org.contactEmail };
    } catch (err) {
      logger.warn({ err, organizationId, billNumber }, "Updated bill email (new schedule) could not be sent");
      billEmail = {
        sent: false,
        to: org.contactEmail,
        warning: "The schedule was saved, but the new bill could not be emailed. You can send it again from the batch.",
      };
    }
    await createNotification({
      organizationId,
      type: "PAYMENT_DUE",
      title: `New payment schedule for ${label}`,
      message:
        `The installment schedule for ${label} has been updated: ` +
        plan.map((item) => `${formatInr(item.amount)} due on ${formatDay(item.dueDate.toDate())}`).join(", ") +
        `. Your new bill ${billNumber} replaces the earlier bills; it is on the batch page and was emailed to you.`,
      subscriptionId,
      batchLabel: label,
    });
  }

  await writeAuditLog({
    actorUid,
    actorRole: "SUPER_ADMIN",
    action: "INSTALLMENT_DATES_UPDATED",
    organizationId,
    targetType: "subscription",
    targetId: subscriptionId,
    metadata: {
      dueDates: plan.map((item) => item.dueDate.toDate().toISOString()),
      amounts: plan.map((item) => item.amount),
      billNumber,
    },
  });

  return { installments: plan.length, billNumber, billEmail };
}
