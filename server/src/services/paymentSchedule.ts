import type { IssuedBill, OrganizationPayment, PaymentTransaction } from "../models/types";

const round2 = (value: number) => Math.round(value * 100) / 100;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Days after the due date before an unpaid installment counts as overdue. */
export const OVERDUE_AFTER_DAYS = 7;

/**
 * Splits a total into `count` installments in paise: equal parts, with any leftover paise on
 * the last one so the parts always add up exactly to the total.
 */
export function splitInstallments(total: number, count: number): number[] {
  const n = Math.max(1, Math.floor(count));
  const totalPaise = Math.round(total * 100);
  const base = Math.floor(totalPaise / n);
  return Array.from({ length: n }, (_, index) => (index === n - 1 ? totalPaise - base * (n - 1) : base) / 100);
}

/**
 * The installment amounts to use: the admin's own amounts when given (checked to add up to the
 * total, to the paisa), otherwise equal parts.
 */
export function resolveInstallmentAmounts(total: number, count: number, custom?: number[] | null): number[] {
  if (!custom || custom.length === 0) return splitInstallments(total, count);
  if (custom.length !== count) {
    throw Object.assign(new Error(`Give ${count} installment amount(s), one for each installment.`), { code: "INSTALLMENT_COUNT_MISMATCH" });
  }
  const amounts = custom.map((value) => Math.round(value * 100) / 100);
  if (amounts.some((value) => !(value > 0))) {
    throw Object.assign(new Error("Each installment must be more than 0."), { code: "INSTALLMENT_AMOUNT_INVALID" });
  }
  const sumPaise = amounts.reduce((sum, value) => sum + Math.round(value * 100), 0);
  if (sumPaise !== Math.round(total * 100)) {
    throw Object.assign(
      new Error(`The installments add up to ${(sumPaise / 100).toFixed(2)}, but the total is ${total.toFixed(2)}. They must be equal.`),
      { code: "INSTALLMENT_SUM_MISMATCH" }
    );
  }
  return amounts;
}

export type InstallmentStatus = "PAID" | "PART_PAID" | "UPCOMING" | "DUE" | "OVERDUE";

export interface InstallmentView {
  number: number;
  amount: number;
  dueDate: Date;
  /** How much of this installment is covered by what has been paid so far. */
  paid: number;
  remaining: number;
  status: InstallmentStatus;
  /** Whole days past the due date (0 when not yet due). */
  daysLate: number;
}

function toMillis(value: unknown): number {
  if (value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as FirebaseFirestore.Timestamp).toMillis();
  }
  return 0;
}

/**
 * Each installment's state, given what has been paid in total. Payments are applied to the
 * installments in order, so installment 1 is settled first.
 *   PAID       fully covered
 *   PART_PAID  partly covered and not yet due
 *   UPCOMING   nothing paid yet and not yet due
 *   DUE        due date reached, not fully covered, fewer than 7 days late
 *   OVERDUE    not fully covered 7 or more days after its due date
 */
