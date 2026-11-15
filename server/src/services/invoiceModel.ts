import { COMPANY } from "../config/company";
import { findIssuedBill, firstUnpaid, installmentViews, issuedBills, paymentTransactions } from "./paymentSchedule";
import type { InvoiceLineItem, Organization, OrganizationPayment, PaymentMethod, PaymentStatus } from "../models/types";

/** The school fields an invoice needs. Address fields are optional (older schools have none). */
export type BillRecipient = Pick<Organization, "organizationId" | "name" | "contactName" | "contactEmail" | "contactPhone"> &
  Partial<Pick<Organization, "address" | "city" | "state" | "country">>;

const round2 = (value: number) => Math.round(value * 100) / 100;

export const STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING_PAYMENT: "Payment pending",
  INSTALLMENTS: "Part paid",
  PREPAID: "Paid in full",
};

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: "Cash",
  CHEQUE: "Cheque",
  UPI: "UPI",
  CARD: "Card",
};

export function formatDate(value: Date) {
  return value.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

/** Turns a YYYY-MM-DD date input into "12 Nov 2026"; anything else is shown as typed. */
function prettyDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

/** 5400 → "5,400.00" (Indian digit grouping). */
export function money(value: number) {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

// ---------------------------------------------------------------------------
// Amount in words, Indian system (thousand, lakh, crore).
// ---------------------------------------------------------------------------

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number) {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}

function belowThousand(n: number) {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}

function integerInWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${integerInWords(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(" ");
}

/** 5400.5 → "Indian Rupees Five Thousand Four Hundred and Fifty Paise Only". */
export function amountInWords(value: number) {
  const rupees = Math.floor(round2(value));
  const paise = Math.round((round2(value) - rupees) * 100);
  const words = `Indian Rupees ${integerInWords(rupees)}${paise ? ` and ${belowHundred(paise)} Paise` : ""} Only`;
  return words;
}

// ---------------------------------------------------------------------------
// Invoice model
// ---------------------------------------------------------------------------

export interface InvoiceModel {
  title: string;
  number: string;
  date: string;
  /** Set on a bill issued after a later payment: points back to the first invoice. */
  revision: { originalNumber: string; note: string } | null;
  /** Installment plan as it stood when this bill was issued. */
  schedule: Array<{ number: number; dueDate: string; amount: number; status: string }>;
  /** Payments received up to this bill. */
  history: Array<{ date: string; amount: number; method: string; billNumber: string }>;
  supplier: { name: string; lines: string[] };
  recipient: { name: string; lines: string[] };
  /** Small facts strip: batch, period, place of supply, SAC. */
  facts: Array<[string, string]>;
  items: InvoiceLineItem[];
  /** True when any line is priced per code per month (shows the Months column). */
  showMonths: boolean;
  /** Classes covered, shown when the item lines do not already list them. */
  classes: Array<{ name: string; codes: number | null }>;
  subtotal: number;
  discountPercent: number;
  /** e.g. "Discount (10%)", or "Discount (10% on the original order)" once extra lines were added. */
  discountLabel: string;
  discount: number;
  total: number;
  paid: number;
  pending: number;
  amountInWords: string;
  statusLabel: string;
  status: PaymentStatus;
  paymentLines: Array<[string, string]>;
  terms: string[];
  footer: string;
}

function toDate(value: unknown): Date | null {
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as FirebaseFirestore.Timestamp).toDate();
  }
  return null;
}

/** Older bills have no item lines: they get one subscription line for the whole amount. */
function fallbackItems(payment: OrganizationPayment): InvoiceLineItem[] {
  const gross = payment.grossAmount ?? payment.totalAmount;
  return [
    {
      item: `${COMPANY.product} — school subscription`,
      detail: payment.batchLabel ?? null,
      quantity: 1,
      unit: "item",
      rate: gross,
      months: null,
      amount: gross,
    },
  ];
}

