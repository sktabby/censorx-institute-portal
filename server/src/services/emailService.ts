import nodemailer from "nodemailer";
import { env } from "../config/env";
import { COMPANY } from "../config/company";
import { ApiError } from "../middleware/errorHandler";
import { LOGO_CID, renderEmailHtml, renderEmailText, type EmailBlock, type EmailContent } from "./emailLayout";
import { logoPath } from "./invoicePdf";

/**
 * Every email sent to a school. All of them use the same CensorX for Schools layout
 * (emailLayout.ts): the same header and logo as the invoice, the same sections and signature,
 * and a subject of the form "CensorX for Schools — <what> | <school>".
 */

function formatDate(date: Date) {
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

/** 29160 → "₹29,160.00". */
function rupees(value: number) {
  return `₹${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** "all 34 students", "the 1 student", or "all students" when the count is not known. */
function allStudents(count: number | null | undefined) {
  if (count === null || count === undefined || count === 0) return "all students";
  return count === 1 ? "the 1 student" : `all ${count} students`;
}

function dear(contactName: string | null | undefined, schoolName: string) {
  return contactName?.trim() ? `Dear ${contactName.trim()},` : `Dear ${schoolName} Team,`;
}

function subject(what: string, schoolName: string) {
  return `${COMPANY.product} — ${what} | ${schoolName}`;
}

/** "Yearly (Batch 2)". */
function planLabel(plan: PlanRef) {
  return plan.batchLabel ? `${plan.planName} (${plan.batchLabel})` : plan.planName;
}

/** "Sunrise Public School's Yearly subscription (Batch 2)". */
function subscriptionOf(schoolName: string, plan: PlanRef) {
  return `${schoolName}'s ${plan.planName} subscription${plan.batchLabel ? ` (${plan.batchLabel})` : ""}`;
}

function portal(path?: string) {
  return `${COMPANY.portalUrl}${path ? ` (${path})` : ""}`;
}

function classList(classNames: string[]) {
  return classNames.length ? classNames.join(", ") : null;
}

function contactRows(): Array<[string, string]> {
  return [
    ["Email", COMPANY.email],
    ["WhatsApp", COMPANY.whatsapp.join(" | ")],
  ];
}

function accountSummary(input: { invoiceNumber?: string; total: number; paid: number; balance: number; next?: NextInstallment | null }, title = "Account summary"): EmailBlock {
  return {
    kind: "facts",
    title,
    rows: [
      ["Invoice no.", input.invoiceNumber],
      ["Total amount", rupees(input.total)],
      ["Paid to date", rupees(input.paid)],
      [input.invoiceNumber ? "Balance due" : "Total balance", rupees(input.balance)],
      ["Next installment", input.next ? `${rupees(input.next.amount)} due on ${formatDate(input.next.dueDate)}` : null],
    ],
  };
}

function assertSmtpConfigured() {
  if (!env.SMTP_HOST || !env.SMTP_PORT || !env.SMTP_USER || !env.SMTP_PASSWORD || !env.SMTP_FROM_EMAIL) {
    throw new ApiError(
      503,
      "SMTP_NOT_CONFIGURED",
      "SMTP email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM_EMAIL."
    );
  }
}

function createTransporter() {
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASSWORD,
    },
  });
}

export interface MailAttachment {
  filename: string;
  content?: Buffer;
  path?: string;
  contentType?: string;
  /** Set for images shown inside the HTML body (src="cid:…"). */
  cid?: string;
}

/** Sends one email in the shared layout: HTML with the logo inline, plus the same text as plain text. */
async function sendSchoolEmail(input: {
  to: string;
  subject: string;
  content: EmailContent;
  attachments?: MailAttachment[];
  headers?: Record<string, string>;
}) {
  assertSmtpConfigured();
  const logo = logoPath();
  const mail = {
    from: env.SMTP_FROM_EMAIL,
    to: input.to,
    subject: input.subject,
    text: renderEmailText(input.content),
    html: renderEmailHtml(input.content, logo ? `cid:${LOGO_CID}` : null),
    ...(input.headers ? { headers: input.headers } : {}),
    attachments: [
      ...(input.attachments ?? []),
      ...(logo ? [{ filename: "censorx-logo.png", path: logo, cid: LOGO_CID, contentType: "image/png" }] : []),
    ],
  };

  // A mail server under load (many emails in a row, e.g. the nightly reminders or codes for
  // several classes) may drop the connection or ask us to try later. Retry those a few times.
  for (let attempt = 1; ; attempt++) {
    try {
      await createTransporter().sendMail(mail);
      return;
    } catch (err) {
      if (attempt >= SEND_ATTEMPTS || !isTemporaryMailError(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, attempt * 4000));
    }
  }
}

const SEND_ATTEMPTS = 3;

