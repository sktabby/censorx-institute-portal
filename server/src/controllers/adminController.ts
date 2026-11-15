import type { Response } from "express";
import { CODE_STATUS_FIELDS, LICENSE_STATUS_FIELDS, onlyFields } from "../utils/firestoreFields";
import { buildCreatedCodesWorkbook, readFirstColumn, type CreatedCodesClass } from "../services/codeFilesService";
import { Collections } from "../config/collections";
import { collection } from "../repositories/firestoreRepository";
import {
  getActiveSubscription,
  getEffectiveActivationCodeStatus,
  getEffectiveLicenseStatus,
  getEffectiveOrganizationStatus,
  getOrganization,
  getOrganizationSeatUsage,
  isLiveBatch,
  listOrganizationLicenses,
  listOrganizationSubscriptions,
  sumLiveSeatLimit,
  withEffectiveSubscriptionStatus,
} from "../repositories/organizationRepository";
import { buildSeatUsage, mergeSeatUsage, EMPTY_SEAT_USAGE } from "../utils/seatAccounting";
import type { PortalRequest } from "../middleware/requirePortalUser";
import { ApiError } from "../middleware/errorHandler";
import { ok } from "../utils/apiResponse";
import * as organizationService from "../services/organizationService";
import * as codeGenerationService from "../services/codeGenerationService";
import * as batchService from "../services/batchService";
import * as batchSubscriptionService from "../services/batchSubscriptionService";
import * as paymentService from "../services/paymentService";
import { amountDueNow, findIssuedBill, installmentViews, issuedBills } from "../services/paymentSchedule";
import { buildCodesWorkbook, isCodeVaultEnabled } from "../services/codeVaultService";
import { billPdfFilename, renderBillHtml, renderBillPdf, sendBillForOrganization } from "../services/billService";
import { writeAuditLog } from "../repositories/auditLogRepository";
import type {
  LicenseStatus,
  Organization,
  OrganizationActivationCode,
  OrganizationLicense,
  OrganizationSubscription,
} from "../models/types";

const ENDING_SOON_DAYS = 14;
const PAYMENT_DUE_SOON_DAYS = 7;

type OrganizationListRow = Organization & {
  activeCodesRemaining: number;
  organizationStatus: Organization["status"];
  /** ACTIVE while any batch is live; otherwise the latest batch's status; NONE without batches. */
  subscriptionStatus: OrganizationSubscription["status"] | "NONE";
  liveBatchCount: number;
  batchCount: number;
  /** End date of the live batch that ends soonest, or of the last batch when none is live. */
  nextExpiresAt: string | null;
  /** Live batches ending within 14 days. */
  endingSoonCount: number;
  pausedCount: number;
  amountDue: number;
  overdueCount: number;
};

function buildEffectiveSubscriptionMap(
  docs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[],
  now: Date
) {
  const subscriptionsById = new Map<string, OrganizationSubscription>();
  docs.forEach((doc) => {
    subscriptionsById.set(doc.id, withEffectiveSubscriptionStatus(doc.data() as OrganizationSubscription, now));
  });
  return subscriptionsById;
}

function groupSubscriptionsByOrg(subscriptionsById: Map<string, OrganizationSubscription>) {
  const byOrg = new Map<string, OrganizationSubscription[]>();
  subscriptionsById.forEach((subscription) => {
    const bucket = byOrg.get(subscription.organizationId) ?? [];
    bucket.push(subscription);
    byOrg.set(subscription.organizationId, bucket);
  });
  return byOrg;
}

function timestampMillis(value: unknown): number {
  if (value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as FirebaseFirestore.Timestamp).toMillis();
  }
  return 0;
}

function timestampToIso(value: unknown): string | null {
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as FirebaseFirestore.Timestamp).toDate().toISOString();
  }
  return null;
}