/** How the most recent payment covered by this bill was made. */
function paymentLines(
  payment: OrganizationPayment,
  latest: { method: PaymentMethod | null; methodDetails: OrganizationPayment["methodDetails"] } | null,
  hasPlan: boolean
): Array<[string, string]> {
  const lines: Array<[string, string]> = [];
  if (!latest?.method) {
    lines.push(["Payment received", "None yet"]);
  } else {
    const details = latest.methodDetails ?? {};
    lines.push(["Paid by", METHOD_LABEL[latest.method]]);
    if (latest.method === "CHEQUE") {
      if (details.chequeNumber) lines.push(["Cheque number", details.chequeNumber]);
      if (details.bankName) lines.push(["Bank", details.bankName]);
      if (details.chequeDate) lines.push(["Cheque date", prettyDate(details.chequeDate)]);
    } else if (latest.method === "UPI") {
      if (details.transactionId) lines.push(["UPI transaction ID", details.transactionId]);
      if (details.upiId) lines.push(["UPI ID", details.upiId]);
    } else if (latest.method === "CARD") {
      if (details.cardLast4) lines.push(["Card", `ending ${details.cardLast4}`]);
      if (details.cardReference) lines.push(["Reference", details.cardReference]);
    }
  }
  // With a dated plan the schedule table says more; this line is for older bills.
  if (!hasPlan && (payment.installments > 1 || payment.status === "INSTALLMENTS")) {
    const each = round2(payment.totalAmount / payment.installments);
    lines.push(["Installments", `${payment.installments} of INR ${money(each)}`]);
  }
  return lines;
}

const INSTALLMENT_LABEL: Record<string, string> = {
  PAID: "Paid",
  PART_PAID: "Part paid",
  UPCOMING: "Upcoming",
  DUE: "Due",
  OVERDUE: "Overdue",
};

/**
 * Builds any bill of the series: the first invoice (default) or, given its number, a bill issued
 * after a later payment. Amounts paid and due are as they stood on that bill's date.
 */
