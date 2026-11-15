import { useEffect, type InputHTMLAttributes } from "react";
import { Banknote, CreditCard, Landmark, Smartphone, type LucideIcon } from "lucide-react";
import PaymentStatusBadge, { formatInr, paymentStatusFor } from "./PaymentStatusBadge";
import { deriveInstallments, typeInstallment } from "../utils/installments";

export type PaymentMethod = "CASH" | "CHEQUE" | "UPI" | "CARD";

export interface PaymentFormState {
  /** Optional price per code per month. When filled, amount before discount = codes × this × months. */
  amountPerCode: string;
  /** Amount before discount, typed by hand (used when amountPerCode is empty). */
  baseAmount: string;
  /** Discount on the overall amount, in percent. */
  discountPercent: string;
  paidAmount: string;
  installments: string;
  /** One due date (YYYY-MM-DD) per installment, chosen by the admin. */
  dueDates: string[];
  /**
   * One entry per installment: the amount typed by hand, or null for "share the rest of the
   * total automatically". null overall = split equally.
   */
  installmentAmounts: Array<string | null> | null;
  method: PaymentMethod | "";
  chequeNumber: string;
  bankName: string;
  chequeDate: string;
  transactionId: string;
  upiId: string;
  cardLast4: string;
  cardReference: string;
}

export const emptyPayment: PaymentFormState = {
  amountPerCode: "",
  baseAmount: "",
  discountPercent: "",
  paidAmount: "0",
  installments: "1",
  dueDates: [],
  installmentAmounts: null,
  method: "",
  chequeNumber: "",
  bankName: "",
  chequeDate: "",
  transactionId: "",
  upiId: "",
  cardLast4: "",
  cardReference: "",
};

/** What is being billed: number of codes and number of months. */
export interface BillingContext {
  codeCount: number;
  months: number;
}

/** Body the server expects (`payment` on create batch / renew batch). */
export interface PaymentPayload {
  amountPerCode?: number;
  grossAmount: number;
  discountPercent?: number;
  totalAmount: number;
  paidAmount: number;
  installments: number;
  installmentDueDates?: string[];
  installmentAmounts?: number[];
  /** The installments split what is left after the amount paid now (always true from this form). */
  splitBalance: boolean;
  method?: PaymentMethod;
  methodDetails?: Record<string, string>;
}

/** YYYY-MM-DD for a Date, in local time. */
function toDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addMonths(value: string, months: number) {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1 + months, 1);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(d, lastDay));
  return toDateInput(date);
}

/**
 * Keeps one due date per installment. Existing dates are kept; new ones follow the last one by a
 * month (the first defaults to today).
 */
export function fitDueDates(dates: string[], count: number) {
  const n = Math.min(60, Math.max(1, Math.floor(count) || 1));
  const next = dates.slice(0, n);
  while (next.length < n) {
    next.push(next.length === 0 ? toDateInput(new Date()) : addMonths(next[next.length - 1], 1));
  }
  return next;
}

/** Equal parts in paise, leftover on the last — the same split the server makes. */
export function splitInstallments(total: number, count: number) {
  const n = Math.max(1, Math.floor(count));
  const paise = Math.round(total * 100);
  const base = Math.floor(paise / n);
  return Array.from({ length: n }, (_, index) => (index === n - 1 ? paise - base * (n - 1) : base) / 100);
}

const methods: { value: PaymentMethod; label: string; icon: LucideIcon }[] = [
  { value: "CASH", label: "Cash", icon: Banknote },
  { value: "CHEQUE", label: "Cheque", icon: Landmark },
  { value: "UPI", label: "UPI", icon: Smartphone },
  { value: "CARD", label: "Card", icon: CreditCard },
];

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * The same arithmetic as the server (billService → resolvePaymentAmounts):
 *   before discount = codes × amount per code per month × months   (or the typed amount)
 *   discount        = before discount × discount %
 *   total           = before discount − discount
 */