/** Summarises a school's batches for list rows and the dashboard. */
function summariseBatches(subscriptions: OrganizationSubscription[], now: Date) {
  const live = subscriptions.filter((subscription) => isLiveBatch(subscription, now));
  const latest = subscriptions.reduce<OrganizationSubscription | null>(
    (best, candidate) => (!best || timestampMillis(candidate.createdAt) >= timestampMillis(best.createdAt) ? candidate : best),
    null
  );
  const soonest = live.reduce<OrganizationSubscription | null>(
    (best, candidate) => (!best || candidate.expiresAt.toMillis() < best.expiresAt.toMillis() ? candidate : best),
    null
  );
  const endingSoonCount = live.filter(
    (subscription) => subscription.expiresAt.toMillis() - now.getTime() <= ENDING_SOON_DAYS * 24 * 60 * 60 * 1000
  ).length;
  const billed = subscriptions.filter((subscription) => subscription.payment && subscription.status !== "CANCELLED");
  return {
    liveBatchCount: live.length,
    batchCount: subscriptions.filter((subscription) => subscription.status !== "RENEWED").length,
    subscriptionStatus: (live.length > 0 ? "ACTIVE" : latest?.status ?? "NONE") as OrganizationSubscription["status"] | "NONE",
    nextExpiresAt: timestampToIso((soonest ?? latest)?.expiresAt),
    seatLimit: sumLiveSeatLimit(subscriptions, now),
    endingSoonCount,
    pausedCount: subscriptions.filter((subscription) => subscription.status === "SUSPENDED").length,
    /** Installments past their due date and unpaid, across the school's bills. */
    amountDue: Math.round(billed.reduce((sum, subscription) => sum + amountDueNow(subscription.payment!, now), 0) * 100) / 100,
    overdueCount: billed.filter((subscription) =>
      installmentViews(subscription.payment!, { asOf: now }).some((item) => item.status === "OVERDUE")
    ).length,
  };
}

function buildOrganizationRow(
  org: Organization,
  subscriptions: OrganizationSubscription[],
  activeCodesRemaining: number,
  now: Date
): OrganizationListRow {
  const summary = summariseBatches(subscriptions, now);
  return {
    ...org,
    organizationStatus: org.status,
    subscriptionStatus: summary.subscriptionStatus,
    status: getEffectiveOrganizationStatus(org, subscriptions, now),
    activeCodesRemaining,
    liveBatchCount: summary.liveBatchCount,
    batchCount: summary.batchCount,
    nextExpiresAt: summary.nextExpiresAt,
    endingSoonCount: summary.endingSoonCount,
    pausedCount: summary.pausedCount,
    amountDue: summary.amountDue,
    overdueCount: summary.overdueCount,
  };
}

