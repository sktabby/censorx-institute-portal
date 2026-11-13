import { useState, type InputHTMLAttributes } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { Banknote, CreditCard, Landmark, Smartphone, type LucideIcon } from "lucide-react";
import PortalLayout from "../../layouts/PortalLayout";
import PageHeader from "../../components/PageHeader";
import PaymentStatusBadge, { formatInr, paymentStatusFor } from "../../components/PaymentStatusBadge";
import { apiClient, type ApiResponse } from "../../api/client";
import { adminNavItems } from "./navItems";

const createSchoolSchema = z.object({
  name: z.string().min(2, "Name is required."),
  contactName: z.string().min(2, "Contact person is required."),
  contactPhone: z.string().min(6, "Phone is required."),
  contactEmail: z.string().email("Enter a valid email address."),
});

const initial = {
  name: "",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
};

type Method = "CASH" | "CHEQUE" | "UPI" | "CARD";

const methods: { value: Method; label: string; icon: LucideIcon }[] = [
  { value: "CASH", label: "Cash", icon: Banknote },
  { value: "CHEQUE", label: "Cheque", icon: Landmark },
  { value: "UPI", label: "UPI", icon: Smartphone },
  { value: "CARD", label: "Card", icon: CreditCard },
];

const initialPayment = {
  totalAmount: "",
  paidAmount: "0",
  installments: "1",
  method: "" as Method | "",
  chequeNumber: "",
  bankName: "",
  chequeDate: "",
  transactionId: "",
  upiId: "",
  cardLast4: "",
  cardReference: "",
};

interface CreateSchoolResponse {
  organizationId: string;
  billEmail?: { sent: boolean; to: string; warning?: string };
}

