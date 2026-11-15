import { Banknote, CreditCard, Landmark, Smartphone, type LucideIcon } from "lucide-react";

export type PayMethod = "CASH" | "CHEQUE" | "UPI" | "CARD";

export interface PayDetails {
  chequeNumber: string;
  bankName: string;
  chequeDate: string;
  transactionId: string;
  upiId: string;
  cardLast4: string;
  cardReference: string;
}

export const emptyPayDetails: PayDetails = {
  chequeNumber: "",
  bankName: "",
  chequeDate: "",
  transactionId: "",
  upiId: "",
  cardLast4: "",
  cardReference: "",
};

const METHODS: { value: PayMethod; label: string; icon: LucideIcon }[] = [
  { value: "CASH", label: "Cash", icon: Banknote },
  { value: "CHEQUE", label: "Cheque", icon: Landmark },
  { value: "UPI", label: "UPI", icon: Smartphone },
  { value: "CARD", label: "Card", icon: CreditCard },
];

/** The first thing missing for this method, or null when it is complete. */
export function payMethodError(method: PayMethod | "", details: PayDetails): string | null {
  if (!method) return "Choose how it was paid.";
  if (method === "CHEQUE" && (!details.chequeNumber.trim() || !details.bankName.trim() || !details.chequeDate)) {
    return "Enter the cheque number, bank name and cheque date.";
  }
  if (method === "UPI" && !details.transactionId.trim()) return "Enter the UPI transaction ID.";
  if (method === "CARD" && !/^\d{4}$/.test(details.cardLast4.trim())) return "Enter the last 4 digits of the card.";
  return null;
}

/** The details the server stores for this method (nothing for cash). */
export function payMethodDetails(method: PayMethod, details: PayDetails): Record<string, string> | undefined {
  if (method === "CHEQUE") return { chequeNumber: details.chequeNumber.trim(), bankName: details.bankName.trim(), chequeDate: details.chequeDate };
  if (method === "UPI") return { transactionId: details.transactionId.trim(), ...(details.upiId.trim() ? { upiId: details.upiId.trim() } : {}) };
  if (method === "CARD") {
    return { cardLast4: details.cardLast4.trim(), ...(details.cardReference.trim() ? { cardReference: details.cardReference.trim() } : {}) };
  }
  return undefined;
}

/** "Paid by" chips plus the fields that method needs. */
export default function PaymentMethodPicker({
  idPrefix,
  method,
  onMethod,
  details,
  onDetails,
}: {
  idPrefix: string;
  method: PayMethod | "";
  onMethod: (method: PayMethod) => void;
  details: PayDetails;
  onDetails: (details: PayDetails) => void;
}) {
  const set = (key: keyof PayDetails, value: string) => onDetails({ ...details, [key]: value });
  return (
    <div className="space-y-3">
      <div>
        <span id={`${idPrefix}-method`} className="cx-label">
          Paid by
        </span>
        <div role="radiogroup" aria-labelledby={`${idPrefix}-method`} className="mt-2 flex flex-wrap gap-2">
          {METHODS.map((item) => {
            const Icon = item.icon;
            const active = method === item.value;
            return (
              <button
                key={item.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onMethod(item.value)}
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
          <Input label="Cheque number" value={details.chequeNumber} onChange={(v) => set("chequeNumber", v)} />
          <Input label="Bank name" value={details.bankName} onChange={(v) => set("bankName", v)} />
          <Input label="Cheque date" type="date" value={details.chequeDate} onChange={(v) => set("chequeDate", v)} />
        </div>
      )}
      {method === "UPI" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Transaction ID" value={details.transactionId} onChange={(v) => set("transactionId", v)} />
          <Input label="UPI ID (optional)" value={details.upiId} onChange={(v) => set("upiId", v)} />
        </div>
      )}
      {method === "CARD" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Last 4 digits of card" value={details.cardLast4} onChange={(v) => set("cardLast4", v.replace(/\D/g, "").slice(0, 4))} />
          <Input label="Transaction reference (optional)" value={details.cardReference} onChange={(v) => set("cardReference", v)} />
        </div>
      )}
    </div>
  );
}

function Input({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block min-w-0">
      <span className="cx-label">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="cx-input mt-1 w-full" />
    </label>
  );
}
