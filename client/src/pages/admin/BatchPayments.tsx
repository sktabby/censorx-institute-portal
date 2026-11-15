import { useState, type InputHTMLAttributes } from "react";
import { Banknote, CalendarDays, CreditCard, FileText, Landmark, Send, Smartphone, Wallet, type LucideIcon } from "lucide-react";
import PaymentStatusBadge, { formatInr } from "../../components/PaymentStatusBadge";
import { apiClient, type ApiResponse } from "../../api/client";
import { deriveInstallments, splitEqually, typeInstallment } from "../../utils/installments";
import { billKindLabel, formatDate, INSTALLMENT_STATUS, METHOD_LABEL, type BatchView } from "../../types/batches";

type Method = "CASH" | "CHEQUE" | "UPI" | "CARD";
type Panel = "" | "RECORD" | "DATES";

const methods: { value: Method; label: string; icon: LucideIcon }[] = [
  { value: "CASH", label: "Cash", icon: Banknote },
  { value: "CHEQUE", label: "Cheque", icon: Landmark },
  { value: "UPI", label: "UPI", icon: Smartphone },
  { value: "CARD", label: "Card", icon: CreditCard },
];

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isoDay(value: string) {
  return new Date(`${value}T00:00:00`).toISOString();
}

function toInput(value: string) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function apiError(err: any, fallback: string) {
  return err?.response?.data?.error?.message ?? fallback;
}

/**
 * The payment area of one batch in the admin Subscription page: installment schedule, every
 * bill issued, payments received, and the Record payment / Change due dates forms.
 */
