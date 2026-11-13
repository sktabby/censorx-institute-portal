import { Timestamp } from "firebase-admin/firestore";
import { COMPANY } from "../config/company";
import { sendBillEmail } from "./emailService";
import type {
  Organization,
  OrganizationPayment,
  PaymentMethod,
  PaymentMethodDetails,
  PaymentStatus,
} from "../models/types";
import type { OrganizationPaymentInput } from "../types/serviceInputs";

/** The school fields a bill needs. */
export type BillRecipient = Pick<Organization, "organizationId" | "name" | "contactName" | "contactEmail" | "contactPhone">;

const round2 = (value: number) => Math.round(value * 100) / 100;

export function derivePaymentStatus(total: number, paid: number): PaymentStatus {
  if (paid >= total) return "PREPAID";
  if (paid <= 0) return "PENDING_PAYMENT";
  return "INSTALLMENTS";
}

function makeBillNumber(organizationId: string, date: Date) {
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, "");
  return `CXS-${ymd}-${organizationId.slice(-5).toUpperCase()}`;
}

/** Keeps only the details that belong to the method, and drops empty values (Firestore rejects undefined). */
function pickDetails(method: PaymentMethod, details: PaymentMethodDetails = {}): PaymentMethodDetails | null {
  const keys: Array<keyof PaymentMethodDetails> =
    method === "CHEQUE"
      ? ["chequeNumber", "bankName", "chequeDate"]
      : method === "UPI"
        ? ["transactionId", "upiId"]
        : method === "CARD"
          ? ["cardLast4", "cardReference"]
          : [];
  const picked: PaymentMethodDetails = {};
  for (const key of keys) {
    const value = details[key]?.trim();
    if (value) picked[key] = value;
  }
  return Object.keys(picked).length > 0 ? picked : null;
}

export function buildPaymentRecord(
  input: OrganizationPaymentInput,
  organizationId: string,
  now: Date = new Date()
): OrganizationPayment {
  const total = round2(input.totalAmount);
  const paid = round2(input.paidAmount);
  const method = paid > 0 ? (input.method ?? null) : null;

  return {
    billNumber: makeBillNumber(organizationId, now),
    billDate: Timestamp.fromDate(now),
    totalAmount: total,
    paidAmount: paid,
    pendingAmount: round2(total - paid),
    installments: input.installments,
    status: derivePaymentStatus(total, paid),
    method,
    methodDetails: method ? pickDetails(method, input.methodDetails) : null,
  };
}

// ---------------------------------------------------------------------------
// Bill rendering (email-safe HTML: tables and inline styles only)
// ---------------------------------------------------------------------------

const esc = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const inr = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(value);

const STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING_PAYMENT: "Pending payment",
  INSTALLMENTS: "Installments",
  PREPAID: "Prepaid",
};

const STATUS_STYLE: Record<PaymentStatus, { bg: string; fg: string }> = {
  PENDING_PAYMENT: { bg: "#fffbeb", fg: "#b45309" },
  INSTALLMENTS: { bg: "#eff6ff", fg: "#1d4ed8" },
  PREPAID: { bg: "#f3faf9", fg: "#0f6b65" },
};

const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: "Cash",
  CHEQUE: "Cheque",
  UPI: "UPI",
  CARD: "Card",
};