export async function getDashboard(_req: PortalRequest, res: Response) {
  const [orgsSnap, subscriptionsSnap, licensesSnap] = await Promise.all([
    collection(Collections.organizations).get(),
    collection(Collections.organizationSubscriptions).get(),
    // Only the fields the seat totals need (status, batch, school, end date).
    onlyFields(collection(Collections.organizationLicenses), LICENSE_STATUS_FIELDS).get(),
  ]);
  const now = new Date();
  const subscriptionsById = buildEffectiveSubscriptionMap(subscriptionsSnap.docs, now);
  const subscriptionsByOrg = groupSubscriptionsByOrg(subscriptionsById);
  const orgs = orgsSnap.docs
    .map((d) => {
      const org = d.data() as Organization;
      return buildOrganizationRow(org, subscriptionsByOrg.get(org.organizationId) ?? [], 0, now);
    })
    .filter((org) => org.organizationStatus !== "ARCHIVED");

  const visibleOrgIds = new Set(orgs.map((org) => org.organizationId));
  const statusesByOrg = new Map<string, LicenseStatus[]>();
  licensesSnap.docs.forEach((doc) => {
    const license = doc.data() as OrganizationLicense;
    if (!visibleOrgIds.has(license.organizationId)) return;
    const status = getEffectiveLicenseStatus(license, subscriptionsById.get(license.subscriptionId), now);
    const bucket = statusesByOrg.get(license.organizationId);
    if (bucket) bucket.push(status);
    else statusesByOrg.set(license.organizationId, [status]);
  });

  // Seat totals are derived from licenses and live batches, not from the stored
  // purchasedSeats / activatedSeats counters, so expired seats stop being counted.
  const seatUsage = orgs.reduce(
    (acc, org) =>
      mergeSeatUsage(
        acc,
        buildSeatUsage({
          effectiveStatuses: statusesByOrg.get(org.organizationId) ?? [],
          seatLimit: sumLiveSeatLimit(subscriptionsByOrg.get(org.organizationId) ?? [], now),
        })
      ),
    EMPTY_SEAT_USAGE
  );

  // Live batches that end within the next two weeks, soonest first — the admin's renewal to-do list.
  const orgNameById = new Map(orgs.map((org) => [org.organizationId, org.name]));
  const endingSoon = Array.from(subscriptionsById.values())
    .filter((subscription) => visibleOrgIds.has(subscription.organizationId) && isLiveBatch(subscription, now))
    .filter((subscription) => subscription.expiresAt.toMillis() - now.getTime() <= ENDING_SOON_DAYS * 24 * 60 * 60 * 1000)
    .sort((a, b) => a.expiresAt.toMillis() - b.expiresAt.toMillis())
    .slice(0, 20)
    .map((subscription) => ({
      organizationId: subscription.organizationId,
      schoolName: orgNameById.get(subscription.organizationId) ?? "Unknown school",
      subscriptionId: subscription.subscriptionId,
      batchLabel: batchService.batchLabelOf(subscription),
      expiresAt: timestampToIso(subscription.expiresAt),
      daysRemaining: Math.max(0, Math.floor((subscription.expiresAt.toMillis() - now.getTime()) / (24 * 60 * 60 * 1000))),
      seatLimit: subscription.seatLimit,
    }));

  const liveBatches = Array.from(subscriptionsById.values()).filter(
    (subscription) => visibleOrgIds.has(subscription.organizationId) && isLiveBatch(subscription, now)
  ).length;

  // Installments that are overdue, due, or due within a week — the admin's collection to-do list.
  const DAY = 24 * 60 * 60 * 1000;
  const paymentsDue = Array.from(subscriptionsById.values())
    .filter((subscription) => visibleOrgIds.has(subscription.organizationId) && subscription.payment && subscription.status !== "CANCELLED")
    .flatMap((subscription) =>
      installmentViews(subscription.payment!, { asOf: now })
        .filter(
          (item) =>
            item.status === "OVERDUE" ||
            item.status === "DUE" ||
            (item.status !== "PAID" && item.dueDate.getTime() - now.getTime() <= PAYMENT_DUE_SOON_DAYS * DAY)
        )
        .map((item) => ({
          organizationId: subscription.organizationId,
          schoolName: orgNameById.get(subscription.organizationId) ?? "Unknown school",
          subscriptionId: subscription.subscriptionId,
          batchLabel: batchService.batchLabelOf(subscription),
          installmentNumber: item.number,
          installmentCount: subscription.payment!.installmentPlan?.length ?? 0,
          amount: item.remaining,
          dueDate: item.dueDate.toISOString(),
          status: item.status,
          daysLate: item.daysLate,
          isPaused: subscription.status === "SUSPENDED",
        }))
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 30);

  const pausedBatches = Array.from(subscriptionsById.values())
    .filter((subscription) => visibleOrgIds.has(subscription.organizationId) && subscription.status === "SUSPENDED")
    .map((subscription) => ({
      organizationId: subscription.organizationId,
      schoolName: orgNameById.get(subscription.organizationId) ?? "Unknown school",
      subscriptionId: subscription.subscriptionId,
      batchLabel: batchService.batchLabelOf(subscription),
      pausedAt: timestampToIso(subscription.pausedAt),
      pauseReason: subscription.pauseReason ?? null,
    }));

  return ok(res, {
    totalSchools: orgs.length,
    activeSchools: orgs.filter((o) => o.status === "ACTIVE").length,
    expiredSchools: orgs.filter((o) => o.status === "EXPIRED").length,
    totalStudentSeats: seatUsage.totalSeats,
    activatedStudents: seatUsage.activatedSeats,
    totalStudentsJoined: seatUsage.activatedSeats,
    availableSeats: seatUsage.availableSeats,
    seatUsage,
    liveBatches,
    endingSoon,
    paymentsDue,
    pausedBatches,
  });
}