export function installmentViews(
  payment: Pick<OrganizationPayment, "installmentPlan" | "paidAmount"> & Partial<Pick<OrganizationPayment, "upfrontAmount">>,
  options: { asOf?: Date; paidToDate?: number } = {}
): InstallmentView[] {
  const plan = payment.installmentPlan ?? [];
  const now = (options.asOf ?? new Date()).getTime();
  // The amount paid at the start is not an installment: only what was paid after it counts.
  let left = round2((options.paidToDate ?? payment.paidAmount) - (payment.upfrontAmount ?? 0));

  // Money received settles the installment due first (an installment added later for extra
  // codes can fall due before the original last one). Results are still listed by number.
  const coveredByNumber = new Map<number, number>();
  [...plan]
    .sort((a, b) => toMillis(a.dueDate) - toMillis(b.dueDate) || a.number - b.number)
    .forEach((installment) => {
      const covered = round2(Math.min(installment.amount, Math.max(0, left)));
      left = round2(left - covered);
      coveredByNumber.set(installment.number, covered);
    });

  return [...plan]
    .sort((a, b) => a.number - b.number)
    .map((installment) => {
      const covered = coveredByNumber.get(installment.number) ?? 0;
      const remaining = round2(installment.amount - covered);
      const dueMillis = toMillis(installment.dueDate);
      const daysLate = dueMillis && now > dueMillis ? Math.floor((now - dueMillis) / DAY_MS) : 0;

      let status: InstallmentStatus;
      if (remaining <= 0) status = "PAID";
      else if (dueMillis && now >= dueMillis) status = daysLate >= OVERDUE_AFTER_DAYS ? "OVERDUE" : "DUE";
      else status = covered > 0 ? "PART_PAID" : "UPCOMING";

      return {
        number: installment.number,
        amount: installment.amount,
        dueDate: new Date(dueMillis),
        paid: covered,
        remaining,
        status,
        daysLate,
      };
    });
}

/** What the installments add up to: the total, less any amount paid at the start. */
export function installmentTotal(payment: Pick<OrganizationPayment, "totalAmount"> & Partial<Pick<OrganizationPayment, "upfrontAmount">>) {
  return round2(payment.totalAmount - (payment.upfrontAmount ?? 0));
}

/** Amount past its due date and still unpaid (DUE or OVERDUE installments). */
export function amountDueNow(
  payment: Pick<OrganizationPayment, "installmentPlan" | "paidAmount"> & Partial<Pick<OrganizationPayment, "upfrontAmount">>, asOf = new Date()) {
  return round2(
    installmentViews(payment, { asOf })
      .filter((item) => item.status === "DUE" || item.status === "OVERDUE")
      .reduce((sum, item) => sum + item.remaining, 0)
  );
}

/** The next installment that still needs paying, if any. */
/** The unpaid installment that falls due first (the one the next payment goes to). */
export function firstUnpaid<T extends { status: InstallmentStatus; dueDate: Date; number: number }>(views: T[]): T | undefined {
  return views
    .filter((item) => item.status !== "PAID")
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.number - b.number)[0];
}

export function nextUnpaidInstallment(
  payment: Pick<OrganizationPayment, "installmentPlan" | "paidAmount"> & Partial<Pick<OrganizationPayment, "upfrontAmount">>,
  asOf = new Date()
) {
  return firstUnpaid(installmentViews(payment, { asOf })) ?? null;
}

/**
 * Bills issued for a payment. Older payments have no list: their one invoice is reconstructed
 * from the payment itself.
 */
export function issuedBills(payment: OrganizationPayment): IssuedBill[] {
  if (payment.bills?.length) return payment.bills;
  return [
    {
      billNumber: payment.billNumber,
      issuedAt: payment.billDate,
      kind: "INVOICE",
      transactionId: null,
      paidToDate: payment.paidAmount,
      balance: payment.pendingAmount,
      totalAtBill: payment.totalAmount,
      note: null,
    },
  ];
}

/** Payments received. Older payments only know their total paid at creation. */
export function paymentTransactions(payment: OrganizationPayment): PaymentTransaction[] {
  if (payment.transactions) return payment.transactions;
  if (payment.paidAmount > 0 && payment.method) {
    return [
      {
        transactionId: "initial",
        amount: payment.paidAmount,
        paidAt: payment.billDate,
        method: payment.method,
        methodDetails: payment.methodDetails,
        recordedBy: "",
        recordedAt: payment.billDate,
        billNumber: payment.billNumber,
      },
    ];
  }
  return [];
}

/** Finds a bill by number; throws-free: returns null when unknown. */
export function findIssuedBill(payment: OrganizationPayment, billNumber?: string | null): IssuedBill | null {
  const bills = issuedBills(payment);
  if (!billNumber) return bills[0];
  return bills.find((bill) => bill.billNumber === billNumber) ?? null;
}