export function buildInvoiceModel(recipient: BillRecipient, payment: OrganizationPayment, billNumber?: string | null): InvoiceModel {
  const bill = findIssuedBill(payment, billNumber) ?? issuedBills(payment)[0];
  const bills = issuedBills(payment);
  const billIndex = Math.max(0, bills.findIndex((item) => item.billNumber === bill.billNumber));
  const billOrder = new Map(bills.map((item, index) => [item.billNumber, index]));
  // Lines and installments added later (e.g. extra codes) only appear from the bill that added them.
  const shownOnThisBill = (addedOnBill?: string | null) => !addedOnBill || (billOrder.get(addedOnBill) ?? Infinity) <= billIndex;
  const allItems = payment.lineItems?.length ? payment.lineItems : fallbackItems(payment);
  const items = allItems.filter((line) => shownOnThisBill(line.addedOnBill));
  const hasAddedLines = items.some((line) => !!line.addedOnBill);
  const subtotal = round2(items.reduce((sum, line) => sum + line.amount, 0));
  const discount = payment.discountAmount ?? 0;
  const totalAtBill = bill.totalAtBill ?? payment.totalAmount;
  const start = toDate(payment.serviceStartAt);
  const end = toDate(payment.serviceEndAt);
  const billDate = toDate(bill.issuedAt) ?? toDate(payment.billDate) ?? new Date();
  const paidToDate = bill.paidToDate;
  const balance = bill.balance;
  const status: PaymentStatus = paidToDate >= totalAtBill ? "PREPAID" : paidToDate > 0 ? "INSTALLMENTS" : "PENDING_PAYMENT";

  // Payments covered by this bill: those whose bill is this one or an earlier one.
  const covered = paymentTransactions(payment).filter((txn) => (billOrder.get(txn.billNumber) ?? 0) <= billIndex);
  const latest = covered[covered.length - 1] ?? null;
  const history = covered.map((txn) => ({
    date: formatDate(toDate(txn.paidAt) ?? billDate),
    amount: txn.amount,
    method: METHOD_LABEL[txn.method],
    billNumber: txn.billNumber,
  }));

  const planAtBill = (payment.installmentPlan ?? []).filter((item) => shownOnThisBill(item.addedOnBill));
  const scheduleViews = installmentViews(
    { installmentPlan: planAtBill, paidAmount: paidToDate, upfrontAmount: payment.upfrontAmount },
    { asOf: billDate, paidToDate }
  );
  const schedule = scheduleViews.map((item) => ({
    number: item.number,
    dueDate: formatDate(item.dueDate),
    amount: item.amount,
    status: INSTALLMENT_LABEL[item.status] ?? item.status,
  }));
  const nextDue = firstUnpaid(scheduleViews);

  const thisPayment = bill.kind === "PAYMENT" ? covered.find((txn) => txn.transactionId === bill.transactionId) : null;
  const revision =
    bill.kind === "PAYMENT"
      ? {
          originalNumber: bills[0].billNumber,
          note: thisPayment
            ? `Updated bill after a payment of INR ${money(thisPayment.amount)} received on ${formatDate(
                toDate(thisPayment.paidAt) ?? billDate
              )}. Replaces earlier bills for invoice ${bills[0].billNumber}.`
            : `Updated bill for invoice ${bills[0].billNumber}.`,
        }
      : bill.kind === "ADJUSTMENT"
        ? {
            originalNumber: bills[0].billNumber,
            note: `Updated bill: ${bill.note ?? "the order was changed"}. Replaces earlier bills for invoice ${bills[0].billNumber}.`,
          }
        : null;

  const supplierLines = [
    COMPANY.address,
    COMPANY.state && `State: ${COMPANY.state}`,
    COMPANY.taxId && `GSTIN: ${COMPANY.taxId}`,
    COMPANY.pan && `PAN: ${COMPANY.pan}`,
    COMPANY.phone && `Phone: ${COMPANY.phone}`,
    COMPANY.whatsapp.length > 0 && `WhatsApp: ${COMPANY.whatsapp.join(", ")}`,
    COMPANY.email && `Email: ${COMPANY.email}`,
    COMPANY.website && `Web: ${COMPANY.website}`,
  ].filter(Boolean) as string[];

  const addressLine = [recipient.address, recipient.city, recipient.state, recipient.country].filter((part) => part && part.trim()).join(", ");
  const recipientLines = [
    addressLine,
    recipient.contactName && `Attn: ${recipient.contactName}`,
    recipient.contactPhone && `Phone: ${recipient.contactPhone}`,
    recipient.contactEmail && `Email: ${recipient.contactEmail}`,
  ].filter(Boolean) as string[];

  const facts: Array<[string, string]> = [];
  if (payment.batchLabel) facts.push(["Batch", payment.billKind === "RENEWAL" ? `${payment.batchLabel} (renewal)` : payment.batchLabel]);
  if (start && end) facts.push(["Service period", `${formatDate(start)} – ${formatDate(end)}`]);
  if (recipient.state) facts.push(["Place of supply", recipient.state]);
  if (COMPANY.sac) facts.push(["SAC", COMPANY.sac]);

  // Per-class lines already name every class; otherwise list the classes underneath.
  const itemsNameClasses = items.length > 1 || (payment.classesCovered?.length === 1 && items[0]?.item === payment.classesCovered[0].name);
  const classes = itemsNameClasses ? [] : payment.classesCovered ?? [];

  const upfront = payment.upfrontAmount ?? 0;
  const terms = [
    ...(upfront > 0 && schedule.length > 0
      ? [
          `INR ${money(upfront)} was paid separately (at the start, or on the spot for extra codes). The installment schedule covers the remaining INR ${money(
            Math.round((totalAtBill - upfront) * 100) / 100
          )}.`,
        ]
      : []),
    balance <= 0
      ? "This invoice is fully paid. Thank you."
      : nextDue && schedule.length > 0
        ? `Balance of INR ${money(balance)} is payable as per the installment schedule above. Next payment: INR ${money(
            nextDue.remaining
          )} due on ${formatDate(nextDue.dueDate)}.`
        : `Please pay the balance of INR ${money(balance)} within ${COMPANY.paymentTermsDays} days of the invoice date.`,
    "Access for a batch may be paused if payments remain overdue, and is restored once they are settled.",
    "Activation codes are single-use and valid until the end of the service period of their batch.",
    `Quote invoice number ${bills[0].billNumber} with any payment or question.`,
  ];

  return {
    title: "Invoice",
    number: bill.billNumber,
    date: formatDate(billDate),
    revision,
    schedule,
    history,
    supplier: { name: COMPANY.name, lines: supplierLines },
    recipient: { name: recipient.name, lines: recipientLines },
    facts,
    items,
    showMonths: items.some((line) => line.months !== null),
    classes,
    subtotal,
    discountPercent: payment.discountPercent ?? 0,
    discountLabel:
      discount > 0
        ? hasAddedLines
          ? `Discount (${payment.discountPercent ?? 0}% on the original order)`
          : `Discount (${payment.discountPercent ?? 0}%)`
        : "",
    discount,
    total: totalAtBill,
    paid: paidToDate,
    pending: balance,
    amountInWords: amountInWords(totalAtBill),
    statusLabel: STATUS_LABEL[status],
    status,
    paymentLines: paymentLines(payment, latest ? { method: latest.method, methodDetails: latest.methodDetails } : null, schedule.length > 0),
    terms,
    footer: "This is a computer-generated invoice and does not require a physical signature.",
  };
}