export function computeAmounts(payment: PaymentFormState, context?: BillingContext) {
  const perCode = Number(payment.amountPerCode);
  const usingPerCode = !!payment.amountPerCode.trim() && perCode > 0 && !!context && context.codeCount > 0;
  const gross = usingPerCode ? round2(perCode * context!.codeCount * context!.months) : round2(Number(payment.baseAmount) || 0);
  const discountPercent = round2(Math.min(100, Math.max(0, Number(payment.discountPercent) || 0)));
  const discount = round2((gross * discountPercent) / 100);
  const total = round2(gross - discount);
  const paid = Number(payment.paidAmount) || 0;
  const installments = Math.max(1, Math.floor(Number(payment.installments)) || 1);
  // The amount paid now is separate; the installments split only what is left.
  const planTotal = Math.max(0, round2(total - Math.max(0, paid)));
  return {
    planTotal,
    needsPlan: planTotal > 0,
    usingPerCode,
    perCode,
    gross,
    discountPercent,
    discount,
    total,
    paid,
    installments,
    pending: Math.max(0, round2(total - paid)),
    status: paymentStatusFor(total, paid),
  };
}

/** Returns a message for the first problem, or null when the payment is complete. */
export function validatePayment(payment: PaymentFormState, context?: BillingContext): string | null {
  const { gross, total, paid, installments, planTotal, needsPlan } = computeAmounts(payment, context);
  if (payment.amountPerCode.trim() && !(Number(payment.amountPerCode) > 0)) {
    return "Amount per code must be more than 0, or leave it empty and type the amount.";
  }
  const pct = Number(payment.discountPercent);
  if (payment.discountPercent.trim() && (Number.isNaN(pct) || pct < 0 || pct > 100)) {
    return "Discount must be a percentage from 0 to 100.";
  }
  if (!(gross > 0)) return "Enter the amount per code, or the amount before discount.";
  if (!(total > 0)) return "The total after discount must be more than 0.";
  if (paid < 0) return "Amount paid cannot be negative.";
  if (paid > total) return "Amount paid cannot be more than the total amount.";
  if (needsPlan && (!Number.isInteger(Number(payment.installments)) || installments < 1 || installments > 60)) {
    return "Installments must be a whole number from 1 to 60.";
  }
  const dates = needsPlan ? fitDueDates(payment.dueDates, installments) : [];
  const plan = deriveInstallments(planTotal, installments, needsPlan ? payment.installmentAmounts : null);
  if (needsPlan && plan.isCustom) {
    const bad = plan.values.findIndex((item) => !(Number(item) > 0));
    if (bad >= 0) {
      return plan.gap > 0
        ? `The amounts you typed are more than the remaining ₹${planTotal.toLocaleString("en-IN")}, so nothing is left for installment ${bad + 1}. Lower one of them, or click “Split equally”.`
        : `Enter an amount above 0 for installment ${bad + 1}.`;
    }
    if (Math.abs(plan.gap) >= 0.005) {
      return `The installments add up to ₹${plan.sum.toLocaleString("en-IN")}, but the remaining amount is ₹${planTotal.toLocaleString("en-IN")}. Change one, or click “Split equally”.`;
    }
  }
  const missing = dates.findIndex((date) => !date);
  if (missing >= 0) return `Choose a due date for installment ${missing + 1}.`;
  for (let index = 1; index < dates.length; index++) {
    if (dates[index] < dates[index - 1]) return `Installment ${index + 1} cannot be due before installment ${index}.`;
  }
  if (paid > 0) {
    if (!payment.method) return "Select a payment method.";
    if (payment.method === "CHEQUE" && (!payment.chequeNumber.trim() || !payment.bankName.trim() || !payment.chequeDate)) {
      return "Enter the cheque number, bank name and cheque date.";
    }
    if (payment.method === "UPI" && !payment.transactionId.trim()) return "Enter the UPI transaction ID.";
    if (payment.method === "CARD" && !/^\d{4}$/.test(payment.cardLast4.trim())) return "Enter the last 4 digits of the card.";
  }
  return null;
}