export async function listOrganizations(req: PortalRequest, res: Response) {
  const { search = "", status, includeArchived = false, page = 1, pageSize = 10 } = req.query as any;
  const [orgsSnap, codesSnap, subscriptionsSnap, licensesSnap] = await Promise.all([
    collection(Collections.organizations).get(),
    // Only the fields the per-school code counts need.
    onlyFields(collection(Collections.organizationActivationCodes), CODE_STATUS_FIELDS).get(),
    collection(Collections.organizationSubscriptions).get(),
    onlyFields(collection(Collections.organizationLicenses), LICENSE_STATUS_FIELDS).get(),
  ]);
  const now = new Date();
  const subscriptionsById = buildEffectiveSubscriptionMap(subscriptionsSnap.docs, now);
  const subscriptionsByOrg = groupSubscriptionsByOrg(subscriptionsById);
  const licenseById = new Map<string, OrganizationLicense>();
  licensesSnap.docs.forEach((doc) => licenseById.set(doc.id, doc.data() as OrganizationLicense));

  const activeCodeCounts = new Map<string, number>();
  codesSnap.docs.forEach((doc) => {
    const code = doc.data() as OrganizationActivationCode;
    const status = getEffectiveActivationCodeStatus(
      code,
      subscriptionsById.get(code.subscriptionId),
      licenseById.get(code.licenseId),
      now
    );
    if (status === "UNUSED" || status === "REDEEMED") {
      activeCodeCounts.set(code.organizationId, (activeCodeCounts.get(code.organizationId) ?? 0) + 1);
    }
  });

  const needle = String(search).trim().toLowerCase();
  let orgs = orgsSnap.docs.map((d): OrganizationListRow => {
    const org = d.data() as Organization;
    return buildOrganizationRow(
      org,
      subscriptionsByOrg.get(org.organizationId) ?? [],
      activeCodeCounts.get(org.organizationId) ?? 0,
      now
    );
  });

  orgs = orgs.filter((org) => {
    const matchesArchivedVisibility = includeArchived || org.organizationStatus !== "ARCHIVED";
    const matchesStatus = !status || org.status === status;
    const matchesSearch =
      !needle ||
      org.name.toLowerCase().includes(needle) ||
      org.identifier.toLowerCase().includes(needle) ||
      org.contactEmail.toLowerCase().includes(needle);
    return matchesArchivedVisibility && matchesStatus && matchesSearch;
  });

  orgs.sort((a, b) => a.name.localeCompare(b.name));

  const total = orgs.length;
  const start = (Number(page) - 1) * Number(pageSize);
  return ok(res, {
    items: orgs.slice(start, start + Number(pageSize)),
    total,
    page: Number(page),
    pageSize: Number(pageSize),
    totalPages: Math.max(1, Math.ceil(total / Number(pageSize))),
  });
}

export async function createOrganization(req: PortalRequest, res: Response) {
  const result = await organizationService.createOrganization(req.body, req.portalUser!.uid);
  return ok(res, result, {}, 201);
}