/** Connection drops and 4xx "try again later" replies; not wrong passwords or rejected addresses. */
function isTemporaryMailError(err: unknown) {
  const { code, responseCode } = (err ?? {}) as { code?: string; responseCode?: number };
  if (code === "EAUTH" || code === "EENVELOPE") return false;
  if (responseCode && responseCode >= 400 && responseCode < 500) return true;
  return ["ESOCKET", "ECONNECTION", "ETIMEDOUT", "ECONNRESET", "EDNS"].includes(code ?? "");
}

export interface PlanRef {
  /** From the plan duration: "Monthly", "3-month", "6-month", "Yearly". */
  planName: string;
  /** "Batch 2". Null only for an old school-level bill. */
  batchLabel: string | null;
}

export interface NextInstallment {
  amount: number;
  dueDate: Date;
}

// ---------------------------------------------------------------------------
// 1. Welcome
// ---------------------------------------------------------------------------

export async function sendSchoolAdminWelcomeEmail(input: { to: string; schoolName: string; tempPassword: string }) {
  await sendSchoolEmail({
    to: input.to,
    subject: subject("Your school portal login", input.schoolName),
    content: {
      heading: "Welcome to CensorX for Schools",
      greeting: `Dear ${input.schoolName} Team,`,
      blocks: [
        { kind: "p", text: "Welcome to CensorX for Schools. Your school's account has been created, and you can now sign in to your school portal." },
        {
          kind: "facts",
          title: "Your login details",
          rows: [
            ["Portal", COMPANY.portalUrl],
            ["Login email", input.to],
            ["Temporary password", input.tempPassword],
          ],
        },
        {
          kind: "steps",
          title: "To keep your account secure",
          items: ["Sign in using the details above.", "Set a new password when prompted.", "Do not share these details with anyone."],
        },
        {
          kind: "p",
          text: "Once you're signed in, you can manage your subscriptions, download the activation codes for your classes, and view your bills and notifications.",
        },
        { kind: "p", text: `If you didn't expect this email or need help, contact us at ${COMPANY.email}.` },
      ],
    },
  });
}

// ---------------------------------------------------------------------------
// 2. New batch set up
// ---------------------------------------------------------------------------

export interface BatchEmailClass {
  batchName: string;
  seatCount: number;
}

/**
 * Sent when a new batch is created: its classes, codes per class and dates. The codes
 * themselves arrive later, one email per class, once they are generated.
 */
export async function sendBatchCreatedEmail(input: {
  to: string;
  schoolName: string;
  planName: string;
  batchLabel: string;
  classes: BatchEmailClass[];
  startAt: Date;
  expiresAt: Date;
  totalSeats: number;
}) {
  const plan = { planName: input.planName, batchLabel: input.batchLabel };
  await sendSchoolEmail({
    to: input.to,
    subject: subject(`New subscription set up: ${planLabel(plan)}`, input.schoolName),
    content: {
      heading: "Your new subscription is set up",
      greeting: `Dear ${input.schoolName} Team,`,
      blocks: [
        { kind: "p", text: "Your new subscription is now set up. The details are below." },
        {
          kind: "facts",
          title: "Subscription summary",
          rows: [
            ["Plan", planLabel(plan)],
            ["Valid from", formatDate(input.startAt)],
            ["Valid until", formatDate(input.expiresAt)],
            ["Total codes", String(input.totalSeats)],
          ],
        },
        {
          kind: "bullets",
          title: "Classes and activation codes",
          items: input.classes.map((item) => `${item.batchName}: ${plural(item.seatCount, "code")}`),
        },
        {
          kind: "steps",
          title: "What happens next",
          items: [
            "Activation codes: we will email the codes for each class separately as soon as they are generated.",
            `Portal access: you can also download the codes at any time from the school portal at ${portal("Subscription → Download Codes")}.`,
            "Distribution: give each student one code. The parent enters it in the CensorX app on the child's device to activate protection under your school's plan.",
            "Billing: any invoice for this subscription will be sent in a separate email.",
          ],
        },
        {
          kind: "bullets",
          title: "Please note",
          items: [
            "Each code can be used only once and on only one device.",
            `All codes in this batch stop working on ${formatDate(input.expiresAt)}. We will remind you before then so you can renew.`,
            "Keep the codes confidential and share them only with the intended students or parents.",
          ],
        },
        { kind: "p", text: `If you have questions or need more codes, reply to this email or write to ${COMPANY.email}.` },
      ],
    },
  });
}

// ---------------------------------------------------------------------------
// 3, 5, 6 and the schedule change: bills
// ---------------------------------------------------------------------------

export type BillEmailKind = "INVOICE" | "RENEWAL_INVOICE" | "PAYMENT" | "EXTRA_CODES" | "SCHEDULE_CHANGE" | "UPDATED";