export default function CreateSchool() {
  const [form, setForm] = useState(initial);
  const [payment, setPayment] = useState(initialPayment);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  function update<K extends keyof typeof initial>(key: K, value: (typeof initial)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updatePayment<K extends keyof typeof initialPayment>(key: K, value: (typeof initialPayment)[K]) {
    setPayment((p) => ({ ...p, [key]: value }));
  }

  // Display figures worked out from what the admin has typed.
  const total = Number(payment.totalAmount) || 0;
  const paid = Number(payment.paidAmount) || 0;
  const installments = Math.max(1, Math.floor(Number(payment.installments)) || 1);
  const pending = Math.max(0, Math.round((total - paid) * 100) / 100);
  const status = paymentStatusFor(total, paid);

  function detailsFor(method: Method) {
    const trim = (value: string) => value.trim();
    if (method === "CHEQUE") {
      return {
        chequeNumber: trim(payment.chequeNumber),
        bankName: trim(payment.bankName),
        chequeDate: trim(payment.chequeDate),
      };
    }
    if (method === "UPI") {
      return {
        transactionId: trim(payment.transactionId),
        ...(trim(payment.upiId) ? { upiId: trim(payment.upiId) } : {}),
      };
    }
    if (method === "CARD") {
      return {
        cardLast4: trim(payment.cardLast4),
        ...(trim(payment.cardReference) ? { cardReference: trim(payment.cardReference) } : {}),
      };
    }
    return undefined;
  }

  function validatePayment(): string | null {
    if (!(total > 0)) return "Enter the total amount.";
    if (paid < 0) return "Amount paid cannot be negative.";
    if (paid > total) return "Amount paid cannot be more than the total amount.";
    if (!Number.isInteger(Number(payment.installments)) || installments < 1 || installments > 60) {
      return "Installments must be a whole number from 1 to 60.";
    }
    if (paid > 0) {
      if (!payment.method) return "Select a payment method.";
      if (payment.method === "CHEQUE" && (!payment.chequeNumber.trim() || !payment.bankName.trim() || !payment.chequeDate)) {
        return "Enter the cheque number, bank name and cheque date.";
      }
      if (payment.method === "UPI" && !payment.transactionId.trim()) return "Enter the UPI transaction ID.";
      if (payment.method === "CARD" && !/^\d{4}$/.test(payment.cardLast4.trim())) {
        return "Enter the last 4 digits of the card.";
      }
    }
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setWarning(null);

    const parsed = createSchoolSchema.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
      return;
    }

    const paymentError = validatePayment();
    if (paymentError) {
      setError(paymentError);
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiClient.post<ApiResponse<CreateSchoolResponse>>("/admin/organizations", {
        ...parsed.data,
        payment: {
          totalAmount: total,
          paidAmount: paid,
          installments,
          ...(paid > 0 && payment.method ? { method: payment.method, methodDetails: detailsFor(payment.method) } : {}),
        },
      });
      if (res.data.success) {
        const organizationId = res.data.data.organizationId;
        const billEmail = res.data.data.billEmail;
        setMessage(
          billEmail?.sent
            ? `School created. Login details and the bill were emailed to ${billEmail.to}.`
            : "School created and temporary password email sent."
        );
        if (billEmail && !billEmail.sent) setWarning(billEmail.warning ?? "The bill email could not be sent.");
        setTimeout(() => navigate(`/admin/schools/${organizationId}`), billEmail && !billEmail.sent ? 2500 : 1200);
      } else {
        setError(res.data.error.message);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? "Failed to create school.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PortalLayout items={adminNavItems}>
      <PageHeader title="Create School" />

      <form onSubmit={onSubmit} className="cx-form-card max-w-3xl space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Name" value={form.name} onChange={(v) => update("name", v)} />
          <Field label="Contact person" value={form.contactName} onChange={(v) => update("contactName", v)} />
          <Field label="Phone" value={form.contactPhone} onChange={(v) => update("contactPhone", v)} />
          <Field label="Email" type="email" value={form.contactEmail} onChange={(v) => update("contactEmail", v)} />
        </div>

        {/* Payment */}
        <section aria-labelledby="payment-heading" className="space-y-4 border-t border-cx-line pt-6">
          <h2 id="payment-heading" className="text-base font-semibold">
            Payment
          </h2>

          <div className="grid gap-4 md:grid-cols-3">
            <Field
              label="Total amount (₹)"
              type="number"
              value={payment.totalAmount}
              onChange={(v) => updatePayment("totalAmount", v)}
              inputProps={{ min: 0, step: "0.01", inputMode: "decimal" }}
            />
            <Field
              label="Amount paid (₹)"
              type="number"
              value={payment.paidAmount}
              onChange={(v) => updatePayment("paidAmount", v)}
              inputProps={{ min: 0, step: "0.01", inputMode: "decimal" }}
            />
            <Field
              label="Installments"
              type="number"
              value={payment.installments}
              onChange={(v) => updatePayment("installments", v)}
              inputProps={{ min: 1, max: 60, step: 1, inputMode: "numeric" }}
            />
          </div>

          {/* Live summary */}
          <div className="rounded-xl border border-cx-accent/20 bg-cx-tint/60 p-3.5">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <Figure label="Total" value={formatInr(total)} />
              <Figure label="Paid" value={formatInr(paid)} />
              <Figure label="Pending" value={formatInr(pending)} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <PaymentStatusBadge status={status} />
              {installments > 1 && total > 0 && (
                <span className="text-xs text-cx-muted">
                  {installments} installments of {formatInr(Math.round((total / installments) * 100) / 100)}
                </span>
              )}
            </div>
          </div>

          {/* Method: only needed once something has been paid */}
          {paid > 0 && (
            <div className="space-y-4">
              <div>
                <span id="payment-method-label" className="cx-label">
                  Payment method
                </span>
                <div role="radiogroup" aria-labelledby="payment-method-label" className="mt-2 flex flex-wrap gap-2">
                  {methods.map((item) => {
                    const Icon = item.icon;
                    const active = payment.method === item.value;
                    return (
                      <button
                        key={item.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => updatePayment("method", item.value)}
                        className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                          active
                            ? "border-cx-accent bg-cx-tint text-cx-accent"
                            : "border-cx-border bg-white text-cx-text hover:bg-cx-surface"
                        }`}
                      >
                        <Icon size={16} aria-hidden="true" />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {payment.method === "CASH" && (
                <p className="rounded-xl border border-cx-border bg-cx-surface px-3.5 py-2.5 text-sm text-cx-text">
                  Cash received: <span className="font-semibold">{formatInr(paid)}</span>
                </p>
              )}

              {payment.method === "CHEQUE" && (
                <div className="grid gap-4 md:grid-cols-3">
                  <Field
                    label="Cheque number"
                    value={payment.chequeNumber}
                    onChange={(v) => updatePayment("chequeNumber", v)}
                  />
                  <Field label="Bank name" value={payment.bankName} onChange={(v) => updatePayment("bankName", v)} />
                  <Field
                    label="Cheque date"
                    type="date"
                    value={payment.chequeDate}
                    onChange={(v) => updatePayment("chequeDate", v)}
                  />
                </div>
              )}

              {payment.method === "UPI" && (
                <div className="grid gap-4 md:grid-cols-2">
                  <Field
                    label="Transaction ID"
                    value={payment.transactionId}
                    onChange={(v) => updatePayment("transactionId", v)}
                  />
                  <Field
                    label="UPI ID (optional)"
                    required={false}
                    value={payment.upiId}
                    onChange={(v) => updatePayment("upiId", v)}
                  />
                </div>
              )}

              {payment.method === "CARD" && (
                <div className="space-y-2">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field
                      label="Last 4 digits of card"
                      value={payment.cardLast4}
                      onChange={(v) => updatePayment("cardLast4", v.replace(/\D/g, "").slice(0, 4))}
                      inputProps={{ inputMode: "numeric", maxLength: 4, pattern: "\\d{4}", autoComplete: "off" }}
                    />
                    <Field
                      label="Transaction reference (optional)"
                      required={false}
                      value={payment.cardReference}
                      onChange={(v) => updatePayment("cardReference", v)}
                    />
                  </div>
                  <p className="text-xs text-cx-muted">Never enter the full card number.</p>
                </div>
              )}
            </div>
          )}
        </section>

        {error && <p role="alert" className="cx-alert-error">{error}</p>}
        {message && <p role="status" className="cx-alert-success">{message}</p>}
        {warning && <p role="status" className="cx-alert-warn">{warning}</p>}

        <button type="submit" disabled={submitting} className="cx-btn-primary w-full sm:w-auto">
          {submitting ? "Creating..." : "Create School"}
        </button>
      </form>
    </PortalLayout>
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