export default function BatchPayments({
  base,
  batch,
  onDone,
  onShowBill,
}: {
  /** API path of the batch, e.g. /admin/organizations/{org}/subscription-batches/{id}. */
  base: string;
  batch: BatchView;
  onDone: (text: string, warning?: string) => void;
  onShowBill: (bill: { html: string; billNumber: string; pdfPath?: string }) => void;
}) {
  const payment = batch.payment;
  const [panel, setPanel] = useState<Panel>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!payment) return <p className="mt-3 text-xs text-cx-muted">No payment recorded for this batch.</p>;

  async function viewBill(billNumber: string) {
    setError(null);
    try {
      const query = `?billNumber=${encodeURIComponent(billNumber)}`;
      const res = await apiClient.get<ApiResponse<{ billNumber: string; html: string }>>(`${base}/bill${query}`);
      if (res.data.success) onShowBill({ ...res.data.data, pdfPath: `${base}/bill/pdf${query}` });
      else setError(res.data.error.message);
    } catch (err) {
      setError(apiError(err, "Could not load the bill."));
    }
  }

  async function sendBill(billNumber: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post<ApiResponse<{ to: string }>>(`${base}/bill/send?billNumber=${encodeURIComponent(billNumber)}`);
      if (res.data.success) onDone(`Bill ${billNumber} was emailed to ${res.data.data.to}.`);
      else setError(res.data.error.message);
    } catch (err) {
      setError(apiError(err, "The bill could not be emailed."));
    } finally {
      setBusy(false);
    }
  }

  const paidPercent = payment.totalAmount > 0 ? Math.min(100, Math.round((payment.paidAmount / payment.totalAmount) * 100)) : 0;

  return (
    <section className="mt-3 rounded-xl border border-cx-border p-3 sm:p-4" aria-label={`${batch.batchLabel} payments`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Wallet size={16} aria-hidden="true" className="text-cx-accent" />
          <span className="text-sm font-semibold text-cx-heading">Payment</span>
          <PaymentStatusBadge status={payment.status} />
          {payment.isOverdue && <span className="badge border-red-200 bg-red-50 text-red-700">Overdue</span>}
        </div>
        <span className="text-xs text-cx-muted">Invoice {payment.billNumber}</span>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-cx-line" aria-hidden="true">
        <div className="h-full rounded-full bg-cx-accent" style={{ width: `${paidPercent}%` }} />
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
        <Figure label="Total" value={formatInr(payment.totalAmount)} />
        <Figure label="Paid" value={formatInr(payment.paidAmount)} />
        <Figure label="Balance" value={formatInr(payment.pendingAmount)} strong={payment.pendingAmount > 0} />
      </dl>

      {/* Paid when the batch was set up: separate from the installments */}
      {(payment.upfrontAmount ?? 0) > 0 && (
        <p className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cx-accent/20 bg-cx-tint/60 px-3 py-2 text-sm">
          <span className="text-cx-text">Paid separately (not in installments)</span>
          <span className="font-semibold text-cx-heading">{formatInr(payment.upfrontAmount ?? 0)}</span>
        </p>
      )}

      {/* Installment schedule */}
      {payment.schedule.length > 0 && (
        <ul className="cx-scroll-sm mt-3 divide-y divide-cx-line rounded-lg border border-cx-border text-sm">
          {payment.schedule.map((item) => (
            <li key={item.number} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
              <span className="min-w-0">
                <span className="font-medium text-cx-heading">#{item.number}</span>
                <span className="ml-2 text-cx-muted">due {formatDate(item.dueDate)}</span>
                {item.status === "OVERDUE" && <span className="ml-2 text-xs text-red-700">{item.daysLate} days late</span>}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-cx-text">{formatInr(item.remaining > 0 ? item.remaining : item.amount)}</span>
                <span className={`badge whitespace-nowrap ${INSTALLMENT_STATUS[item.status].tone}`}>{INSTALLMENT_STATUS[item.status].label}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Bills issued */}
      <div className="mt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-cx-muted">Bills</p>
        <ul className="cx-scroll-sm mt-1 divide-y divide-cx-line rounded-lg border border-cx-border text-sm">
          {payment.bills.map((bill, index) => (
            <li key={bill.billNumber} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-1.5">
              <span className="min-w-0">
                <span className="font-medium text-cx-heading">{bill.billNumber}</span>
                {payment.bills.length > 1 && (
                  <span className={`ml-2 text-xs font-medium ${index === payment.bills.length - 1 ? "text-cx-accent" : "text-cx-muted"}`}>
                    {index === payment.bills.length - 1 ? "latest" : "replaced"}
                  </span>
                )}
                <span className="ml-2 text-xs text-cx-muted">
                  {billKindLabel(bill.kind, bill.reason)} · {formatDate(bill.issuedAt)} · balance {formatInr(bill.balance)}
                </span>
              </span>
              <span className="flex gap-1">
                <button type="button" onClick={() => viewBill(bill.billNumber)} className="cx-link inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm">
                  <FileText size={15} aria-hidden="true" /> View
                </button>
                <button
                  type="button"
                  onClick={() => sendBill(bill.billNumber)}
                  disabled={busy}
                  className="cx-link inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm"
                >
                  <Send size={15} aria-hidden="true" /> Send
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Payments received */}
      {payment.transactions.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-cx-muted">Payments received</p>
          <ul className="cx-scroll-sm mt-1 space-y-1 pr-1 text-sm">
            {payment.transactions.map((txn) => (
              <li key={txn.transactionId} className="flex flex-wrap justify-between gap-2 text-cx-text">
                <span>
                  {formatDate(txn.paidAt)} · {METHOD_LABEL[txn.method]}
                </span>
                <span className="font-medium">{formatInr(txn.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {payment.pendingAmount > 0 && (
          <button
            type="button"
            onClick={() => setPanel(panel === "RECORD" ? "" : "RECORD")}
            aria-expanded={panel === "RECORD"}
            className={panel === "RECORD" ? "cx-btn-primary" : "cx-btn-secondary"}
          >
            <Banknote size={16} aria-hidden="true" />
            Record payment
          </button>
        )}
        {payment.pendingAmount > 0 && (
          <button
            type="button"
            onClick={() => setPanel(panel === "DATES" ? "" : "DATES")}
            aria-expanded={panel === "DATES"}
            className={panel === "DATES" ? "cx-btn-primary" : "cx-btn-secondary"}
          >
            <CalendarDays size={16} aria-hidden="true" />
            Change installments
          </button>
        )}
      </div>

      {error && <p role="alert" className="cx-alert-error mt-3">{error}</p>}

      {panel === "RECORD" && (
        <RecordPaymentForm
          base={base}
          batch={batch}
          onDone={(text, warning) => {
            setPanel("");
            onDone(text, warning);
          }}
        />
      )}
      {panel === "DATES" && (
        <DueDatesForm
          base={base}
          batch={batch}
          onDone={(text) => {
            setPanel("");
            onDone(text);
          }}
        />
      )}
    </section>
  );
}

function RecordPaymentForm({ base, batch, onDone }: { base: string; batch: BatchView; onDone: (text: string, warning?: string) => void }) {
  const payment = batch.payment!;
  const [amount, setAmount] = useState(String(payment.nextDue?.remaining ?? payment.pendingAmount));
  const [paidAt, setPaidAt] = useState(today());
  const [method, setMethod] = useState<Method | "">("");
  const [details, setDetails] = useState({ chequeNumber: "", bankName: "", chequeDate: "", transactionId: "", upiId: "", cardLast4: "", cardReference: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof details, value: string) => setDetails((current) => ({ ...current, [key]: value }));
  const value = Number(amount) || 0;

  async function submit() {
    setError(null);
    if (!(value > 0)) return setError("Enter the amount received.");
    if (value > payment.pendingAmount) return setError(`The balance due is ${formatInr(payment.pendingAmount)}.`);
    if (!paidAt) return setError("Choose the date the payment was received.");
    if (!method) return setError("Choose how it was paid.");
    if (method === "CHEQUE" && (!details.chequeNumber.trim() || !details.bankName.trim() || !details.chequeDate)) {
      return setError("Enter the cheque number, bank name and cheque date.");
    }
    if (method === "UPI" && !details.transactionId.trim()) return setError("Enter the UPI transaction ID.");
    if (method === "CARD" && !/^\d{4}$/.test(details.cardLast4.trim())) return setError("Enter the last 4 digits of the card.");

    const methodDetails =
      method === "CHEQUE"
        ? { chequeNumber: details.chequeNumber.trim(), bankName: details.bankName.trim(), chequeDate: details.chequeDate }
        : method === "UPI"
          ? { transactionId: details.transactionId.trim(), ...(details.upiId.trim() ? { upiId: details.upiId.trim() } : {}) }
          : method === "CARD"
            ? { cardLast4: details.cardLast4.trim(), ...(details.cardReference.trim() ? { cardReference: details.cardReference.trim() } : {}) }
            : undefined;

    setBusy(true);
    try {
      const res = await apiClient.post<ApiResponse<{ billNumber: string; pendingAmount: number; billEmail: { sent: boolean; to: string } }>>(
        `${base}/payments`,
        { amount: value, paidAt: isoDay(paidAt), method, ...(methodDetails ? { methodDetails } : {}) }
      );
      if (!res.data.success) return setError(res.data.error.message);
      const result = res.data.data;
      onDone(
        `${formatInr(value)} recorded for ${batch.batchLabel}. New bill ${result.billNumber}` +
          (result.billEmail.sent ? ` emailed to ${result.billEmail.to}.` : ".") +
          (result.pendingAmount > 0 ? ` Balance due: ${formatInr(result.pendingAmount)}.` : " The bill is now fully paid."),
        (res.data.meta?.warning as string | undefined) ?? undefined
      );
    } catch (err) {
      setError(apiError(err, "The payment could not be recorded."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-4 border-t border-cx-line pt-4">
      <p className="text-sm text-cx-muted">
        A new bill showing the payment and the balance is issued, emailed to the school, and shown in its portal.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount received (₹)" type="number" value={amount} onChange={setAmount} inputProps={{ min: 0, step: "0.01", inputMode: "decimal" }} />
        <Field label="Date received" type="date" value={paidAt} onChange={setPaidAt} />
      </div>
      <div>
        <span id={`${batch.subscriptionId}-pay-method`} className="cx-label">
          Paid by
        </span>
        <div role="radiogroup" aria-labelledby={`${batch.subscriptionId}-pay-method`} className="mt-2 flex flex-wrap gap-2">
          {methods.map((item) => {
            const Icon = item.icon;
            const active = method === item.value;
            return (
              <button
                key={item.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setMethod(item.value)}
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
      {method === "CHEQUE" && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Cheque number" value={details.chequeNumber} onChange={(v) => set("chequeNumber", v)} />
          <Field label="Bank name" value={details.bankName} onChange={(v) => set("bankName", v)} />
          <Field label="Cheque date" type="date" value={details.chequeDate} onChange={(v) => set("chequeDate", v)} />
        </div>
      )}
      {method === "UPI" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Transaction ID" value={details.transactionId} onChange={(v) => set("transactionId", v)} />
          <Field label="UPI ID (optional)" value={details.upiId} onChange={(v) => set("upiId", v)} />
        </div>
      )}
      {method === "CARD" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Last 4 digits of card"
            value={details.cardLast4}
            onChange={(v) => set("cardLast4", v.replace(/\D/g, "").slice(0, 4))}
            inputProps={{ inputMode: "numeric", maxLength: 4, autoComplete: "off" }}
          />
          <Field label="Reference (optional)" value={details.cardReference} onChange={(v) => set("cardReference", v)} />
        </div>
      )}
      {error && <p role="alert" className="cx-alert-error">{error}</p>}
      <button type="button" onClick={submit} disabled={busy} className="cx-btn-primary w-full sm:w-auto">
        {busy ? "Recording..." : "Record payment and send bill"}
      </button>
    </div>
  );
}

function DueDatesForm({ base, batch, onDone }: { base: string; batch: BatchView; onDone: (text: string) => void }) {
  const payment = batch.payment!;
  const initial = payment.schedule.length
    ? payment.schedule.map((item) => toInput(item.dueDate))
    : Array.from({ length: payment.installments }, () => today());
  const [dates, setDates] = useState<string[]>(initial);
  const count = initial.length;
  // The installments add up to the total less the amount paid at the start (kept separate).
  const planTotal = Math.round((payment.totalAmount - (payment.upfrontAmount ?? 0)) * 100) / 100;
  const equalParts = splitEqually(planTotal, count);
  // Start from the bill's current amounts: nothing typed if they are an equal split; otherwise
  // keep them all, with the last one left automatic so it absorbs any change.
  const [entries, setEntries] = useState<Array<string | null> | null>(() => {
    const current = payment.schedule.length === count ? payment.schedule.map((item) => item.amount) : equalParts;
    const isEqual = current.every((amount, index) => Math.abs(amount - equalParts[index]) < 0.005);
    return isEqual ? null : current.map((amount, index) => (index === count - 1 ? null : String(amount)));
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const plan = deriveInstallments(planTotal, count, entries);
  const amounts = plan.values;
  const sum = plan.sum;
  const gap = plan.gap;
  const isEqualSplit = !plan.isCustom;
  const setAmount = (index: number, value: string) => setEntries((current) => typeInstallment(count, current, index, value));

  async function submit() {
    setError(null);
    // Dates may be in any order: an installment added later for extra codes can fall due before
    // the original last one. Payments always settle the installment due first.
    if (dates.some((date) => !date)) return setError("Choose a date for every installment.");
    const bad = amounts.findIndex((item) => !(Number(item) > 0));
    if (bad >= 0) {
      return setError(
        gap > 0
          ? `The amounts you typed are more than the ${payment.upfrontAmount ? "amount left after what was paid separately" : "bill total"} of ${formatInr(planTotal)}, so nothing is left for installment ${bad + 1}. Lower one of them.`
          : `Enter an amount above 0 for installment ${bad + 1}.`
      );
    }
    if (Math.abs(gap) >= 0.005) {
      return setError(`The installments add up to ${formatInr(sum)}, but they must add up to ${formatInr(planTotal)}. Lower one of them.`);
    }
    setBusy(true);
    try {
      const res = await apiClient.put<ApiResponse<{ billNumber: string | null; billEmail?: { sent: boolean; to: string } }>>(
        `${base}/installments`,
        {
          dueDates: dates.map(isoDay),
          amounts: amounts.map((item) => Math.round(Number(item) * 100) / 100),
        }
      );
      if (!res.data.success) return setError(res.data.error.message);
      const { billNumber, billEmail } = res.data.data;
      const warning = (res.data.meta as { warning?: string }).warning;
      onDone(
        billNumber
          ? `Installments for ${batch.batchLabel} updated. New bill ${billNumber} replaces the earlier bills` +
              (billEmail?.sent ? ` and was emailed to ${billEmail.to}.` : `. ${warning ?? "It could not be emailed."}`)
          : `Nothing changed in the installments for ${batch.batchLabel}.`
      );
    } catch (err) {
      setError(apiError(err, "The installments could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-3 border-t border-cx-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-cx-muted">
          Type an amount or date for any installment. The installments you have not typed share the rest of the total automatically.
        </p>
        {!isEqualSplit && (
          <button type="button" onClick={() => setEntries(null)} className="cx-link inline-flex min-h-11 items-center rounded-lg px-1 text-sm">
            Split equally
          </button>
        )}
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {dates.map((date, index) => (
          <li key={index} className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 rounded-xl border border-cx-border p-2 pl-3">
            <span className="text-sm font-semibold text-cx-heading">
              #{index + 1}
              {count > 1 && plan.isCustom && !plan.typed[index] && (
                <span className="block text-[10px] font-medium uppercase tracking-wider text-cx-muted">auto</span>
              )}
            </span>
            <input
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              aria-label={`Amount for installment ${index + 1} (₹)${plan.typed[index] ? "" : ", worked out automatically"}`}
              value={amounts[index] ?? ""}
              disabled={count === 1}
              onChange={(e) => setAmount(index, e.target.value)}
              className={`cx-input w-full ${plan.isCustom && !plan.typed[index] ? "bg-cx-surface text-cx-muted" : ""}`}
            />
            <input
              type="date"
              aria-label={`Due date for installment ${index + 1}`}
              value={date}
              onChange={(e) => setDates((current) => current.map((item, i) => (i === index ? e.target.value : item)))}
              className="cx-input w-full"
            />
          </li>
        ))}
      </ul>
      <p className={`text-sm ${Math.abs(gap) >= 0.005 ? "text-amber-700" : "text-cx-muted"}`}>
        Installments total {formatInr(sum)} of {formatInr(planTotal)}
        {payment.upfrontAmount ? ` (the ${formatInr(payment.upfrontAmount)} paid separately is not part of them)` : ""}
        {Math.abs(gap) >= 0.005 && ` — ${formatInr(Math.abs(gap))} ${gap > 0 ? "too much" : "short"}`}.
      </p>
      {error && <p role="alert" className="cx-alert-error">{error}</p>}
      <button type="button" onClick={submit} disabled={busy} className="cx-btn-primary w-full sm:w-auto">
        {busy ? "Saving..." : "Save installments"}
      </button>
    </div>
  );
}

function Figure({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-medium uppercase tracking-wider text-cx-muted">{label}</dt>
      <dd className={`mt-0.5 break-words font-semibold ${strong ? "text-amber-700" : "text-cx-heading"}`}>{value}</dd>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  inputProps,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
}) {
  return (
    <label className="block min-w-0">
      <span className="cx-label">{label}</span>
      <input {...inputProps} type={type} value={value} onChange={(e) => onChange(e.target.value)} className="cx-input mt-1 w-full" />
    </label>
  );
}
