import fs from "node:fs";
import { Timestamp } from "firebase-admin/firestore";
import { COMPANY, companyContactFooter, planName } from "../config/company";
import { sendBillEmail, type BillEmailKind } from "./emailService";
import { ApiError } from "../middleware/errorHandler";
import { buildInvoiceModel, METHOD_LABEL, money, type BillRecipient } from "./invoiceModel";
import { logoPath, renderInvoicePdf } from "./invoicePdf";
import { findIssuedBill, firstUnpaid, installmentViews, issuedBills, paymentTransactions, resolveInstallmentAmounts } from "./paymentSchedule";
import type {
  InvoiceLineItem,
  IssuedBill,
  PaymentInstallment,
  PaymentTransaction,
  OrganizationPayment,
  PaymentMethod,
  PaymentMethodDetails,
  PaymentStatus,
} from "../models/types";
import type { OrganizationPaymentInput } from "../types/serviceInputs";

export type { BillRecipient };

const round2 = (value: number) => Math.round(value * 100) / 100;

export function derivePaymentStatus(total: number, paid: number): PaymentStatus {
  if (paid >= total) return "PREPAID";
  if (paid <= 0) return "PENDING_PAYMENT";
  return "INSTALLMENTS";
}

/**
 * CXS-YYYYMMDD-ORG5[-REF4]. The optional reference (last 4 of the batch's id) keeps two batches
 * billed on the same day apart. Legacy school-level bills had no reference.
 */
function makeBillNumber(organizationId: string, date: Date, reference?: string) {
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, "");
  const base = `CXS-${ymd}-${organizationId.slice(-5).toUpperCase()}`;
  return reference ? `${base}-${reference.slice(-4).toUpperCase()}` : base;
}

