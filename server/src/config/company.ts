/**
 * Company details printed on invoices ("Billed by") and in the emails that ask a school to
 * renew. Fill in the empty values; anything left empty is simply left off the invoice.
 */
export const COMPANY = {
  name: "CensorX Technologies",
  product: "CensorX for Schools",
  email: "team@censorx.in",
  website: "censorx.in",
  /** Registered address, one line per comma-separated part is fine. */
  address: "",
  /** State of the registered address — printed with the address. */
  state: "",
  phone: "",
  /** WhatsApp numbers schools can message, printed in emails and on invoices. */
  whatsapp: ["+91 98203 76923", "+91 84548 00911"],
  /** The school portal. */
  portalUrl: "https://school.censorx.in",
  /** GSTIN, when registered. Printed as "GSTIN". */
  taxId: "",
  /** PAN of the business. */
  pan: "",
  /** SAC (service accounting code) for the service, when you have chosen one. */
  sac: "",
  /** Days given to pay any pending balance, printed in the terms. */
  paymentTermsDays: 15,
};

/** The ways a school can reach us, as "Label: value" lines, skipping anything not filled in. */
export function companyContactLines(): string[] {
  const lines: string[] = [];
  if (COMPANY.email) lines.push(`Email: ${COMPANY.email}`);
  if (COMPANY.phone) lines.push(`Phone: ${COMPANY.phone}`);
  if (COMPANY.whatsapp.length) lines.push(`WhatsApp: ${COMPANY.whatsapp.join(" | ")}`);
  if (COMPANY.website) lines.push(`Website: ${COMPANY.website}`);
  return lines;
}

/** One line for the foot of an invoice: email, WhatsApp and website. */
export function companyContactFooter(): string {
  return [
    COMPANY.email,
    COMPANY.phone,
    COMPANY.whatsapp.length ? `WhatsApp: ${COMPANY.whatsapp.join(", ")}` : "",
    COMPANY.website,
  ]
    .filter(Boolean)
    .join(" | ");
}

const PLAN_NAMES: Record<string, string> = {
  MONTHLY: "Monthly",
  THREE_MONTHS: "3-month",
  SIX_MONTHS: "6-month",
  YEARLY: "Yearly",
  CUSTOM: "Custom",
};

/** The plan as schools see it, from the plan duration: MONTHLY → "Monthly", THREE_MONTHS → "3-month". */
export function planName(planDuration?: string | null, months?: number | null): string {
  if (planDuration && PLAN_NAMES[planDuration] && planDuration !== "CUSTOM") return PLAN_NAMES[planDuration];
  if (months === 1) return "Monthly";
  if (months === 12) return "Yearly";
  if (months && months > 0) return `${months}-month`;
  return planDuration ? PLAN_NAMES[planDuration] ?? "School" : "School";
}