function formatBillDate(timestamp: FirebaseFirestore.Timestamp) {
  return timestamp.toDate().toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

/** Turns a YYYY-MM-DD date input into "12 Nov 2026"; anything else is shown as typed. */
function prettyDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Label/value pairs describing how the payment was made. */
function methodLines(payment: OrganizationPayment): Array<[string, string]> {
  if (!payment.method) return [["Payment method", "No payment received yet"]];
  const details = payment.methodDetails ?? {};
  const lines: Array<[string, string]> = [["Payment method", METHOD_LABEL[payment.method]]];

  if (payment.method === "CASH") {
    lines.push(["Cash received", inr(payment.paidAmount)]);
  } else if (payment.method === "CHEQUE") {
    if (details.chequeNumber) lines.push(["Cheque number", details.chequeNumber]);
    if (details.bankName) lines.push(["Bank", details.bankName]);
    if (details.chequeDate) lines.push(["Cheque date", prettyDate(details.chequeDate)]);
  } else if (payment.method === "UPI") {
    if (details.transactionId) lines.push(["Transaction ID", details.transactionId]);
    if (details.upiId) lines.push(["UPI ID", details.upiId]);
  } else if (payment.method === "CARD") {
    if (details.cardLast4) lines.push(["Card", `ending ${details.cardLast4}`]);
    if (details.cardReference) lines.push(["Reference", details.cardReference]);
  }
  return lines;
}

function installmentLine(payment: OrganizationPayment): string | null {
  if (payment.installments <= 1 && payment.status !== "INSTALLMENTS") return null;
  const each = round2(payment.totalAmount / payment.installments);
  return `${payment.installments} installment${payment.installments === 1 ? "" : "s"} of ${inr(each)}`;
}

function row(label: string, value: string, bold = false) {
  return `<tr>
    <td style="padding:6px 0;font-size:13px;color:#6b7280;">${esc(label)}</td>
    <td align="right" style="padding:6px 0;font-size:13px;color:#111827;${bold ? "font-weight:700;" : ""}">${esc(value)}</td>
  </tr>`;
}

export function renderBillHtml(recipient: BillRecipient, payment: OrganizationPayment): string {
  const status = STATUS_STYLE[payment.status];
  const installments = installmentLine(payment);

  const companyLines = [COMPANY.address, COMPANY.phone, COMPANY.email, COMPANY.website, COMPANY.taxId && `Tax ID: ${COMPANY.taxId}`]
    .filter(Boolean)
    .map((line) => `<div style="font-size:12px;color:#6b7280;line-height:1.6;">${esc(line)}</div>`)
    .join("");

  const paymentRows = methodLines(payment)
    .map(([label, value]) => row(label, value))
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bill ${esc(payment.billNumber)}</title>
<style>
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @media print { body { background: #ffffff !important; } }
</style>
</head>
<body style="margin:0;background:#f3f4f6;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">

    <!-- Header -->
    <tr><td style="background:#0a4743;padding:28px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td valign="top">
          <div style="font-size:24px;font-weight:800;letter-spacing:-0.5px;color:#ffffff;">Censor<span style="color:#32b2a9;">X</span> <span style="font-weight:600;">Technologies</span></div>
          <div style="margin-top:4px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#a7d8d3;">${esc(COMPANY.product)}</div>
        </td>
        <td valign="top" align="right">
          <div style="font-size:12px;letter-spacing:4px;text-transform:uppercase;color:#a7d8d3;">Bill</div>
          <div style="margin-top:4px;font-size:16px;font-weight:700;color:#ffffff;">${esc(payment.billNumber)}</div>
          <div style="margin-top:2px;font-size:12px;color:#a7d8d3;">${esc(formatBillDate(payment.billDate))}</div>
        </td>
      </tr></table>
    </td></tr>

    <!-- Parties -->
    <tr><td style="padding:28px 32px 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td valign="top" width="50%" style="padding-right:12px;">
          <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6b7280;">Billed to</div>
          <div style="margin-top:6px;font-size:15px;font-weight:700;color:#0b1220;">${esc(recipient.name)}</div>
          <div style="font-size:12px;color:#6b7280;line-height:1.6;">${esc(recipient.contactName)}</div>
          <div style="font-size:12px;color:#6b7280;line-height:1.6;">${esc(recipient.contactEmail)}</div>
          <div style="font-size:12px;color:#6b7280;line-height:1.6;">${esc(recipient.contactPhone)}</div>
        </td>
        <td valign="top" width="50%" style="padding-left:12px;">
          <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6b7280;">Paid to</div>
          <div style="margin-top:6px;font-size:15px;font-weight:700;color:#0b1220;">${esc(COMPANY.name)}</div>
          ${companyLines}
        </td>
      </tr></table>
    </td></tr>

    <!-- Item -->
    <tr><td style="padding:20px 32px 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;">
        <tr>
          <td style="padding:10px 0;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6b7280;">Description</td>
          <td align="right" style="padding:10px 0;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6b7280;">Amount</td>
        </tr>
        <tr>
          <td style="padding:6px 0 16px;font-size:14px;color:#111827;">${esc(COMPANY.product)} &mdash; school subscription</td>
          <td align="right" style="padding:6px 0 16px;font-size:14px;color:#111827;">${esc(inr(payment.totalAmount))}</td>
        </tr>
      </table>
    </td></tr>

    <!-- Totals -->
    <tr><td style="padding:8px 32px 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td valign="top" width="48%">
          <span style="display:inline-block;padding:5px 12px;border-radius:999px;background:${status.bg};color:${status.fg};font-size:12px;font-weight:700;">${esc(STATUS_LABEL[payment.status])}</span>
          ${installments ? `<div style="margin-top:8px;font-size:12px;color:#6b7280;">${esc(installments)}</div>` : ""}
        </td>
        <td valign="top" width="52%">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${row("Total amount", inr(payment.totalAmount))}
            ${row("Amount paid", inr(payment.paidAmount))}
            <tr><td colspan="2" style="border-top:1px solid #e5e7eb;"></td></tr>
            ${row("Balance pending", inr(payment.pendingAmount), true)}
          </table>
        </td>
      </tr></table>
    </td></tr>

    <!-- Payment details -->
    <tr><td style="padding:16px 32px 28px;">
      <div style="background:#f3faf9;border:1px solid #d7ebe8;border-radius:12px;padding:14px 18px;">
        <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#0f6b65;font-weight:700;margin-bottom:4px;">Payment details</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${paymentRows}</table>
      </div>
    </td></tr>

    <!-- Footer -->
    <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:18px 32px;text-align:center;">
      <div style="font-size:12px;color:#6b7280;">Thank you for choosing ${esc(COMPANY.name)}.</div>
      <div style="margin-top:4px;font-size:11px;color:#9ca3af;">This is a computer-generated bill. Questions? Write to ${esc(COMPANY.email)}.</div>
    </td></tr>

  </table>
</td></tr>
</table>
</body>
</html>`;
}

export function renderBillText(recipient: BillRecipient, payment: OrganizationPayment): string {
  const lines = [
    `${COMPANY.name} — Bill ${payment.billNumber}`,
    `Date: ${formatBillDate(payment.billDate)}`,
    "",
    `Billed to: ${recipient.name}`,
    `Paid to: ${COMPANY.name}`,
    "",
    `Total amount: ${inr(payment.totalAmount)}`,
    `Amount paid: ${inr(payment.paidAmount)}`,
    `Balance pending: ${inr(payment.pendingAmount)}`,
    `Status: ${STATUS_LABEL[payment.status]}`,
  ];
  const installments = installmentLine(payment);
  if (installments) lines.push(`Installments: ${installments}`);
  for (const [label, value] of methodLines(payment)) lines.push(`${label}: ${value}`);
  lines.push("", `Questions? Write to ${COMPANY.email}.`);
  return lines.join("\n");
}

/** Emails the bill to the school's contact email. Throws if the email cannot be sent. */
export async function sendBillForOrganization(recipient: BillRecipient, payment: OrganizationPayment) {
  await sendBillEmail({
    to: recipient.contactEmail,
    billNumber: payment.billNumber,
    html: renderBillHtml(recipient, payment),
    text: renderBillText(recipient, payment),
  });
}
