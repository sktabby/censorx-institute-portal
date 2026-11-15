import type { PaymentStatusValue } from "../components/PaymentStatusBadge";

/** Mirrors SeatUsage in server/src/utils/seatAccounting.ts. */
export interface SeatUsage {
  totalSeats: number;
  activatedSeats: number;
  unusedCodes: number;
  expiredSeats: number;
  revokedSeats: number;
  seatLimit: number;
  remainingCapacity: number;
  availableSeats: number;
}

/** Mirrors BatchClassView in server/src/services/batchService.ts. */
export interface BatchClass {
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
  status: string;
}

export type InstallmentStatus = "PAID" | "PART_PAID" | "UPCOMING" | "DUE" | "OVERDUE";

export interface InstallmentRow {
  number: number;
  amount: number;
  dueDate: string;
  paid: number;
  remaining: number;
  status: InstallmentStatus;
  daysLate: number;
}

export interface IssuedBillRow {
  billNumber: string;
  issuedAt: string | null;
  kind: "INVOICE" | "PAYMENT" | "ADJUSTMENT";
  paidToDate: number;
  balance: number;
  note?: string | null;
  reason?: "EXTRA_CODES" | "SCHEDULE_CHANGE" | null;
}

/** "Invoice", "Updated after payment", "Updated: items added", "Updated: new schedule" — what a bill was issued for. */
export function billKindLabel(kind: IssuedBillRow["kind"], reason?: IssuedBillRow["reason"]) {
  if (kind === "INVOICE") return "Invoice";
  if (kind === "PAYMENT") return "Updated after payment";
  return reason === "SCHEDULE_CHANGE" ? "Updated: new schedule" : "Updated: items added";
}

export interface PaymentRow {
  transactionId: string;
  amount: number;
  paidAt: string | null;
  method: "CASH" | "CHEQUE" | "UPI" | "CARD";
  billNumber: string;
}

export interface BatchPayment {
  billNumber: string;
  billDate: string | null;
  status: PaymentStatusValue;
  totalAmount: number;
  grossAmount: number;
  discountPercent: number;
  discountAmount: number;
  /** Price per code per month, when the bill was priced that way. */
  amountPerCode: number | null;
  /** Paid when the batch was set up, separate from the installments (0 on older bills). */
  upfrontAmount?: number;
  paidAmount: number;
  pendingAmount: number;
  installments: number;
  method: "CASH" | "CHEQUE" | "UPI" | "CARD" | null;
  description: string | null;
  schedule: InstallmentRow[];
  amountDueNow: number;
  isOverdue: boolean;
  nextDue: { number: number; dueDate: string; remaining: number } | null;
  bills: IssuedBillRow[];
  transactions: PaymentRow[];
  /** Admin only. */
  methodDetails?: Record<string, string> | null;
}

export const INSTALLMENT_STATUS: Record<InstallmentStatus, { label: string; tone: string }> = {
  PAID: { label: "Paid", tone: "text-cx-accent border-cx-accent/30 bg-cx-tint" },
  PART_PAID: { label: "Part paid", tone: "text-sky-700 border-sky-200 bg-sky-50" },
  UPCOMING: { label: "Upcoming", tone: "text-gray-700 border-gray-200 bg-gray-100" },
  DUE: { label: "Due", tone: "text-amber-700 border-amber-200 bg-amber-50" },
  OVERDUE: { label: "Overdue", tone: "text-red-700 border-red-200 bg-red-50" },
};

/** Mirrors BatchView in server/src/services/batchService.ts. */
export interface BatchView {
  subscriptionId: string;
  batchNumber: number;
  batchLabel: string;
  planDuration: string;
  startAt: string | null;
  expiresAt: string | null;
  createdAt: string | null;
  status: string;
  storedStatus: string;
  isLive: boolean;
  isCurrentPeriod: boolean;
  daysRemaining: number;
  seatLimit: number;
  seatUsage: SeatUsage;
  classes: BatchClass[];
  renewedFromSubscriptionId: string | null;
  renewedToSubscriptionId: string | null;
  payment: BatchPayment | null;
  notes: string | null;
  cancelledAt: string | null;
  isPaused: boolean;
  pausedAt: string | null;
  pauseReason: string | null;
  /** Renewal emails after the period ended (every 4 days): false once stopped. */
  renewalEmails?: boolean;
  renewalEmailsSent?: number;
}

export const METHOD_LABEL = { CASH: "Cash", CHEQUE: "Cheque", UPI: "UPI", CARD: "Card" } as const;

export function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

/** "Ends in 3 days", "Ends today", "Ended 5 days ago". */
export function describeDaysLeft(batch: Pick<BatchView, "daysRemaining" | "isLive" | "status">) {
  if (batch.status === "CANCELLED") return "Cancelled";
  if (batch.status === "SUSPENDED") return "Access paused";
  if (batch.status === "RENEWED") return "Renewed";
  if (batch.isLive) {
    if (batch.daysRemaining <= 0) return "Ends today";
    return `Ends in ${batch.daysRemaining} day${batch.daysRemaining === 1 ? "" : "s"}`;
  }
  const ago = Math.abs(batch.daysRemaining);
  return ago === 0 ? "Ended today" : `Ended ${ago} day${ago === 1 ? "" : "s"} ago`;
}

/** Triggers a browser download for a Blob. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Reads the file name from a Content-Disposition header. */
export function filenameFrom(disposition: string | undefined, fallback: string) {
  const match = disposition?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? fallback;
}