export function toPaymentPayload(payment: PaymentFormState, context?: BillingContext): PaymentPayload {
  const amounts = computeAmounts(payment, context);
  const trim = (value: string) => value.trim();
  let methodDetails: Record<string, string> | undefined;
  if (payment.method === "CHEQUE") {
    methodDetails = { chequeNumber: trim(payment.chequeNumber), bankName: trim(payment.bankName), chequeDate: trim(payment.chequeDate) };
  } else if (payment.method === "UPI") {
    methodDetails = { transactionId: trim(payment.transactionId), ...(trim(payment.upiId) ? { upiId: trim(payment.upiId) } : {}) };
  } else if (payment.method === "CARD") {
    methodDetails = {
      cardLast4: trim(payment.cardLast4),
      ...(trim(payment.cardReference) ? { cardReference: trim(payment.cardReference) } : {}),
    };
  }
  return {
    ...(amounts.usingPerCode ? { amountPerCode: round2(amounts.perCode) } : {}),
    grossAmount: amounts.gross,
    ...(amounts.discountPercent > 0 ? { discountPercent: amounts.discountPercent } : {}),
    totalAmount: amounts.total,
    paidAmount: amounts.paid,
    splitBalance: true,
    // Paid in full now: no installments.
    installments: amounts.needsPlan ? amounts.installments : 1,
    ...(amounts.needsPlan
      ? {
          installmentDueDates: fitDueDates(payment.dueDates, amounts.installments).map((date) => new Date(`${date}T00:00:00`).toISOString()),
          ...(() => {
            const plan = deriveInstallments(amounts.planTotal, amounts.installments, payment.installmentAmounts);
            return plan.isCustom ? { installmentAmounts: plan.values.map((item) => Math.round(Number(item) * 100) / 100) } : {};
          })(),
        }
      : {}),
    ...(amounts.paid > 0 && payment.method ? { method: payment.method, methodDetails } : {}),
  };
}