export interface BillEmailInput extends PlanRef {
  to: string;
  schoolName: string;
  contactName?: string | null;
  kind: BillEmailKind;
  /** The number of this bill (the attached PDF). */
  billNumber: string;
  serviceStartAt?: Date | null;
  serviceEndAt?: Date | null;
  codeCount?: number | null;
  /** Totals as of this bill. */
  total: number;
  paid: number;
  balance: number;
  /** How the amount paid so far was paid, e.g. "UPI" (first invoice). */
  paymentMode?: string | null;
  /** The payment this bill was issued for (kind PAYMENT). */
  payment?: { amount: number; date: Date; mode: string; reference?: string | null } | null;
  /** What was added (kind EXTRA_CODES). */
  change?: { note: string; amount?: number | null; dueDate?: Date | null; paid?: { mode: string; reference?: string | null } | null } | null;
  /** The installment plan as it now stands (kind SCHEDULE_CHANGE). */
  schedule?: Array<{ number: number; amount: number; dueDate: Date; status: string }>;
  nextInstallment?: NextInstallment | null;
  attachments?: MailAttachment[];
}

function billEmailContent(input: BillEmailInput): { subject: string; content: EmailContent } {
  const plan: PlanRef = { planName: input.planName, batchLabel: input.batchLabel };
  const sub = subscriptionOf(input.schoolName, plan);
  const greeting = dear(input.contactName, input.schoolName);
  const summary = accountSummary({
    invoiceNumber: input.billNumber,
    total: input.total,
    paid: input.paid,
    balance: input.balance,
    next: input.balance > 0 ? input.nextInstallment : null,
  });
  const bills = `${COMPANY.portalUrl} (Subscription → Bills)`;
  const quote: EmailBlock = {
    kind: "p",
    text: `For any questions, reply to this email or write to ${COMPANY.email}, quoting invoice ${input.billNumber}.`,
  };
  const replaces = "It replaces any earlier copies of this invoice.";

  if (input.kind === "INVOICE" || input.kind === "RENEWAL_INVOICE") {
    const renewal = input.kind === "RENEWAL_INVOICE";
    return {
      subject: subject(`Invoice ${input.billNumber} — ${planLabel(plan)}`, input.schoolName),
      content: {
        heading: `Invoice ${input.billNumber}`,
        greeting,
        blocks: [
          {
            kind: "p",
            text: renewal
              ? `Thank you for renewing with CensorX for Schools. ${sub} has been renewed.`
              : `Thank you for subscribing to CensorX for Schools. ${sub} is now active.`,
          },
          {
            kind: "facts",
            title: "Subscription",
            rows: [
              ["Plan", planLabel(plan)],
              [
                "Service period",
                input.serviceStartAt && input.serviceEndAt ? `${formatDate(input.serviceStartAt)} – ${formatDate(input.serviceEndAt)}` : null,
              ],
              ["Activation codes", input.codeCount ? String(input.codeCount) : null],
            ],
          },
          {
            kind: "facts",
            title: "Payment summary",
            rows: [
              ["Invoice no.", input.billNumber],
              ["Total amount", rupees(input.total)],
              ["Amount paid", `${rupees(input.paid)}${input.paid > 0 && input.paymentMode ? ` (${input.paymentMode})` : ""}`],
              ["Balance due", rupees(input.balance)],
              [
                "Next installment",
                input.balance > 0 && input.nextInstallment
                  ? `${rupees(input.nextInstallment.amount)} due on ${formatDate(input.nextInstallment.dueDate)}`
                  : null,
              ],
            ],
          },
          {
            kind: "p",
            text: `Your invoice, including the itemised charges and installment schedule, is attached as a PDF. You can also view it any time in the school portal at ${bills}.`,
          },
          { kind: "p", text: `Please quote invoice number ${input.billNumber} with any payment or billing question.` },
        ],
      },
    };
  }

  if (input.kind === "PAYMENT" && input.payment) {
    const mode = `${input.payment.mode}${input.payment.reference ? ` (Ref: ${input.payment.reference})` : ""}`;
    return {
      subject: subject(`Payment received — updated invoice ${input.billNumber}`, input.schoolName),
      content: {
        heading: "Payment received — thank you",
        greeting,
        blocks: [
          { kind: "p", text: `Thank you. We have received your payment for ${sub}.` },
          {
            kind: "facts",
            title: "Payment received",
            rows: [
              ["Amount", rupees(input.payment.amount)],
              ["Date", formatDate(input.payment.date)],
              ["Mode", mode],
            ],
          },
          summary,
          ...(input.balance <= 0 ? [{ kind: "p", text: "Your invoice is now fully paid. Thank you!" } as EmailBlock] : []),
          {
            kind: "p",
            text: `The updated invoice, with the full payment history and installment schedule, is attached as a PDF. ${replaces} You can also view it in the school portal at ${bills}.`,
          },
          quote,
        ],
      },
    };
  }

  if (input.kind === "EXTRA_CODES" && input.change) {
    return {
      subject: subject(`Updated invoice ${input.billNumber} — codes added`, input.schoolName),
      content: {
        heading: "Your invoice has been updated",
        greeting,
        blocks: [
          {
            kind: "p",
            text: input.change.paid
              ? `Thank you. Activation codes were added to ${sub}, and we have received your payment for them.`
              : `The invoice for ${sub} has been updated because activation codes were added to it.`,
          },
          {
            kind: "facts",
            title: "What changed",
            rows: [
              ["Change", input.change.note],
              ["Added amount", input.change.amount ? rupees(input.change.amount) : null],
              [
                "Paid",
                input.change.paid
                  ? `${input.change.amount ? rupees(input.change.amount) : "Yes"} (${input.change.paid.mode}${input.change.paid.reference ? `, Ref: ${input.change.paid.reference}` : ""})`
                  : null,
              ],
              ["Due on", !input.change.paid && input.change.dueDate ? formatDate(input.change.dueDate) : null],
            ],
          },
          summary,
          {
            kind: "p",
            text: `The updated invoice, with the new charge and the updated installment schedule, is attached as a PDF. ${replaces} You can also view it in the school portal at ${bills}.`,
          },
          quote,
        ],
      },
    };
  }

  if (input.kind === "SCHEDULE_CHANGE") {
    const schedule = input.schedule ?? [];
    return {
      subject: subject(`Updated invoice ${input.billNumber} — new payment schedule`, input.schoolName),
      content: {
        heading: "Your payment schedule has been updated",
        greeting,
        blocks: [
          {
            kind: "p",
            text: `The installment schedule for ${sub} has been updated. A new invoice with the revised schedule is attached. It replaces all earlier copies of this invoice, so please use this one from now on.`,
          },
          {
            kind: "facts",
            title: "New installment schedule",
            rows: schedule.map((item) => [
              `Installment ${item.number} of ${schedule.length}`,
              `${rupees(item.amount)} due on ${formatDate(item.dueDate)}${item.status === "Paid" ? " (paid)" : item.status === "Part paid" ? " (part paid)" : ""}`,
            ]),
          },
          summary,
          {
            kind: "p",
            text: "Nothing else about your subscription has changed. Your activation codes and service period stay the same.",
          },
          { kind: "p", text: `You can also view the invoice and payment schedule in the school portal at ${bills}.` },
          {
            kind: "p",
            text: `If the new schedule does not match what we agreed, or you have any questions, reply to this email or write to ${COMPANY.email}, quoting invoice ${input.billNumber}.`,
          },
        ],
      },
    };
  }

  // Any other bill of the series sent again (e.g. an older updated bill).
  return {
    subject: subject(`Invoice ${input.billNumber} — ${planLabel(plan)}`, input.schoolName),
    content: {
      heading: `Invoice ${input.billNumber}`,
      greeting,
      blocks: [
        { kind: "p", text: `Please find attached invoice ${input.billNumber} for ${sub}.` },
        summary,
        { kind: "p", text: `The invoice is attached as a PDF. You can also view it in the school portal at ${bills}.` },
        quote,
      ],
    },
  };
}