export async function getOrganizationDetail(req: PortalRequest, res: Response) {
  const org = await getOrganization(req.params.organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  const now = new Date();
  const [subscriptions, seatUsage] = await Promise.all([
    listOrganizationSubscriptions(req.params.organizationId, now),
    getOrganizationSeatUsage(req.params.organizationId),
  ]);
  const currentSubscription = await getActiveSubscription(req.params.organizationId);
  const summary = summariseBatches(subscriptions, now);

  return ok(res, {
    ...org,
    organizationStatus: org.status,
    subscriptionStatus: summary.subscriptionStatus,
    status: getEffectiveOrganizationStatus(org, subscriptions, now),
    /** The school's primary batch (live batch ending last, else the latest). Act on batches by id instead. */
    currentSubscription,
    liveBatchCount: summary.liveBatchCount,
    batchCount: summary.batchCount,
    nextExpiresAt: summary.nextExpiresAt,
    endingSoonCount: summary.endingSoonCount,
    pausedCount: summary.pausedCount,
    amountDue: summary.amountDue,
    overdueCount: summary.overdueCount,
    // Authoritative seat numbers. Clients render these and must not recompute
    // capacity from purchasedSeats/activatedSeats.
    seatUsage,
    purchasedSeats: seatUsage.totalSeats,
    activatedSeats: seatUsage.activatedSeats,
    codeVaultEnabled: isCodeVaultEnabled(),
  });
}

/** Returns the school's legacy (school-level) bill as HTML for viewing or printing. */
export async function getOrganizationBill(req: PortalRequest, res: Response) {
  const org = await getOrganization(req.params.organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  if (!org.payment) {
    throw new ApiError(404, "BILL_NOT_FOUND", "This school has no school-level payment record. Bills now belong to batches.");
  }
  return ok(res, { billNumber: org.payment.billNumber, html: renderBillHtml(org, org.payment) });
}

/** Emails the school's legacy (school-level) bill to its contact email again. */
export async function sendOrganizationBill(req: PortalRequest, res: Response) {
  const org = await getOrganization(req.params.organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  if (!org.payment) {
    throw new ApiError(404, "BILL_NOT_FOUND", "This school has no school-level payment record. Bills now belong to batches.");
  }

  try {
    await sendBillForOrganization(org, org.payment);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(502, "BILL_EMAIL_FAILED", "The bill could not be emailed. Please try again.");
  }

  await writeAuditLog({
    actorUid: req.portalUser!.uid,
    actorRole: "SUPER_ADMIN",
    action: "BILL_SENT",
    organizationId: org.organizationId,
    targetType: "organization",
    targetId: org.organizationId,
    metadata: { billNumber: org.payment.billNumber },
  });

  return ok(res, { sent: true, to: org.contactEmail });
}

// ---------------------------------------------------------------------------
// Batches (one independent subscription each)
// ---------------------------------------------------------------------------

export async function listBatchSubscriptions(req: PortalRequest, res: Response) {
  const org = await getOrganization(req.params.organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  const now = new Date();
  const [batches, subscriptions] = await Promise.all([
    batchService.listBatchSubscriptions(req.params.organizationId, { audience: "admin", now }),
    listOrganizationSubscriptions(req.params.organizationId, now),
  ]);
  const summary = summariseBatches(subscriptions, now);
  return ok(res, {
    organization: {
      organizationId: org.organizationId,
      name: org.name,
      status: getEffectiveOrganizationStatus(org, subscriptions, now),
      storedStatus: org.status,
      liveBatchCount: summary.liveBatchCount,
      batchCount: summary.batchCount,
      nextExpiresAt: summary.nextExpiresAt,
    },
    batches,
  });
}

export async function createBatch(req: PortalRequest, res: Response) {
  const result = await batchSubscriptionService.createBatch(req.params.organizationId, req.body, req.portalUser!.uid);
  // No plaintext codes are ever returned here: a batch reserves seats and dates only.
  // Its classes are generated from Create Codes.
  const warnings: string[] = [];
  if (result.batchEmail && !result.batchEmail.sent && result.batchEmail.warning) warnings.push(result.batchEmail.warning);
  if (result.billEmail && !result.billEmail.sent && result.billEmail.warning) warnings.push(result.billEmail.warning);
  return ok(res, result, warnings.length ? { warning: warnings.join(" ") } : {}, 201);
}

export async function renewBatch(req: PortalRequest, res: Response) {
  const result = await batchSubscriptionService.renewBatch(
    req.params.organizationId,
    req.params.subscriptionId,
    req.body,
    req.portalUser!.uid
  );
  const warnings: string[] = [];
  if (result.renewalEmail && !result.renewalEmail.sent && result.renewalEmail.warning) warnings.push(result.renewalEmail.warning);
  if (result.billEmail && !result.billEmail.sent && result.billEmail.warning) warnings.push(result.billEmail.warning);
  return ok(res, result, warnings.length ? { warning: warnings.join(" ") } : {}, 201);
}

export async function cancelBatch(req: PortalRequest, res: Response) {
  const result = await batchSubscriptionService.cancelBatch(
    req.params.organizationId,
    req.params.subscriptionId,
    req.portalUser!.uid
  );
  return ok(res, result);
}

export async function extendBatch(req: PortalRequest, res: Response) {
  const result = await batchSubscriptionService.extendBatch(
    req.params.organizationId,
    req.params.subscriptionId,
    req.body.newExpiresAt,
    req.portalUser!.uid
  );
  return ok(res, { extended: true, ...result });
}

export async function addClassSeats(req: PortalRequest, res: Response) {
  const result = await batchSubscriptionService.addSeatsToClass(
    req.params.organizationId,
    req.params.subscriptionId,
    req.params.batchName,
    req.body.extraSeats,
    req.portalUser!.uid,
    req.body.charge
  );
  const warnings = [`"${result.batchName}" now has ${result.pendingSeats} seat(s) waiting. Make its codes in Create Codes.`];
  if (result.bill && !result.bill.billEmail.sent && result.bill.billEmail.warning) warnings.push(result.bill.billEmail.warning);
  return ok(res, result, { warning: warnings.join(" ") });
}

/** The batch's payment and the requested bill of its series (the first invoice by default). */
async function loadBatchBill(req: PortalRequest) {
  const org = await getOrganization(req.params.organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  const { payment, subscription } = await batchSubscriptionService.getBatchPayment(req.params.organizationId, req.params.subscriptionId);
  if (!payment) throw new ApiError(404, "BILL_NOT_FOUND", "No payment was recorded for this batch, so there is no bill.");
  const requested = (req.query as { billNumber?: string }).billNumber;
  const bill = findIssuedBill(payment, requested);
  if (!bill) throw new ApiError(404, "BILL_NOT_FOUND", "That bill was not found for this batch.");
  return { org, payment, subscription, billNumber: bill.billNumber };
}

/** A bill of one batch as HTML for viewing or printing in the portal. */
export async function getBatchBill(req: PortalRequest, res: Response) {
  const { org, payment, billNumber } = await loadBatchBill(req);
  return ok(res, { billNumber, html: renderBillHtml(org, payment, { billNumber }) });
}

export async function recordBatchPayment(req: PortalRequest, res: Response) {
  const result = await paymentService.recordPayment(req.params.organizationId, req.params.subscriptionId, req.body, req.portalUser!.uid);
  return ok(res, result, result.billEmail.sent ? {} : { warning: result.billEmail.warning }, 201);
}

export async function updateInstallmentDates(req: PortalRequest, res: Response) {
  const result = await paymentService.updateInstallmentDueDates(
    req.params.organizationId,
    req.params.subscriptionId,
    req.body.dueDates,
    req.portalUser!.uid,
    req.body.amounts
  );
  return ok(res, result, result.billEmail && !result.billEmail.sent ? { warning: result.billEmail.warning } : {});
}

export async function pauseBatch(req: PortalRequest, res: Response) {
  const result = await batchSubscriptionService.pauseBatch(
    req.params.organizationId,
    req.params.subscriptionId,
    req.body.reason ?? null,
    req.portalUser!.uid
  );
  return ok(res, result);
}

/** Stops or restarts the renewal emails of an ended batch. */
export async function setRenewalEmails(req: PortalRequest, res: Response) {
  const result = await batchSubscriptionService.setRenewalEmails(
    req.params.organizationId,
    req.params.subscriptionId,
    (req.body as { enabled: boolean }).enabled,
    req.portalUser!.uid
  );
  return ok(res, result);
}

export async function resumeBatch(req: PortalRequest, res: Response) {
  const result = await batchSubscriptionService.resumeBatch(req.params.organizationId, req.params.subscriptionId, req.portalUser!.uid);
  return ok(res, result);
}

function sendPdf(res: Response, filename: string, pdf: Buffer) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.status(200).send(pdf);
}

/** A bill of one batch as a PDF download. */
export async function getBatchBillPdf(req: PortalRequest, res: Response) {
  const { org, payment, billNumber } = await loadBatchBill(req);
  return sendPdf(res, billPdfFilename(payment, billNumber), await renderBillPdf(org, payment, billNumber));
}

/** The school's legacy (school-level) bill as a PDF download. */
export async function getOrganizationBillPdf(req: PortalRequest, res: Response) {
  const org = await getOrganization(req.params.organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  if (!org.payment) throw new ApiError(404, "BILL_NOT_FOUND", "This school has no school-level payment record.");
  return sendPdf(res, billPdfFilename(org.payment), await renderBillPdf(org, org.payment));
}

/** Emails the bill of one batch to the school's contact email again. */
export async function sendBatchBill(req: PortalRequest, res: Response) {
  // Sends the latest bill of the series unless a specific one is asked for.
  const requested = (req.query as { billNumber?: string }).billNumber;
  const { org, payment, subscription } = await loadBatchBill(req);
  const bills = issuedBills(payment);
  const billNumber = requested ? requested : bills[bills.length - 1].billNumber;

  try {
    await sendBillForOrganization(org, payment, billNumber);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(502, "BILL_EMAIL_FAILED", "The bill could not be emailed. Please try again.");
  }

  await writeAuditLog({
    actorUid: req.portalUser!.uid,
    actorRole: "SUPER_ADMIN",
    action: "BILL_SENT",
    organizationId: org.organizationId,
    targetType: "subscription",
    targetId: subscription.subscriptionId,
    metadata: { billNumber, batchLabel: batchService.batchLabelOf(subscription) },
  });

  return ok(res, { sent: true, to: org.contactEmail, billNumber });
}

/** Full activation codes of a school (optionally one batch / some classes) as an .xlsx download. */
/** The codes just made on Create Codes, as an .xlsx (one sheet per class). Nothing is stored. */
export async function createdCodesWorkbook(req: PortalRequest, res: Response) {
  const body = req.body as { schoolName?: string; classes: CreatedCodesClass[] };
  const buffer = await buildCreatedCodesWorkbook(body);
  const name = (body.schoolName || "activation-codes").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "activation-codes";
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${name}-codes.xlsx"`);
  return res.status(200).send(buffer);
}

/** Reads the first column of an uploaded .xlsx of student IDs. The file is not kept. */
export async function parseStudentIdFile(req: PortalRequest, res: Response) {
  const values = await readFirstColumn((req.body as { fileBase64: string }).fileBase64);
  return ok(res, { values });
}

/** Which of the given student IDs this school has already used (a student ID is used only once). */
export async function checkStudentIds(req: PortalRequest, res: Response) {
  const used = await codeGenerationService.findUsedStudentIds(req.params.organizationId, (req.body as { ids: string[] }).ids);
  return ok(res, { used });
}

export async function exportOrganizationCodes(req: PortalRequest, res: Response) {
  const org = await getOrganization(req.params.organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  const query = req.query as { subscriptionId?: string; batchNames?: string[] };

  const workbook = await buildCodesWorkbook({
    filters: { organizationId: org.organizationId, subscriptionId: query.subscriptionId, batchNames: query.batchNames },
    schoolName: org.name,
    scopeLabel: query.subscriptionId ? "batch" : undefined,
  });

  await writeAuditLog({
    actorUid: req.portalUser!.uid,
    actorRole: "SUPER_ADMIN",
    action: "CODES_EXPORTED",
    organizationId: org.organizationId,
    targetType: "organization",
    targetId: org.organizationId,
    metadata: {
      subscriptionId: query.subscriptionId ?? null,
      batchNames: query.batchNames ?? null,
      rows: workbook.rowCount,
      unavailable: workbook.unavailableCount,
    },
  });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${workbook.filename}"`);
  res.setHeader("X-Codes-Rows", String(workbook.rowCount));
  res.setHeader("X-Codes-Unavailable", String(workbook.unavailableCount));
  return res.status(200).send(workbook.buffer);
}

export async function suspendOrganization(req: PortalRequest, res: Response) {
  await organizationService.setOrganizationStatus(req.params.organizationId, "SUSPENDED", req.portalUser!.uid);
  return ok(res, { suspended: true });
}

export async function reactivateOrganization(req: PortalRequest, res: Response) {
  await organizationService.setOrganizationStatus(req.params.organizationId, "ACTIVE", req.portalUser!.uid);
  return ok(res, { reactivated: true });
}

export async function renewOrganization(req: PortalRequest, res: Response) {
  const result = await organizationService.renewSubscription(req.params.organizationId, req.body, req.portalUser!.uid);
  return ok(res, result);
}

export async function listOrganizationBatches(req: PortalRequest, res: Response) {
  const batches = await batchService.listOrganizationBatches(req.params.organizationId);
  return ok(res, batches);
}

export async function listSubscriptionHistory(req: PortalRequest, res: Response) {
  const history = await batchService.listSubscriptionHistory(req.params.organizationId);
  return ok(res, history);
}

export async function cancelOrganization(req: PortalRequest, res: Response) {
  await organizationService.cancelSubscription(req.params.organizationId, req.portalUser!.uid);
  return ok(res, { cancelled: true });
}

export async function extendOrganization(req: PortalRequest, res: Response) {
  await organizationService.extendSubscription(req.params.organizationId, req.body.newExpiresAt, req.portalUser!.uid);
  return ok(res, { extended: true });
}

export async function increaseSeats(req: PortalRequest, res: Response) {
  await organizationService.increaseSeats(req.params.organizationId, req.body.additionalSeats, req.portalUser!.uid);
  return ok(res, { updated: true });
}

export async function listLicenses(req: PortalRequest, res: Response) {
  const licenses = await listOrganizationLicenses(req.params.organizationId);
  const { status, search = "", page = 1, pageSize = 10 } = req.query as {
    status?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  };
  const needle = String(search).trim().toLowerCase();
  let rows = licenses.map((license) => ({
      ...license,
      parentName: license.parentName ?? null,
      parentEmail: license.parentEmail ?? null,
      createdAtMillis: timestampMillis(license.createdAt),
    }));

  rows = rows.filter((license) => {
    const licenseStatus = String(license.status);
    const matchesStatus = status ? licenseStatus === status : licenseStatus !== "DELETED";
    const matchesSearch =
      !needle ||
      license.licenseId.toLowerCase().includes(needle) ||
      (license.studentName ?? "").toLowerCase().includes(needle) ||
      (license.studentIdentifier ?? "").toLowerCase().includes(needle);
    return matchesStatus && matchesSearch;
  });

  rows.sort((a, b) => b.createdAtMillis - a.createdAtMillis);

  const numericPage = Number(page);
  const numericPageSize = Number(pageSize);
  const total = rows.length;
  const items = rows
    .slice((numericPage - 1) * numericPageSize, numericPage * numericPageSize)
    .map(({ createdAtMillis: _createdAtMillis, ...license }) => license);

  return ok(res, {
    items,
    total,
    page: numericPage,
    pageSize: numericPageSize,
    totalPages: Math.max(1, Math.ceil(total / numericPageSize)),
  });
}

export async function generateLicenses(req: PortalRequest, res: Response) {
  const input = { organizationId: req.params.organizationId, ...req.body };
  const result = req.body.planDuration
    ? await codeGenerationService.createSubscriptionAndGenerateCodes(input, req.portalUser!.uid)
    : // The codes email goes out after the response, so the admin sees the codes at once.
      await codeGenerationService.generateCodesForOrganization(input, req.portalUser!.uid, { emailInBackground: true });
  // Plaintext codes are shown here once and emailed to the school. When the code vault is
  // configured the school can also download them later from its portal.
  const warning = isCodeVaultEnabled()
    ? "Download these activation codes now. The school can also download them later from Download Codes in its portal."
    : "Download these activation codes now. Full codes cannot be viewed again after leaving this page.";
  return ok(res, result, { warning }, 201);
}

export async function listAllCodes(req: PortalRequest, res: Response) {
  const result = await codeGenerationService.listCodeRows(req.query as any);
  return ok(res, result);
}

export async function revokeLicense(req: PortalRequest, res: Response) {
  await codeGenerationService.revokeLicense(req.params.licenseId, req.body.reason, req.portalUser!.uid);
  return ok(res, { revoked: true });
}

export async function replaceLicense(req: PortalRequest, res: Response) {
  const result = await codeGenerationService.replaceLicense(req.params.licenseId, req.body.reason, req.portalUser!.uid);
  return ok(res, result, { warning: "Download the replacement code now. It cannot be viewed again after leaving this page." }, 201);
}

export async function deleteLicense(req: PortalRequest, res: Response) {
  await codeGenerationService.deleteLicense(req.params.licenseId, req.portalUser!.uid);
  return ok(res, { deleted: true });
}

export async function deleteBatch(req: PortalRequest, res: Response) {
  const result = await codeGenerationService.deleteCodeBatch({
    organizationId: req.params.organizationId,
    batchName: req.params.batchName,
    confirmSchoolName: req.body.confirmSchoolName,
    actorUid: req.portalUser!.uid,
  });
  return ok(res, result);
}

export async function deleteOrganization(req: PortalRequest, res: Response) {
  await organizationService.deleteOrganization(req.params.organizationId, req.portalUser!.uid);
  return ok(res, { archived: true });
}

export async function listStudents(req: PortalRequest, res: Response) {
  const licenses = await listOrganizationLicenses(req.params.organizationId);
  const students = licenses
    .filter((l) => l.status === "ACTIVE" || l.status === "EXPIRED" || l.status === "REVOKED")
    .map((l) => ({
      studentName: l.studentName,
      studentIdentifier: l.studentIdentifier,
      studentEmail: l.studentEmail,
      parentName: l.parentName ?? null,
      parentEmail: l.parentEmail ?? null,
      parentPhone: l.parentPhone ?? null,
      licenseId: l.licenseId,
      deviceModel: l.deviceModel,
      redeemedAt: l.redeemedAt,
      expiresAt: l.expiresAt,
      lastActiveAt: l.lastActiveAt,
      status: l.status,
    }));
  return ok(res, students);
}