/** Payment for a batch or a renewal: price, discount, amount paid, installments and method. */
export default function PaymentFields({
  value,
  onChange,
  idPrefix,
  context,
}: {
  value: PaymentFormState;
  onChange: (next: PaymentFormState) => void;
  idPrefix: string;
  /** Codes and months being billed. Enables "Amount per code per month". */
  context?: BillingContext;
}) {
  const update = <K extends keyof PaymentFormState>(key: K, next: PaymentFormState[K]) => onChange({ ...value, [key]: next });
  const amounts = computeAmounts(value, context);
  const { gross, discountPercent, discount, total, paid, installments, pending, status, planTotal, needsPlan } = amounts;
  const dueDates = fitDueDates(value.dueDates, installments);
  // Typed amounts stay; the rest share what is left of the total, re-worked on every change.
  const plan = deriveInstallments(planTotal, installments, value.installmentAmounts);
  const customAmounts = plan.isCustom;
  const shownAmounts = plan.values;
  const amountsSum = plan.sum;
  const amountsGap = plan.gap;

  // Keep exactly one due date per installment as the number changes; a new number of
  // installments goes back to an equal split.
  useEffect(() => {
    const changedDates = dueDates.join("|") !== value.dueDates.join("|");
    const staleAmounts = !!value.installmentAmounts && value.installmentAmounts.length !== installments;
    if (changedDates || staleAmounts) onChange({ ...value, dueDates, installmentAmounts: staleAmounts ? null : value.installmentAmounts });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installments]);

  function setDueDate(index: number, date: string) {
    const next = [...dueDates];
    next[index] = date;
    onChange({ ...value, dueDates: next });
  }

  function setAmount(index: number, amount: string) {
    onChange({ ...value, installmentAmounts: typeInstallment(installments, value.installmentAmounts, index, amount) });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        {context && (
          <Field
            label="Amount per code per month (₹)"
            type="number"
            required={false}
            value={value.amountPerCode}
            onChange={(v) => update("amountPerCode", v)}
            inputProps={{ min: 0, step: "0.01", inputMode: "decimal", placeholder: "Optional" }}
          />
        )}
        <Field
          label="Amount before discount (₹)"
          type="number"
          // Worked out from the price per code when that is filled in; typing here switches to a
          // hand-entered amount, so the two can never disagree.
          value={amounts.usingPerCode ? String(gross) : value.baseAmount}
          onChange={(v) => onChange({ ...value, baseAmount: v, amountPerCode: "" })}
          inputProps={{ min: 0, step: "0.01", inputMode: "decimal" }}
        />
        <Field
          label="Discount (%)"
          type="number"
          required={false}
          value={value.discountPercent}
          onChange={(v) => update("discountPercent", v)}
          inputProps={{ min: 0, max: 100, step: "0.01", inputMode: "decimal", placeholder: "0" }}
        />
      </div>

      {context && (
        <p className="text-sm text-cx-muted">
          {amounts.usingPerCode ? (
            <>
              {context.codeCount} code{context.codeCount === 1 ? "" : "s"} × {formatInr(amounts.perCode)} ×{" "}
              {context.months} month{context.months === 1 ? "" : "s"} ={" "}
              <span className="font-semibold text-cx-heading">{formatInr(gross)}</span>
            </>
          ) : (
            `Fill in the amount per code per month and it is worked out for ${context.codeCount} code${
              context.codeCount === 1 ? "" : "s"
            } × ${context.months} month${context.months === 1 ? "" : "s"}. Or type the amount yourself.`
          )}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Field
          label="Amount paid now (₹)"
          type="number"
          value={value.paidAmount}
          onChange={(v) => update("paidAmount", v)}
          inputProps={{ min: 0, step: "0.01", inputMode: "decimal" }}
        />
        {needsPlan && (
          <Field
            label={paid > 0 ? "Installments for the rest" : "Installments"}
            type="number"
            value={value.installments}
            onChange={(v) => update("installments", v)}
            inputProps={{ min: 1, max: 60, step: 1, inputMode: "numeric" }}
          />
        )}
      </div>

      {!needsPlan && total > 0 && (
        <p className="rounded-xl border border-cx-accent/20 bg-cx-tint/60 px-3.5 py-2.5 text-sm text-cx-text">
          Paid in full now. No installments are needed.
        </p>
      )}

      {/* Amount and due date for every installment (of what is left after the amount paid now) */}
      {needsPlan && (
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="cx-label">{installments === 1 ? "Amount and due date" : "Installments"}</span>
          {customAmounts && installments > 1 && (
            <button
              type="button"
              onClick={() => onChange({ ...value, installmentAmounts: null })}
              className="cx-link inline-flex min-h-11 items-center rounded-lg px-1 text-sm"
            >
              Split equally
            </button>
          )}
        </div>
        <p className="mt-0.5 text-xs text-cx-muted">
          {paid > 0 ? `The ${formatInr(paid)} paid now is separate. The remaining ${formatInr(planTotal)} is split into these installments. ` : ""}
          {installments > 1
            ? "Split equally to start. Type an amount for any installment and the others share the rest automatically. "
            : ""}
          The school is reminded 3 days before each date, on the date, and when it is a week overdue.
        </p>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {dueDates.map((date, index) => (
            <li key={index} className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 rounded-xl border border-cx-border bg-white p-2 pl-3">
              <span className="text-sm font-semibold text-cx-heading">
                #{index + 1}
                {installments > 1 && customAmounts && !plan.typed[index] && (
                  <span className="block text-[10px] font-medium uppercase tracking-wider text-cx-muted">auto</span>
                )}
              </span>
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                aria-label={`Amount for installment ${index + 1} (₹)${plan.typed[index] ? "" : ", worked out automatically"}`}
                value={shownAmounts[index] ?? ""}
                disabled={installments === 1}
                onChange={(e) => setAmount(index, e.target.value)}
                className={`cx-input w-full ${customAmounts && !plan.typed[index] ? "bg-cx-surface text-cx-muted" : ""}`}
              />
              <input
                type="date"
                aria-label={`Due date for installment ${index + 1}`}
                value={date}
                onChange={(e) => setDueDate(index, e.target.value)}
                className="cx-input w-full"
              />
            </li>
          ))}
        </ul>
        {customAmounts && Math.abs(amountsGap) >= 0.005 && (
          <p className="mt-2 text-sm text-amber-700">
            The amounts you typed come to {formatInr(amountsSum)}, which is {formatInr(Math.abs(amountsGap))}{" "}
            {amountsGap > 0 ? "more" : "less"} than the remaining {formatInr(planTotal)}. Lower one of them, or click “Split equally”.
          </p>
        )}
      </div>
      )}

      <div className="rounded-xl border border-cx-accent/20 bg-cx-tint/60 p-3.5">
        {discount > 0 && (
          <div className="mb-3 space-y-1 border-b border-cx-accent/15 pb-3 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-cx-muted">Before discount</span>
              <span className="font-medium text-cx-heading">{formatInr(gross)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-cx-muted">Discount ({discountPercent}%)</span>
              <span className="font-medium text-cx-heading">− {formatInr(discount)}</span>
            </div>
          </div>
        )}
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Figure label="Total" value={formatInr(total)} />
          <Figure label="Paid" value={formatInr(paid)} />
          <Figure label="Pending" value={formatInr(pending)} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <PaymentStatusBadge status={status} />
          {needsPlan && installments > 1 && (
            <span className="text-xs text-cx-muted">
              {paid > 0 ? `${formatInr(paid)} now + ` : ""}
              {installments} installments of {formatInr(round2(planTotal / installments))}
            </span>
          )}
          {needsPlan && installments === 1 && paid > 0 && (
            <span className="text-xs text-cx-muted">
              {formatInr(paid)} now + {formatInr(planTotal)} later
            </span>
          )}
        </div>
      </div>

      {paid > 0 && (
        <div className="space-y-4">
          <div>
            <span id={`${idPrefix}-method-label`} className="cx-label">
              Payment method
            </span>
            <div role="radiogroup" aria-labelledby={`${idPrefix}-method-label`} className="mt-2 flex flex-wrap gap-2">
              {methods.map((item) => {
                const Icon = item.icon;
                const active = value.method === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => update("method", item.value)}
                    className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                      active ? "border-cx-accent bg-cx-tint text-cx-accent" : "border-cx-border bg-white text-cx-text hover:bg-cx-surface"
                    }`}
                  >
                    <Icon size={16} aria-hidden="true" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          {value.method === "CASH" && (
            <p className="rounded-xl border border-cx-border bg-cx-surface px-3.5 py-2.5 text-sm text-cx-text">
              Cash received: <span className="font-semibold">{formatInr(paid)}</span>
            </p>
          )}

          {value.method === "CHEQUE" && (
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Cheque number" value={value.chequeNumber} onChange={(v) => update("chequeNumber", v)} />
              <Field label="Bank name" value={value.bankName} onChange={(v) => update("bankName", v)} />
              <Field label="Cheque date" type="date" value={value.chequeDate} onChange={(v) => update("chequeDate", v)} />
            </div>
          )}

          {value.method === "UPI" && (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Transaction ID" value={value.transactionId} onChange={(v) => update("transactionId", v)} />
              <Field label="UPI ID (optional)" required={false} value={value.upiId} onChange={(v) => update("upiId", v)} />
            </div>
          )}

          {value.method === "CARD" && (
            <div className="space-y-2">
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label="Last 4 digits of card"
                  value={value.cardLast4}
                  onChange={(v) => update("cardLast4", v.replace(/\D/g, "").slice(0, 4))}
                  inputProps={{ inputMode: "numeric", maxLength: 4, pattern: "\\d{4}", autoComplete: "off" }}
                />
                <Field
                  label="Transaction reference (optional)"
                  required={false}
                  value={value.cardReference}
                  onChange={(v) => update("cardReference", v)}
                />
              </div>
              <p className="text-xs text-cx-muted">Never enter the full card number.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wider text-cx-muted">{label}</div>
      <div className="mt-0.5 break-words font-semibold text-cx-heading">{value}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = true,
  inputProps,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
}) {
  return (
    <label className="block min-w-0">
      <span className="cx-label">{label}</span>
      <input
        {...inputProps}
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="cx-input mt-1 w-full"
      />
    </label>
  );
}