/** Keeps only the details that belong to the method, and drops empty values (Firestore rejects undefined). */
export function pickDetails(method: PaymentMethod, details: PaymentMethodDetails = {}): PaymentMethodDetails | null {
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

export interface PaymentAmounts {
  amountPerCode: number | null;
  codeCount: number | null;
  months: number | null;
  grossAmount: number;
  discountPercent: number;
  discountAmount: number;
  totalAmount: number;
}

/**
 * Works out the bill and checks it against what the portal sent, so a bill can never show a
 * calculation that does not add up:
 *   before discount = codes × amount per code per month × months   (or a typed amount)
 *   discount        = before discount × discount % (rounded to paise)
 *   total payable   = before discount − discount
 */
export function resolvePaymentAmounts(
  input: OrganizationPaymentInput,
  context?: { codeCount: number; months: number }
): PaymentAmounts {
  const discountPercent = round2(input.discountPercent ?? 0);
  let amountPerCode: number | null = null;
  let grossAmount: number;

  if (input.amountPerCode !== undefined && input.amountPerCode !== null) {
    if (!context) {
      throw new ApiError(400, "PAYMENT_PER_CODE_UNAVAILABLE", "Amount per code can only be used for a batch.");
    }
    amountPerCode = round2(input.amountPerCode);
    grossAmount = round2(amountPerCode * context.codeCount * context.months);
  } else if (input.grossAmount !== undefined && input.grossAmount !== null) {
    grossAmount = round2(input.grossAmount);
  } else if (discountPercent > 0) {
    throw new ApiError(400, "PAYMENT_GROSS_REQUIRED", "Enter the amount before discount.");
  } else {
    grossAmount = round2(input.totalAmount);
  }

  const discountAmount = round2((grossAmount * discountPercent) / 100);
  const totalAmount = round2(grossAmount - discountAmount);

  if (Math.abs(totalAmount - round2(input.totalAmount)) > 0.009) {
    const steps = amountPerCode !== null && context
      ? `${context.codeCount} codes × ${inr(amountPerCode)} × ${context.months} month${context.months === 1 ? "" : "s"} = ${inr(grossAmount)}`
      : inr(grossAmount);
    const less = discountPercent > 0 ? `, less ${discountPercent}% (${inr(discountAmount)})` : "";
    throw new ApiError(400, "PAYMENT_TOTAL_MISMATCH", `The total should be ${steps}${less} = ${inr(totalAmount)}.`);
  }
  if (!(totalAmount > 0)) {
    throw new ApiError(400, "PAYMENT_TOTAL_INVALID", "The total after discount must be more than 0.");
  }

  return {
    amountPerCode,
    codeCount: amountPerCode !== null && context ? context.codeCount : null,
    months: amountPerCode !== null && context ? context.months : null,
    grossAmount,
    discountPercent,
    discountAmount,
    totalAmount,
  };
}

export function buildPaymentRecord(
  input: OrganizationPaymentInput,
  organizationId: string,
  now: Date = new Date(),
  options: {
    reference?: string;
    description?: string;
    codeCount?: number;
    months?: number;
    invoice?: InvoiceContext;
    recordedBy?: string;
  } = {}
): OrganizationPayment {
  const amounts = resolvePaymentAmounts(
    input,
    options.codeCount !== undefined && options.months !== undefined
      ? { codeCount: options.codeCount, months: options.months }
      : undefined
  );
  const total = amounts.totalAmount;
  const paid = round2(input.paidAmount);
  if (paid > total) {
    throw new ApiError(400, "VALIDATION_ERROR", "Amount paid cannot be more than the total amount.");
  }
  const method = paid > 0 ? (input.method ?? null) : null;
  const methodDetails = method ? pickDetails(method, input.methodDetails) : null;
  const billNumber = makeBillNumber(organizationId, now, options.reference);
  const billDate = Timestamp.fromDate(now);

  // The installment plan: the admin's amounts (or equal parts), each with the due date chosen.
  // With splitBalance the amount paid now stays separate and the installments split the rest.
  const upfront = input.splitBalance && paid > 0 ? paid : 0;
  const planTotal = round2(total - upfront);
  let installmentPlan: PaymentInstallment[] | null = null;
  if (input.installmentAmounts?.length && !input.installmentDueDates?.length) {
    throw new ApiError(400, "VALIDATION_ERROR", "Give a due date for every installment.");
  }
  if (input.installmentDueDates?.length && planTotal > 0) {
    if (input.installmentDueDates.length !== input.installments) {
      throw new ApiError(400, "VALIDATION_ERROR", "Give one due date for every installment.");
    }
    let amounts: number[];
    try {
      amounts = resolveInstallmentAmounts(planTotal, input.installments, input.installmentAmounts);
    } catch (err) {
      throw new ApiError(400, (err as { code?: string }).code ?? "VALIDATION_ERROR", (err as Error).message);
    }
    installmentPlan = input.installmentDueDates.map((due, index) => {
      const date = new Date(due);
      if (Number.isNaN(date.getTime())) throw new ApiError(400, "VALIDATION_ERROR", `Installment ${index + 1} has no valid due date.`);
      return {
        number: index + 1,
        amount: amounts[index],
        dueDate: Timestamp.fromDate(date),
        upcomingNoticeAt: null,
        dueNoticeAt: null,
        overdueNoticeAt: null,
      };
    });
  }

  const transactions: PaymentTransaction[] =
    paid > 0 && method
      ? [
          {
            transactionId: "initial",
            amount: paid,
            paidAt: billDate,
            method,
            methodDetails,
            recordedBy: options.recordedBy ?? "",
            recordedAt: billDate,
            billNumber,
          },
        ]
      : [];

  return {
    billNumber,
    billDate,
    totalAmount: total,
    paidAmount: paid,
    pendingAmount: round2(total - paid),
    installments: input.installments,
    upfrontAmount: upfront > 0 ? upfront : null,
    status: derivePaymentStatus(total, paid),
    method,
    methodDetails,
    installmentPlan,
    transactions,
    bills: [
      {
        billNumber,
        issuedAt: billDate,
        kind: "INVOICE",
        transactionId: transactions[0]?.transactionId ?? null,
        paidToDate: paid,
        balance: round2(total - paid),
        totalAtBill: total,
        note: null,
      },
    ],
    description: options.description ?? null,
    amountPerCode: amounts.amountPerCode,
    codeCount: amounts.codeCount,
    months: amounts.months,
    grossAmount: amounts.grossAmount,
    discountPercent: amounts.discountPercent,
    discountAmount: amounts.discountAmount,
    lineItems: options.invoice ? buildLineItems(amounts, options.invoice) : null,
    batchLabel: options.invoice?.batchLabel ?? null,
    serviceStartAt: options.invoice ? Timestamp.fromDate(options.invoice.startAt) : null,
    serviceEndAt: options.invoice ? Timestamp.fromDate(options.invoice.expiresAt) : null,
    billKind: options.invoice?.kind ?? null,
    classesCovered: options.invoice?.classes ?? null,
  };
}

// ---------------------------------------------------------------------------
// Invoice line items
// ---------------------------------------------------------------------------

export interface InvoiceContext {
  kind: "NEW" | "RENEWAL";
  batchLabel: string;
  startAt: Date;
  expiresAt: Date;
  classes: Array<{ name: string; codes: number | null }>;
}

/**
 * The invoice lines for a batch bill:
 *   - priced per code, new batch: one line per class (codes × rate × months);
 *   - priced per code, renewal:   one line for the batch's codes;
 *   - typed amount:               one subscription line for the whole amount.
 * Line amounts always add up to the amount before discount.
 */
function buildLineItems(amounts: PaymentAmounts, invoice: InvoiceContext): InvoiceLineItem[] {
  const period = `${invoice.batchLabel} · ${invoice.kind === "RENEWAL" ? "renewal" : "student activation codes"}`;

  if (amounts.amountPerCode !== null && amounts.months !== null && amounts.codeCount !== null) {
    const perClass = invoice.kind === "NEW" && invoice.classes.length > 0 && invoice.classes.every((item) => item.codes !== null);
    const classTotal = invoice.classes.reduce((sum, item) => sum + (item.codes ?? 0), 0);
    if (perClass && classTotal === amounts.codeCount) {
      return invoice.classes.map((item) => ({
        item: item.name,
        detail: period,
        quantity: item.codes ?? 0,
        unit: "codes",
        rate: amounts.amountPerCode!,
        months: amounts.months,
        amount: round2(amounts.amountPerCode! * (item.codes ?? 0) * amounts.months!),
      }));
    }
    return [
      {
        item: `${COMPANY.product} — ${invoice.kind === "RENEWAL" ? "subscription renewal" : "subscription"}`,
        detail: period,
        quantity: amounts.codeCount,
        unit: "codes",
        rate: amounts.amountPerCode,
        months: amounts.months,
        amount: amounts.grossAmount,
      },
    ];
  }

  return [
    {
      item: `${COMPANY.product} — ${invoice.kind === "RENEWAL" ? "subscription renewal" : "subscription"}`,
      detail: period,
      quantity: 1,
      unit: "item",
      rate: amounts.grossAmount,
      months: null,
      amount: amounts.grossAmount,
    },
  ];
}

// ---------------------------------------------------------------------------
// Rendering: HTML (portal view + email body), plain text, PDF
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

const STATUS_STYLE: Record<PaymentStatus, { bg: string; fg: string }> = {
  PENDING_PAYMENT: { bg: "#fffbeb", fg: "#b45309" },
  INSTALLMENTS: { bg: "#eff6ff", fg: "#1d4ed8" },
  PREPAID: { bg: "#f3faf9", fg: "#0f6b65" },
};

/** The logo as a data URI, for the portal's bill viewer. Email uses an attached image instead. */
function logoDataUri(): string | null {
  const file = logoPath();
  if (!file) return null;
  try {
    return `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
  } catch {
    return null;
  }
}


function totalRow(label: string, value: string, strong = false) {
  return `<tr>
    <td style="padding:5px 0;font-size:13px;color:${strong ? "#111827" : "#6b7280"};${strong ? "font-weight:700;" : ""}">${esc(label)}</td>
    <td align="right" style="padding:5px 0;font-size:13px;color:#111827;${strong ? "font-weight:700;" : ""}">${esc(value)}</td>
  </tr>`;
}

function rule() {
  return `<tr><td colspan="2" style="border-top:1px solid #e5e7eb;font-size:0;line-height:0;">&nbsp;</td></tr>`;
}

/**
 * The invoice as email-safe HTML (tables and inline styles only). `logoSrc` is a data URI in the
 * portal and "cid:…" in email, where the logo is attached.
 */
export function renderBillHtml(
  recipient: BillRecipient,
  payment: OrganizationPayment,
  options: { logoSrc?: string | null; billNumber?: string | null } = {}
): string {
  const model = buildInvoiceModel(recipient, payment, options.billNumber);
  const smallHead = (label: string, align: "left" | "right" = "left") =>
    `<th align="${align}" style="padding:6px 8px;font-size:9px;letter-spacing:1px;text-transform:uppercase;color:#6b7280;font-weight:700;border-bottom:1px solid #e5e7eb;">${esc(label)}</th>`;
  const smallCell = (value: string, align: "left" | "right" = "left", strong = false) =>
    `<td align="${align}" style="padding:6px 8px;font-size:12px;color:#111827;border-bottom:1px solid #f1f5f9;${strong ? "font-weight:700;" : ""}">${esc(value)}</td>`;
  const scheduleStyle: Record<string, string> = { Paid: "#0f6b65", Overdue: "#b91c1c", Due: "#b45309" };
  const scheduleBlock = model.schedule.length
    ? `<tr><td style="padding:12px 32px 2px;">
        <div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#6b7280;font-weight:700;margin-bottom:4px;">Installment schedule</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>${smallHead("#")}${smallHead("Due date")}${smallHead("Amount", "right")}${smallHead("Status", "right")}</tr>
          ${model.schedule
            .map(
              (row) => `<tr>${smallCell(String(row.number))}${smallCell(row.dueDate)}${smallCell(inr(row.amount), "right")}<td align="right" style="padding:6px 8px;font-size:12px;font-weight:700;color:${
                scheduleStyle[row.status] ?? "#374151"
              };border-bottom:1px solid #f1f5f9;">${esc(row.status)}</td></tr>`
            )
            .join("")}
        </table>
      </td></tr>`
    : "";
  const historyBlock = model.history.length
    ? `<tr><td style="padding:12px 32px 2px;">
        <div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#6b7280;font-weight:700;margin-bottom:4px;">Payments received</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>${smallHead("Date")}${smallHead("Method")}${smallHead("Bill")}${smallHead("Amount", "right")}</tr>
          ${model.history
            .map((row) => `<tr>${smallCell(row.date)}${smallCell(row.method)}${smallCell(row.billNumber)}${smallCell(inr(row.amount), "right", true)}</tr>`)
            .join("")}
        </table>
      </td></tr>`
    : "";
  const revisionBlock = model.revision
    ? `<tr><td style="padding:14px 32px 0;"><div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:10px 14px;font-size:12px;color:#1e3a8a;">${esc(
        model.revision.note
      )}</div></td></tr>`
    : "";
  const status = STATUS_STYLE[model.status];
  const logoSrc = options.logoSrc === undefined ? logoDataUri() : options.logoSrc;
  const th = (label: string, align: "left" | "right" = "left") =>
    `<th align="${align}" style="padding:9px 10px;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#ffffff;font-weight:700;">${esc(label)}</th>`;

  const itemRows = model.items
    .map(
      (line, index) => `<tr style="background:${index % 2 ? "#fafafa" : "#ffffff"};">
        <td valign="top" style="padding:10px;font-size:12px;color:#6b7280;border-bottom:1px solid #e5e7eb;">${index + 1}</td>
        <td valign="top" style="padding:10px;border-bottom:1px solid #e5e7eb;">
          <div style="font-size:13px;font-weight:700;color:#111827;">${esc(line.item)}</div>
          ${line.detail ? `<div style="margin-top:2px;font-size:11px;color:#6b7280;">${esc(line.detail)}</div>` : ""}
        </td>
        <td valign="top" align="right" style="padding:10px;font-size:12px;color:#111827;border-bottom:1px solid #e5e7eb;white-space:nowrap;">${esc(
          line.unit === "codes" ? `${line.quantity} codes` : String(line.quantity)
        )}</td>
        <td valign="top" align="right" style="padding:10px;font-size:12px;color:#111827;border-bottom:1px solid #e5e7eb;white-space:nowrap;">${esc(money(line.rate))}</td>
        ${
          model.showMonths
            ? `<td valign="top" align="right" style="padding:10px;font-size:12px;color:#111827;border-bottom:1px solid #e5e7eb;">${esc(
                line.months !== null ? String(line.months) : "—"
              )}</td>`
            : ""
        }
        <td valign="top" align="right" style="padding:10px;font-size:12px;font-weight:700;color:#111827;border-bottom:1px solid #e5e7eb;white-space:nowrap;">${esc(
          money(line.amount)
        )}</td>
      </tr>`
    )
    .join("");

  const facts = model.facts
    .map(
      ([label, value]) => `<td valign="top" style="padding:10px 12px;">
        <div style="font-size:9px;letter-spacing:1px;text-transform:uppercase;color:#0f6b65;font-weight:700;">${esc(label)}</div>
        <div style="margin-top:3px;font-size:12px;color:#111827;">${esc(value)}</div>
      </td>`
    )
    .join("");

  const partyLines = (lines: string[]) =>
    lines.map((line) => `<div style="font-size:12px;color:#6b7280;line-height:1.6;">${esc(line)}</div>`).join("");

  const classes = model.classes.length
    ? `<tr><td style="padding:4px 32px 0;">
        <div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#6b7280;font-weight:700;">Classes covered</div>
        <div style="margin-top:3px;font-size:12px;color:#111827;">${esc(
          model.classes.map((item) => (item.codes !== null ? `${item.name} (${item.codes} codes)` : item.name)).join(", ")
        )}</div>
      </td></tr>`
    : "";

  const paymentRows = model.paymentLines
    .map(
      ([label, value]) => `<tr>
        <td style="padding:3px 0;font-size:12px;color:#6b7280;width:45%;">${esc(label)}</td>
        <td style="padding:3px 0;font-size:12px;color:#111827;">${esc(value)}</td>
      </tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invoice ${esc(model.number)}</title>
<style>
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @media print { body { background: #ffffff !important; } .sheet { border: none !important; } }
</style>
</head>
<body style="margin:0;background:#f3f4f6;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" class="sheet" width="680" cellpadding="0" cellspacing="0" style="width:100%;max-width:680px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">

    <!-- Header -->
    <tr><td style="background:#0a4743;padding:24px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td valign="middle">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            ${
              logoSrc
                ? `<td valign="middle" style="padding-right:14px;"><div style="background:#041514;border-radius:12px;padding:6px;width:44px;height:44px;"><img src="${logoSrc}" width="44" height="44" alt="CensorX" style="display:block;width:44px;height:44px;"></div></td>`
                : ""
            }
            <td valign="middle">
              <div style="font-size:21px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;">${esc(model.supplier.name)}</div>
              <div style="margin-top:3px;font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:#a7d8d3;">${esc(COMPANY.product)}</div>
            </td>
          </tr></table>
        </td>
        <td valign="middle" align="right">
          <div style="font-size:22px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:#ffffff;">${esc(model.title)}</div>
          <div style="margin-top:4px;font-size:12px;color:#a7d8d3;">No. ${esc(model.number)}</div>
          <div style="font-size:12px;color:#a7d8d3;">Date: ${esc(model.date)}</div>
        </td>
      </tr></table>
    </td></tr>

    ${revisionBlock}

    <!-- Parties -->
    <tr><td style="padding:24px 32px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td valign="top" width="50%" style="padding-right:12px;">
          <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#6b7280;font-weight:700;">Billed by</div>
          <div style="margin-top:6px;font-size:14px;font-weight:700;color:#0b1220;">${esc(model.supplier.name)}</div>
          ${partyLines(model.supplier.lines)}
        </td>
        <td valign="top" width="50%" style="padding-left:12px;">
          <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#6b7280;font-weight:700;">Billed to</div>
          <div style="margin-top:6px;font-size:14px;font-weight:700;color:#0b1220;">${esc(model.recipient.name)}</div>
          ${partyLines(model.recipient.lines)}
        </td>
      </tr></table>
    </td></tr>

    ${
      facts
        ? `<tr><td style="padding:4px 32px 12px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3faf9;border-radius:10px;"><tr>${facts}</tr></table></td></tr>`
        : ""
    }

    <!-- Items -->
    <tr><td style="padding:8px 32px 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr style="background:#0f6b65;">
          ${th("#")}${th("Item")}${th("Qty", "right")}${th(model.showMonths ? "Rate / code / month" : "Rate", "right")}${
            model.showMonths ? th("Months", "right") : ""
          }${th("Amount", "right")}
        </tr>
        ${itemRows}
      </table>
    </td></tr>

    ${classes}

    <!-- Totals -->
    <tr><td style="padding:12px 32px 4px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td valign="top" width="45%">
          <span style="display:inline-block;padding:5px 12px;border-radius:999px;background:${status.bg};color:${status.fg};font-size:12px;font-weight:700;">${esc(model.statusLabel)}</span>
        </td>
        <td valign="top" width="55%">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${totalRow("Subtotal", inr(model.subtotal))}
            ${model.discount > 0 ? totalRow(model.discountLabel, `− ${inr(model.discount)}`) : ""}
            ${rule()}
            ${totalRow("Total amount", inr(model.total), true)}
            ${totalRow("Amount paid", inr(model.paid))}
            ${rule()}
            ${totalRow("Balance due", inr(model.pending), true)}
          </table>
        </td>
      </tr></table>
    </td></tr>

    <!-- Amount in words -->
    <tr><td style="padding:10px 32px 4px;">
      <div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#6b7280;font-weight:700;">Amount in words</div>
      <div style="margin-top:3px;font-size:12px;font-style:italic;color:#111827;">${esc(model.amountInWords)}</div>
    </td></tr>

    ${scheduleBlock}
    ${historyBlock}

    <!-- Payment details -->
    <tr><td style="padding:14px 32px 6px;">
      <div style="background:#f3faf9;border:1px solid #d7ebe8;border-radius:10px;padding:12px 16px;">
        <div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#0f6b65;font-weight:700;margin-bottom:4px;">Payment details</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${paymentRows}</table>
      </div>
    </td></tr>

    <!-- Terms -->
    <tr><td style="padding:16px 32px 20px;">
      <div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#6b7280;font-weight:700;">Terms</div>
      ${model.terms.map((term) => `<div style="margin-top:4px;font-size:11px;color:#374151;line-height:1.5;">• ${esc(term)}</div>`).join("")}
    </td></tr>

    <!-- Footer -->
    <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:14px 32px;text-align:center;">
      <div style="font-size:11px;color:#6b7280;">${esc(model.footer)}</div>
      <div style="margin-top:3px;font-size:11px;color:#9ca3af;">Questions? ${esc(companyContactFooter())}</div>
    </td></tr>

  </table>
</td></tr>
</table>
</body>
</html>`;
}

export function renderBillText(recipient: BillRecipient, payment: OrganizationPayment, billNumber?: string | null): string {
  const model = buildInvoiceModel(recipient, payment, billNumber);
  const lines = [
    `${model.supplier.name} — Invoice ${model.number}`,
    `Date: ${model.date}`,
    ...(model.revision ? [model.revision.note] : []),
    "",
    `Billed by: ${model.supplier.name}`,
    ...model.supplier.lines.map((line) => `  ${line}`),
    `Billed to: ${model.recipient.name}`,
    ...model.recipient.lines.map((line) => `  ${line}`),
    "",
    ...model.facts.map(([label, value]) => `${label}: ${value}`),
    "",
    "Items:",
    ...model.items.map(
      (line, index) =>
        `  ${index + 1}. ${line.item}${line.detail ? ` (${line.detail})` : ""} — ${
          line.unit === "codes" ? `${line.quantity} codes` : line.quantity
        } × ${inr(line.rate)}${line.months !== null ? ` per code per month × ${line.months} month${line.months === 1 ? "" : "s"}` : ""} = ${inr(
          line.amount
        )}`
    ),
    ...(model.classes.length
      ? [`Classes covered: ${model.classes.map((item) => (item.codes !== null ? `${item.name} (${item.codes} codes)` : item.name)).join(", ")}`]
      : []),
    "",
    `Subtotal: ${inr(model.subtotal)}`,
    ...(model.discount > 0 ? [`${model.discountLabel}: − ${inr(model.discount)}`] : []),
    `Total amount: ${inr(model.total)}`,
    `Amount paid: ${inr(model.paid)}`,
    `Balance due: ${inr(model.pending)}`,
    `Amount in words: ${model.amountInWords}`,
    `Status: ${model.statusLabel}`,
    ...(model.schedule.length
      ? ["", "Installment schedule:", ...model.schedule.map((row) => `  ${row.number}. ${row.dueDate} — ${inr(row.amount)} — ${row.status}`)]
      : []),
    ...(model.history.length
      ? ["", "Payments received:", ...model.history.map((row) => `  ${row.date} — ${inr(row.amount)} by ${row.method} (bill ${row.billNumber})`)]
      : []),
    "",
    ...model.paymentLines.map(([label, value]) => `${label}: ${value}`),
    "",
    ...model.terms.map((term) => `- ${term}`),
    "",
    "The invoice is attached as a PDF.",
    model.footer,
  ];
  return lines.join("\n");
}

/** The invoice (or a later bill of the series, by number) as a PDF file. */
export async function renderBillPdf(recipient: BillRecipient, payment: OrganizationPayment, billNumber?: string | null): Promise<Buffer> {
  return renderInvoicePdf(buildInvoiceModel(recipient, payment, billNumber));
}

export function billPdfFilename(payment: OrganizationPayment, billNumber?: string | null) {
  return `Invoice-${(billNumber || payment.billNumber).replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`;
}

function tsToDate(value: unknown): Date | null {
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") return (value as FirebaseFirestore.Timestamp).toDate();
  return null;
}

/** Which letter goes with a bill of the series. */
function billEmailKind(payment: OrganizationPayment, bill: IssuedBill, isFirst: boolean): BillEmailKind {
  if (bill.kind === "INVOICE" || isFirst) return payment.billKind === "RENEWAL" ? "RENEWAL_INVOICE" : "INVOICE";
  if (bill.kind === "PAYMENT") return "PAYMENT";
  if (bill.reason === "SCHEDULE_CHANGE") return "SCHEDULE_CHANGE";
  if (bill.kind === "ADJUSTMENT") return "EXTRA_CODES";
  return "UPDATED";
}

const STATUS_WORD: Record<string, string> = { PAID: "Paid", PART_PAID: "Part paid", UPCOMING: "Upcoming", DUE: "Due", OVERDUE: "Overdue" };

/** The reference a school would recognise for a payment: UPI transaction ID, cheque number or card reference. */
function paymentReference(details: OrganizationPayment["methodDetails"]): string | null {
  if (!details) return null;
  return details.transactionId || details.chequeNumber || details.cardReference || null;
}

/**
 * Emails a bill to the school's contact email: a short letter in the shared CensorX for Schools
 * layout, with the invoice attached as a PDF. Sends the first invoice unless a later bill's
 * number is given. Throws if it cannot be sent.
 */
export async function sendBillForOrganization(recipient: BillRecipient, payment: OrganizationPayment, billNumber?: string | null) {
  const bills = issuedBills(payment);
  const bill = findIssuedBill(payment, billNumber) ?? bills[0];
  const number = bill.billNumber;
  const kind = billEmailKind(payment, bill, bills[0].billNumber === number);
  const billDate = tsToDate(bill.issuedAt) ?? new Date();

  const transactions = paymentTransactions(payment);
  const thisPayment = bill.kind === "PAYMENT" ? transactions.find((txn) => txn.transactionId === bill.transactionId) ?? null : null;
  // Extra codes paid on the spot carry their payment on the same bill.
  const billTxn = bill.kind === "ADJUSTMENT" && bill.transactionId ? transactions.find((txn) => txn.transactionId === bill.transactionId) ?? null : null;
  const firstPayment = transactions[0] ?? null;

  // The installments shown on this bill: those added on it or before it.
  const order = new Map(bills.map((item, index) => [item.billNumber, index]));
  const billIndex = order.get(number) ?? 0;
  const plan = (payment.installmentPlan ?? []).filter((item) => !item.addedOnBill || (order.get(item.addedOnBill) ?? Infinity) <= billIndex);
  const views = installmentViews(
    { installmentPlan: plan, paidAmount: bill.paidToDate, upfrontAmount: payment.upfrontAmount },
    { asOf: billDate, paidToDate: bill.paidToDate }
  );
  const next = firstUnpaid(views);
  const added = bill.kind === "ADJUSTMENT" ? plan.filter((item) => item.addedOnBill === number) : [];

  const pdf = await renderBillPdf(recipient, payment, number);
  await sendBillEmail({
    to: recipient.contactEmail,
    schoolName: recipient.name,
    contactName: recipient.contactName,
    planName: planName(null, payment.months),
    batchLabel: payment.batchLabel ?? null,
    kind,
    billNumber: number,
    serviceStartAt: tsToDate(payment.serviceStartAt),
    serviceEndAt: tsToDate(payment.serviceEndAt),
    codeCount: payment.codeCount ?? null,
    total: bill.totalAtBill ?? payment.totalAmount,
    paid: bill.paidToDate,
    balance: bill.balance,
    paymentMode: firstPayment ? METHOD_LABEL[firstPayment.method] : payment.method ? METHOD_LABEL[payment.method] : null,
    payment: thisPayment
      ? {
          amount: thisPayment.amount,
          date: tsToDate(thisPayment.paidAt) ?? billDate,
          mode: METHOD_LABEL[thisPayment.method],
          reference: paymentReference(thisPayment.methodDetails),
        }
      : null,
    change:
      kind === "EXTRA_CODES"
        ? {
            note: bill.note ?? "Items were added to your order",
            amount:
              (payment.lineItems ?? []).filter((line) => line.addedOnBill === number).reduce((sum, line) => sum + line.amount, 0) ||
              added.reduce((sum, item) => sum + item.amount, 0) ||
              null,
            dueDate: added[0] ? tsToDate(added[0].dueDate) : null,
            paid: billTxn
              ? { mode: METHOD_LABEL[billTxn.method], reference: paymentReference(billTxn.methodDetails) }
              : null,
          }
        : null,
    schedule: views.map((item) => ({ number: item.number, amount: item.amount, dueDate: item.dueDate, status: STATUS_WORD[item.status] ?? item.status })),
    nextInstallment: next ? { amount: next.remaining, dueDate: next.dueDate } : null,
    attachments: [{ filename: billPdfFilename(payment, number), content: pdf, contentType: "application/pdf" }],
  });
}