/** Sends a bill: a short letter in the shared layout, with the invoice attached as a PDF. */
export async function sendBillEmail(input: BillEmailInput) {
  const { subject: title, content } = billEmailContent(input);
  await sendSchoolEmail({ to: input.to, subject: title, content, attachments: input.attachments });
}

// ---------------------------------------------------------------------------
// 4. Activation codes for a class
// ---------------------------------------------------------------------------

export async function sendActivationCodesEmail(input: {
  to: string;
  schoolName: string;
  contactName?: string | null;
  planName: string;
  batchLabel: string;
  batchName: string;
  codeCount: number;
  expiresAt: Date;
  attachment: { filename: string; content: Buffer };
}) {
  const plan = { planName: input.planName, batchLabel: input.batchLabel };
  await sendSchoolEmail({
    to: input.to,
    subject: subject(`Activation codes for ${input.batchName}`, input.schoolName),
    content: {
      heading: `Activation codes for ${input.batchName}`,
      greeting: dear(input.contactName, input.schoolName),
      blocks: [
        { kind: "p", text: `The student activation codes for ${input.batchName} at ${input.schoolName} are ready and attached to this email.` },
        {
          kind: "facts",
          title: "Code details",
          rows: [
            ["Class", input.batchName],
            ["Plan", planLabel(plan)],
            ["Number of codes", String(input.codeCount)],
            ["Valid until", formatDate(input.expiresAt)],
          ],
        },
        {
          kind: "steps",
          title: "How to distribute the codes",
          items: [
            "Give each student one code from the attached file. The serial number column makes it easy to track who received which code.",
            "The parent enters the code in the CensorX app on the child's device to activate protection under your school's plan.",
            "Once a code is used, it cannot be used again on another device.",
          ],
        },
        {
          kind: "bullets",
          title: "Please keep these codes secure",
          items: [
            "Share each code only with the student or parent it is meant for.",
            "Do not forward this file or post the codes in group chats or on notice boards.",
            `If the file is lost, you can download the codes again from the school portal at ${portal("Subscription → Download Codes")}.`,
            "If you think a code has been shared with the wrong person, contact us right away so we can help.",
          ],
        },
        { kind: "p", text: `If you need more codes for this class or have any questions, reply to this email or write to ${COMPANY.email}.` },
      ],
    },
    attachments: [
      {
        filename: input.attachment.filename,
        content: input.attachment.content,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// 7. Batch renewed
// ---------------------------------------------------------------------------

/**
 * Sent when a batch is renewed. Deliberately carries no codes: renewal reuses the codes the
 * school already holds, and re-sending them would widen their exposure for no reason.
 */
export async function sendBatchRenewalEmail(input: {
  to: string;
  schoolName: string;
  contactName?: string | null;
  planName: string;
  batchLabel: string;
  batchNames: string[];
  startAt: Date;
  expiresAt: Date;
  /** Students holding a licence of this batch. */
  activeCount: number | null;
  /** True when the renewal's invoice is sent in its own email. */
  billSent: boolean;
}) {
  const plan = { planName: input.planName, batchLabel: input.batchLabel };
  await sendSchoolEmail({
    to: input.to,
    subject: subject(`Subscription renewed: ${planLabel(plan)}`, input.schoolName),
    content: {
      heading: "Your subscription has been renewed",
      greeting: dear(input.contactName, input.schoolName),
      blocks: [
        { kind: "p", text: `Thank you for renewing with CensorX for Schools. ${subscriptionOf(input.schoolName, plan)} has been renewed.` },
        {
          kind: "facts",
          title: "Renewal summary",
          rows: [
            ["Plan", planLabel(plan)],
            ["New period", `${formatDate(input.startAt)} – ${formatDate(input.expiresAt)}`],
            ["Classes", classList(input.batchNames)],
            ["Active licences", input.activeCount !== null ? plural(input.activeCount, "student") : null],
          ],
        },
        {
          kind: "bullets",
          title: "No action is needed from students or parents",
          items: [
            "The existing activation codes are still valid. No new codes are needed.",
            `Protection is restored automatically on the devices of ${allStudents(input.activeCount)}.`,
            "If a student's app was paused when the earlier period ended, they only need to reopen the app.",
          ],
        },
        ...(input.billSent ? [{ kind: "p", text: "The invoice for this renewal is sent to you in a separate email." } as EmailBlock] : []),
        { kind: "p", text: `You can view the subscription details at any time in the school portal at ${portal("Subscription")}.` },
        { kind: "p", text: `For any questions, reply to this email or write to ${COMPANY.email}.` },
      ],
    },
  });
}

// ---------------------------------------------------------------------------
// 8. Batch ends soon / 9. Batch has ended
// ---------------------------------------------------------------------------

const RENEW_HELP = `To renew, reply to this email or write to ${COMPANY.email}, and we will help you renew.`;

/** Reminder sent a few days before a batch ends, with how to renew. */
export async function sendBatchEndingSoonEmail(input: {
  to: string;
  schoolName: string;
  contactName?: string | null;
  planName: string;
  batchLabel: string;
  classNames: string[];
  expiresAt: Date;
  daysLeft: number;
  activeCount: number | null;
}) {
  const plan = { planName: input.planName, batchLabel: input.batchLabel };
  const end = formatDate(input.expiresAt);
  await sendSchoolEmail({
    to: input.to,
    subject: subject(`Your subscription ends on ${end} (${input.batchLabel})`, input.schoolName),
    content: {
      heading: `Your subscription ends in ${plural(input.daysLeft, "day")}`,
      greeting: dear(input.contactName, input.schoolName),
      blocks: [
        {
          kind: "p",
          text: `This is a reminder that ${subscriptionOf(input.schoolName, plan)} ends on ${end}, ${plural(input.daysLeft, "day")} from today.`,
        },
        {
          kind: "facts",
          title: "Subscription summary",
          rows: [
            ["Plan", planLabel(plan)],
            ["End date", end],
            ["Classes", classList(input.classNames)],
            ["Active licences", input.activeCount !== null ? plural(input.activeCount, "student") : null],
          ],
        },
        {
          kind: "bullets",
          title: `What happens after ${end}`,
          items: [
            `CensorX protection will pause on the devices of ${allStudents(input.activeCount)} in these classes.`,
            "Their activation codes will stop working until the subscription is renewed.",
          ],
        },
        {
          kind: "bullets",
          title: "Renew to keep protection running without a break",
          items: ["Renewing keeps the same activation codes working. Students and parents do not need to do anything.", RENEW_HELP],
        },
        { kind: "p", text: `You can view your subscription details at any time in the school portal at ${portal("Subscription")}.` },
      ],
    },
  });
}

/** Sent once a batch has ended, with how to renew it. */
export async function sendBatchEndedEmail(input: {
  to: string;
  schoolName: string;
  contactName?: string | null;
  planName: string;
  batchLabel: string;
  classNames: string[];
  expiresAt: Date;
  affectedCount: number | null;
}) {
  const plan = { planName: input.planName, batchLabel: input.batchLabel };
  const end = formatDate(input.expiresAt);
  await sendSchoolEmail({
    to: input.to,
    subject: subject(`Your subscription has ended (${input.batchLabel})`, input.schoolName),
    content: {
      heading: "Your subscription has ended",
      greeting: dear(input.contactName, input.schoolName),
      blocks: [
        { kind: "p", text: `${subscriptionOf(input.schoolName, plan)} ended on ${end}.` },
        {
          kind: "facts",
          title: "Subscription summary",
          rows: [
            ["Plan", planLabel(plan)],
            ["Ended on", end],
            ["Classes", classList(input.classNames)],
            ["Affected students", input.affectedCount !== null ? String(input.affectedCount) : null],
          ],
        },
        {
          kind: "bullets",
          title: "What this means",
          items: [
            `CensorX protection is now paused on the devices of ${allStudents(input.affectedCount)} in these classes.`,
            "Their activation codes will not work until the subscription is renewed.",
          ],
        },
        {
          kind: "bullets",
          title: "Restore protection by renewing",
          items: [
            "The same activation codes start working again as soon as you renew. No new codes are needed.",
            "Students only need to reopen the app after renewal.",
            RENEW_HELP,
          ],
        },
        { kind: "p", text: `You can view your subscription details at any time in the school portal at ${portal("Subscription")}.` },
      ],
    },
  });
}

// ---------------------------------------------------------------------------
// 10–12. Payment reminders
// ---------------------------------------------------------------------------

/** Installment reminder: a few days before, on the due date, and when it is overdue. */
export async function sendPaymentReminderEmail(input: {
  to: string;
  schoolName: string;
  contactName?: string | null;
  planName: string;
  batchLabel: string;
  invoiceNumber: string;
  installmentNumber: number;
  installmentCount: number;
  amount: number;
  dueDate: Date;
  total: number;
  paid: number;
  balance: number;
  daysOverdue: number;
  studentCount: number | null;
  /** FOLLOW_UP: still unpaid after the overdue email, sent every 3 days until paid. */
  stage: "UPCOMING" | "DUE" | "OVERDUE" | "FOLLOW_UP";
  /** Which follow-up this is (1, 2, 3 …). */
  followUpNumber?: number;
}) {
  const plan = { planName: input.planName, batchLabel: input.batchLabel };
  const sub = subscriptionOf(input.schoolName, plan);
  const which = `${input.installmentNumber} of ${input.installmentCount}`;
  const due = formatDate(input.dueDate);
  const summary = accountSummary({ total: input.total, paid: input.paid, balance: input.balance });
  const howToPay = (quote: boolean): EmailBlock => ({
    kind: "facts",
    title: "How to pay",
    intro: "To make this payment, please contact the CensorX team:",
    rows: contactRows(),
    outro: quote ? `Please quote invoice number ${input.invoiceNumber} when you get in touch.` : undefined,
  });
  const portalLine: EmailBlock = {
    kind: "p",
    text: `You can view your invoice and payment schedule at any time in the school portal at ${portal("Subscription → Bills")}.`,
  };
  const paymentRows = (dueLabel: string): Array<[string, string | null]> => [
    ["Installment", which],
    ["Amount due", rupees(input.amount)],
    ["Due date", dueLabel],
    ...(input.stage === "OVERDUE" || input.stage === "FOLLOW_UP"
      ? ([["Days overdue", String(input.daysOverdue)]] as Array<[string, string]>)
      : []),
    ["Invoice no.", input.invoiceNumber],
  ];

  let title: string;
  let content: EmailContent;
  if (input.stage === "UPCOMING") {
    title = `Payment reminder: installment ${which} due on ${due}`;
    content = {
      heading: "Payment reminder",
      greeting: dear(input.contactName, input.schoolName),
      blocks: [
        { kind: "p", text: `This is a friendly reminder that a payment for ${sub} is due soon.` },
        { kind: "facts", title: "Payment due", rows: paymentRows(due) },
        summary,
        howToPay(false),
        { kind: "p", text: "If you have already made this payment, thank you, and please ignore this reminder." },
        portalLine,
        { kind: "p", text: `For any questions, reply to this email or write to ${COMPANY.email}.` },
      ],
    };
  } else if (input.stage === "DUE") {
    title = `Payment due today: installment ${which}`;
    content = {
      heading: "Payment due today",
      greeting: dear(input.contactName, input.schoolName),
      signature: "whatsapp",
      blocks: [
        { kind: "p", text: `Installment ${which} for ${sub} is due today, ${due}.` },
        { kind: "facts", title: "Payment due", rows: paymentRows(`${due} (today)`) },
        summary,
        howToPay(true),
        { kind: "p", text: "To keep protection running without a break for your students, please arrange this payment as soon as possible." },
        {
          kind: "p",
          text: "If you have already made this payment, thank you, and please ignore this email. Payments can take a little time to appear on your account.",
        },
        portalLine,
      ],
    };
  } else if (input.stage === "FOLLOW_UP") {
    title = `Payment still overdue: installment ${which} (${plural(input.daysOverdue, "day")} late)`;
    const students =
      input.studentCount && input.studentCount > 0 ? `the ${plural(input.studentCount, "student")}` : "the students";
    content = {
      heading: "Payment still overdue",
      greeting: dear(input.contactName, input.schoolName),
      signature: "whatsapp",
      blocks: [
        {
          kind: "p",
          text: `We have not yet received installment ${which} for ${sub}. It was due on ${due} and is now ${plural(input.daysOverdue, "day")} overdue.`,
        },
        { kind: "facts", title: "Overdue payment", rows: paymentRows(due) },
        summary,
        {
          kind: "p",
          text: `To avoid any break in protection for ${students} on this subscription, please arrange this payment as soon as you can. Access is restored as soon as payment is received if it has been paused.`,
        },
        howToPay(true),
        {
          kind: "p",
          text: "If you have already paid, thank you, and please ignore this email. If you need more time or want to discuss the schedule, just reply and we will be happy to help.",
        },
        portalLine,
      ],
    };
  } else {
    title = `Payment overdue: installment ${which}`;
    const students =
      input.studentCount && input.studentCount > 0 ? `the ${plural(input.studentCount, "student")}` : "the students";
    content = {
      heading: "Payment overdue",
      greeting: dear(input.contactName, input.schoolName),
      signature: "whatsapp",
      blocks: [
        {
          kind: "p",
          text: `Installment ${which} for ${sub} was due on ${due} and is now ${plural(input.daysOverdue, "day")} overdue.`,
        },
        { kind: "facts", title: "Overdue payment", rows: paymentRows(due) },
        summary,
        {
          kind: "p",
          text: `Please arrange this payment as soon as possible. If it stays unpaid, protection may be paused for ${students} on this subscription until the overdue amount is settled. Access is restored as soon as payment is received.`,
        },
        howToPay(true),
        {
          kind: "p",
          text: "If you have already made this payment, thank you, and please ignore this email. Payments can take a little time to appear on your account. If you need more time or want to discuss the schedule, please let us know and we will be happy to help.",
        },
        portalLine,
      ],
    };
  }

  await sendSchoolEmail({ to: input.to, subject: subject(title, input.schoolName), content });
}

// ---------------------------------------------------------------------------
// 13. Access paused / 14. Access restored
// ---------------------------------------------------------------------------

/** Sent when the admin stops or restarts access for a batch. */
export async function sendBatchAccessEmail(input: {
  to: string;
  schoolName: string;
  contactName?: string | null;
  planName: string;
  batchLabel: string;
  classNames: string[];
  paused: boolean;
  /** When access was paused or restored. */
  at: Date;
  /** Paused: students who lost access. Restored: students who have access again. */
  studentCount: number | null;
  reason?: string | null;
  /** Paused: the batch's invoice, when it has one. */
  invoiceNumber?: string | null;
  /** Restored: the batch's end date. */
  expiresAt?: Date | null;
  /** Restored: the end date has already passed, so access returns only once it is renewed. */
  ended?: boolean;
}) {
  const plan = { planName: input.planName, batchLabel: input.batchLabel };
  const sub = subscriptionOf(input.schoolName, plan);
  const date = formatDate(input.at);
  const classes = classList(input.classNames);

  if (input.paused) {
    await sendSchoolEmail({
      to: input.to,
      subject: subject(`Access paused (${input.batchLabel})`, input.schoolName),
      content: {
        heading: "Access has been paused",
        greeting: dear(input.contactName, input.schoolName),
        signature: "whatsapp",
        blocks: [
          { kind: "p", text: `Access for ${sub} has been paused as of ${date}.` },
          {
            kind: "facts",
            title: "Subscription summary",
            rows: [
              ["Plan", planLabel(plan)],
              ["Paused on", date],
              ["Classes", classes],
              ["Affected students", input.studentCount !== null ? String(input.studentCount) : null],
              ["Reason", input.reason?.trim() || null],
            ],
          },
          {
            kind: "bullets",
            title: "What this means",
            items: [
              `CensorX protection is paused on the devices of ${allStudents(input.studentCount)} in these classes.`,
              "All activation codes are kept safely. Students will not need new codes.",
              "Protection starts again as soon as access is restored. Students only need to reopen the app.",
            ],
          },
          {
            kind: "facts",
            title: "How to restore access",
            intro: "Please contact the CensorX team and we will restore access as quickly as possible:",
            rows: contactRows(),
            outro: input.invoiceNumber ? `Please quote invoice number ${input.invoiceNumber} when you get in touch.` : undefined,
          },
          { kind: "p", text: "If you think this pause is a mistake, or you have already settled the amount, please contact us right away." },
        ],
      },
    });
    return;
  }

  await sendSchoolEmail({
    to: input.to,
    subject: subject(`Access restored (${input.batchLabel})`, input.schoolName),
    content: {
      heading: "Access has been restored",
      greeting: dear(input.contactName, input.schoolName),
      signature: "whatsapp",
      blocks: [
        { kind: "p", text: `Good news: access for ${sub} has been restored as of ${date}.` },
        {
          kind: "facts",
          title: "Subscription summary",
          rows: [
            ["Plan", planLabel(plan)],
            ["Restored on", date],
            ["Classes", classes],
            ["Active students", input.ended ? null : input.studentCount !== null ? String(input.studentCount) : null],
            ["Valid until", input.expiresAt ? formatDate(input.expiresAt) : null],
          ],
        },
        input.ended
          ? {
              kind: "p",
              text: "Please note that this subscription's end date has already passed, so students will get protection back once it is renewed. Reply to this email and we will help you renew.",
            }
          : {
              kind: "bullets",
              title: "What this means",
              items: [
                `CensorX protection is active again on the devices of ${allStudents(input.studentCount)} in these classes.`,
                "The same activation codes still work. No new codes are needed.",
                "Students only need to reopen the app.",
              ],
            },
        {
          kind: "p",
          text: "Thank you for your continued trust in CensorX. If any student has trouble accessing the app, please let us know and we will help right away.",
        },
        { kind: "p", text: `You can view your subscription details at any time in the school portal at ${portal("Subscription")}.` },
      ],
    },
  });
}

// ---------------------------------------------------------------------------
// Renewal offer (marketing): every 4 days after a subscription has ended
// ---------------------------------------------------------------------------

/**
 * Invites a school to renew an ended subscription. Sent every 4 days after the "has ended"
 * email until the subscription is renewed or the admin stops these emails. Marketing: it says
 * how to stop it and carries a List-Unsubscribe header.
 */
export async function sendRenewalOfferEmail(input: {
  to: string;
  schoolName: string;
  contactName?: string | null;
  planName: string;
  batchLabel: string;
  classNames: string[];
  expiresAt: Date;
  affectedCount: number | null;
  /** Which renewal email this is (1, 2, 3 …). */
  offerNumber: number;
}) {
  const plan = { planName: input.planName, batchLabel: input.batchLabel };
  const ended = formatDate(input.expiresAt);
  const daysSince = Math.max(1, Math.floor((Date.now() - input.expiresAt.getTime()) / (24 * 60 * 60 * 1000)));
  const stopSubject = encodeURIComponent(`Stop renewal reminders - ${input.schoolName} (${input.batchLabel})`);
  await sendSchoolEmail({
    to: input.to,
    subject: subject(`Renew your subscription and restore protection (${input.batchLabel})`, input.schoolName),
    headers: { "List-Unsubscribe": `<mailto:${COMPANY.email}?subject=${stopSubject}>` },
    content: {
      heading: "Bring CensorX protection back for your students",
      greeting: dear(input.contactName, input.schoolName),
      blocks: [
        {
          kind: "p",
          text: `${subscriptionOf(input.schoolName, plan)} ended on ${ended}, ${plural(daysSince, "day")} ago. Since then, CensorX protection has been paused on the devices of ${allStudents(input.affectedCount)} in these classes.`,
        },
        {
          kind: "facts",
          title: "Your subscription",
          rows: [
            ["Plan", planLabel(plan)],
            ["Ended on", ended],
            ["Classes", classList(input.classNames)],
            ["Students waiting", input.affectedCount !== null ? String(input.affectedCount) : null],
          ],
        },
        {
          kind: "bullets",
          title: "Why renew now",
          items: [
            "Protection comes back the moment you renew. The same activation codes start working again.",
            "No new codes and no setup: students only need to reopen the app.",
            "Your school portal, bills and history stay exactly as they are.",
          ],
        },
        {
          kind: "facts",
          title: "Renew in a few minutes",
          intro: "Reply to this email or contact the CensorX team, and we will set up your renewal:",
          rows: contactRows(),
        },
        {
          kind: "p",
          text: `You are receiving this because ${input.schoolName}'s CensorX subscription has ended. If you do not want these renewal reminders, reply with "Stop" and we will stop them.`,
        },
      ],
    },
  });
}
