export type PaymentStatusValue = "PENDING_PAYMENT" | "INSTALLMENTS" | "PREPAID";

const LABEL: Record<PaymentStatusValue, string> = {
  PENDING_PAYMENT: "Pending payment",
  INSTALLMENTS: "Installments",
  PREPAID: "Prepaid",
};

const STYLE: Record<PaymentStatusValue, string> = {
  PENDING_PAYMENT: "text-amber-700 border-amber-200 bg-amber-50",
  INSTALLMENTS: "text-sky-700 border-sky-200 bg-sky-50",
  PREPAID: "text-cx-accent border-cx-accent/30 bg-cx-tint",
};

/** Indian rupee amount, e.g. ₹12,500.00. */
export function formatInr(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(value);
}

/** Same rule the server uses to work out the status from the amounts. */
export function paymentStatusFor(total: number, paid: number): PaymentStatusValue {
  if (total > 0 && paid >= total) return "PREPAID";
  if (paid <= 0) return "PENDING_PAYMENT";
  return "INSTALLMENTS";
}

export default function PaymentStatusBadge({ status }: { status: PaymentStatusValue }) {
  return <span className={`badge whitespace-nowrap ${STYLE[status]}`}>{LABEL[status]}</span>;
}
