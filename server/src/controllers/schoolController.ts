import type { Response } from "express";
import {
  getEffectiveActivationCodeStatus,
  getEffectiveLicenseStatus,
  getEffectiveOrganizationStatus,
  getOrganization,
  isLiveBatch,
  listOrganizationLicenses,
  listOrganizationSubscriptions,
  pickPrimarySubscription,
  sumLiveSeatLimit,
  withEffectiveSubscriptionStatus,
} from "../repositories/organizationRepository";
import type { PortalRequest } from "../middleware/requirePortalUser";
import { ApiError } from "../middleware/errorHandler";
import { ok } from "../utils/apiResponse";
import { listCodeRows } from "../services/codeGenerationService";
import {
  batchLabelOf,
  buildBatchViews,
  buildPaymentView,
  listBatchSubscriptions,
  loadSchoolData,
  type BatchView,
  type SchoolData,
} from "../services/batchService";
import { buildSeatUsage } from "../utils/seatAccounting";
import { buildCodesWorkbook, isCodeVaultEnabled } from "../services/codeVaultService";
import { countUnreadNotifications, listNotifications, markNotificationsRead } from "../services/notificationService";
import { billPdfFilename, renderBillHtml, renderBillPdf } from "../services/billService";
import { writeAuditLog } from "../repositories/auditLogRepository";
import { findIssuedBill } from "../services/paymentSchedule";
import type { Organization, OrganizationLicense, OrganizationSubscription } from "../models/types";

function timestampToIso(value: unknown): string | null {
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as FirebaseFirestore.Timestamp).toDate().toISOString();
  }
  if (typeof value === "string") return value;
  return null;
}

function timestampMillis(value: unknown): number {
  if (value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as FirebaseFirestore.Timestamp).toMillis();
  }
  if (typeof value === "string") {
    const millis = new Date(value).getTime();
    return Number.isNaN(millis) ? 0 : millis;
  }
  return 0;
}

function parsePagination(query: { page?: unknown; pageSize?: unknown }) {
  const page = Math.max(1, Number(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 10)));
  return { page, pageSize };
}

function buildStudentRow(license: OrganizationLicense) {
  return {
    studentName: license.studentName,
    studentIdentifier: license.studentIdentifier,
    studentEmail: license.studentEmail,
    parentName: license.parentName ?? null,
    parentEmail: license.parentEmail ?? null,
    parentPhone: license.parentPhone ?? null,
    licenseId: license.licenseId,
    deviceModel: license.deviceModel,
    redeemedAt: timestampToIso(license.redeemedAt),
    expiresAt: timestampToIso(license.expiresAt),
    lastActiveAt: timestampToIso(license.lastActiveAt),
    status: license.status,
    redeemedAtMillis: timestampMillis(license.redeemedAt),
  };
}

const ENDING_SOON_DAYS = 14;

/**
 * How the school's status follows its batches, in plain words for the portal.
 * SUSPENDED/ARCHIVED are admin decisions and say so.
 */
function explainStatus(org: Organization, subscriptions: OrganizationSubscription[], now: Date) {
  const status = getEffectiveOrganizationStatus(org, subscriptions, now);
  const live = subscriptions.filter((subscription) => isLiveBatch(subscription, now)).length;
  const total = subscriptions.length;
  if (status === "SUSPENDED") return "Your school is suspended. Contact CensorX to reactivate it.";
  if (status === "ARCHIVED") return "Your school has been archived.";
  if (total === 0) return "No batch has been set up yet. Contact CensorX to start one.";
  if (status === "ACTIVE") {
    return live === total
      ? `Active: ${live === 1 ? "your batch is" : `all ${live} batches are`} live.`
      : `Active: ${live} of ${total} batch${total === 1 ? "" : "es"} ${live === 1 ? "is" : "are"} live. Students in an ended batch cannot use the app until it is renewed.`;
  }
  return "Expired: every batch has ended. Contact CensorX to renew — the same codes will work again.";
}

function endingSoon(batches: BatchView[]) {
  return batches
    .filter((batch) => batch.isLive && batch.daysRemaining <= ENDING_SOON_DAYS)
    .map((batch) => ({
      subscriptionId: batch.subscriptionId,
      batchLabel: batch.batchLabel,
      expiresAt: batch.expiresAt,
      daysRemaining: Math.max(0, batch.daysRemaining),
      classes: batch.classes.map((item) => item.batchName),
    }));
}

/**
 * Everything the school's Dashboard and Subscription pages show, from ONE read of each of the
 * school's batches, codes, licences and classes (codes and licences trimmed to a few fields).
 * Same numbers as before; it used to read the codes up to 2 and the licences up to 4 times.
 */
function schoolOverview(data: SchoolData, now: Date) {
  const rawById = new Map(data.subscriptions.map((item) => [item.subscriptionId, item]));
  const subscriptions = data.subscriptions
    .map((item) => withEffectiveSubscriptionStatus(item, now))
    .sort((a, b) => timestampMillis(a.createdAt) - timestampMillis(b.createdAt));
  const licenses = Array.from(data.licenseById.values()).map((license) => ({
    ...license,
    status: getEffectiveLicenseStatus(license, rawById.get(license.subscriptionId), now),
  }));
  const seatUsage = buildSeatUsage({
    effectiveStatuses: licenses.map((license) => license.status),
    seatLimit: sumLiveSeatLimit(subscriptions),
  });
  const codeStatuses = data.codes.map((code) =>
    getEffectiveActivationCodeStatus(code, rawById.get(code.subscriptionId), data.licenseById.get(code.licenseId), now)
  );
  const batches = buildBatchViews(data, { audience: "school", now });
  return { subscriptions, licenses, seatUsage, codeStatuses, batches };
}

export async function getDashboard(req: PortalRequest, res: Response) {
  const organizationId = req.portalUser!.organizationId!;
  const org = await getOrganization(organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  const now = new Date();
  const [data, unreadNotifications] = await Promise.all([
    loadSchoolData(organizationId, { withStudentDetails: true }),
    countUnreadNotifications(organizationId),
  ]);
  const { subscriptions, licenses, seatUsage, codeStatuses, batches } = schoolOverview(data, now);

  const organizationStatus = getEffectiveOrganizationStatus(org, subscriptions, now);
  const primary = pickPrimarySubscription(subscriptions, now);
  const liveBatches = batches.filter((batch) => batch.isLive);
  // The "valid until" shown on the dashboard is the soonest end among live batches, so the
  // school is never told a later date than the one that affects some of its students.
  const soonestLive = liveBatches.reduce<BatchView | null>(
    (best, candidate) => (!best || (candidate.expiresAt ?? "") < (best.expiresAt ?? "") ? candidate : best),
    null
  );
  const subscriptionStatus = liveBatches.length > 0 ? "ACTIVE" : primary ? primary.status : "NONE";
  const isSubscribed = subscriptionStatus === "ACTIVE";
  const subscriptionDisplayStatus = isSubscribed ? "Subscribed" : subscriptionStatus === "NONE" ? "Not Subscribed" : subscriptionStatus;

  const recentActivations = licenses
    .filter((license) => !!license.redeemedAt)
    .sort((a, b) => timestampMillis(b.redeemedAt) - timestampMillis(a.redeemedAt))
    .slice(0, 10)
    .map((license) => ({
      licenseId: license.licenseId,
      studentName: license.studentName,
      studentIdentifier: license.studentIdentifier,
      studentEmail: license.studentEmail,
      redeemedAt: timestampToIso(license.redeemedAt),
      status: license.status,
    }));

  return ok(res, {
    schoolName: org.name,
    schoolIdentifier: org.identifier,
    organizationStatus,
    statusExplanation: explainStatus(org, subscriptions, now),
    subscriptionStatus,
    subscriptionDisplayStatus,
    isSubscribed,
    subscriptionId: primary?.subscriptionId ?? null,
    plan: primary?.planDuration ?? null,
    planDuration: primary?.planDuration ?? null,
    status: subscriptionStatus,
    startAt: primary?.startAt ?? null,
    expiresAt: soonestLive?.expiresAt ?? primary?.expiresAt ?? null,
    nextEndingBatch: soonestLive
      ? { subscriptionId: soonestLive.subscriptionId, batchLabel: soonestLive.batchLabel, expiresAt: soonestLive.expiresAt, daysRemaining: soonestLive.daysRemaining }
      : null,
    liveBatchCount: liveBatches.length,
    batchCount: batches.filter((batch) => batch.isCurrentPeriod).length,
    endingSoon: endingSoon(batches),
    unreadNotifications,
    seatLimit: seatUsage.seatLimit,
    totalSeats: seatUsage.totalSeats,
    totalStudentSeats: seatUsage.totalSeats,
    activatedSeats: seatUsage.activatedSeats,
    totalRedeemedStudents: seatUsage.activatedSeats,
    availableSeats: seatUsage.availableSeats,
    unusedCodes: codeStatuses.filter((status) => status === "UNUSED").length,
    revokedCodes: codeStatuses.filter((status) => status === "REVOKED").length,
    seatUsage,
    recentActivations,
    codeVaultEnabled: isCodeVaultEnabled(),
  });
}

export async function getCodes(req: PortalRequest, res: Response) {
  const organizationId = req.portalUser!.organizationId!;
  const result = await listCodeRows({ ...(req.query as any), organizationId });
  return ok(res, result);
}

export async function getStudents(req: PortalRequest, res: Response) {
  const organizationId = req.portalUser!.organizationId!;
  const licenses = await listOrganizationLicenses(organizationId);
  const filters = req.query as { search?: string; status?: "ACTIVE" | "REVOKED" | "EXPIRED"; page?: number; pageSize?: number };
  const { page, pageSize } = parsePagination(filters);
  const search = filters.search?.trim().toLowerCase() ?? "";

  let rows = licenses
    .filter((license) => license.status === "ACTIVE" || license.status === "EXPIRED" || license.status === "REVOKED")
    .map(buildStudentRow);

  rows = rows.filter((row) => {
    const matchesStatus = !filters.status || row.status === filters.status;
    const matchesSearch =
      !search ||
      (row.studentName ?? "").toLowerCase().includes(search) ||
      (row.studentIdentifier ?? "").toLowerCase().includes(search);
    return matchesStatus && matchesSearch;
  });

  rows.sort((a, b) => b.redeemedAtMillis - a.redeemedAtMillis);

  const total = rows.length;
  const items = rows
    .slice((page - 1) * pageSize, page * pageSize)
    .map(({ redeemedAtMillis: _redeemedAtMillis, ...row }) => row);

  return ok(res, {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}

/**
 * The school's subscription as its batches: each batch with its own dates, status, classes,
 * seats and payment, plus how the school's overall status follows from them.
 */
export async function getSubscription(req: PortalRequest, res: Response) {
  const organizationId = req.portalUser!.organizationId!;
  const org = await getOrganization(organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  const now = new Date();
  const { subscriptions, seatUsage, batches } = schoolOverview(await loadSchoolData(organizationId), now);

  const primary = pickPrimarySubscription(subscriptions, now);
  const liveBatches = batches.filter((batch) => batch.isLive);
  const organizationStatus = getEffectiveOrganizationStatus(org, subscriptions, now);

  // History rows for the simple list: newest first.
  const history = batches
    .map((batch) => ({
      subscriptionId: batch.subscriptionId,
      batchLabel: batch.batchLabel,
      planDuration: batch.planDuration,
      seatLimit: batch.seatLimit,
      startAt: batch.startAt,
      expiresAt: batch.expiresAt,
      status: batch.status,
      createdAt: batch.createdAt,
    }))
    .sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt));

  return ok(res, {
    organizationStatus,
    statusExplanation: explainStatus(org, subscriptions, now),
    liveBatchCount: liveBatches.length,
    batchCount: batches.filter((batch) => batch.isCurrentPeriod).length,
    endingSoon: endingSoon(batches),
    batches,
    // Legacy summary fields, kept for older clients.
    plan: primary?.planDuration ?? null,
    status: liveBatches.length > 0 ? "ACTIVE" : primary?.status ?? "NONE",
    startAt: primary?.startAt ?? null,
    expiresAt: primary?.expiresAt ?? null,
    seatLimit: seatUsage.seatLimit,
    totalSeats: seatUsage.totalSeats,
    activatedSeats: seatUsage.activatedSeats,
    availableSeats: seatUsage.availableSeats,
    seatUsage,
    allowedDevicesPerStudent: org.allowedDevicesPerStudent,
    /** Legacy school-level payment, for schools billed before batches existed. */
    payment: buildPaymentView(org.payment, "school"),
    history,
  });
}

/** The school's batches, each with classes, dates, seats and payment summary. */
export async function getBatches(req: PortalRequest, res: Response) {
  const organizationId = req.portalUser!.organizationId!;
  const batches = await listBatchSubscriptions(organizationId, { audience: "school" });
  return ok(res, batches);
}

/** One of the school's own batches, its payment and the requested bill (first invoice by default). */
async function loadSchoolBill(req: PortalRequest) {
  const organizationId = req.portalUser!.organizationId!;
  const org = await getOrganization(organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  const subscriptions = await listOrganizationSubscriptions(organizationId);
  const subscription = subscriptions.find((item) => item.subscriptionId === req.params.subscriptionId);
  if (!subscription) throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "Batch not found.");
  if (!subscription.payment) throw new ApiError(404, "BILL_NOT_FOUND", "No bill was issued for this batch.");
  const bill = findIssuedBill(subscription.payment, (req.query as { billNumber?: string }).billNumber);
  if (!bill) throw new ApiError(404, "BILL_NOT_FOUND", "That bill was not found.");
  return { org, subscription, payment: subscription.payment, billNumber: bill.billNumber };
}

/** A bill of one of the school's batches, as HTML for viewing or printing. */
export async function getBatchBill(req: PortalRequest, res: Response) {
  const { org, subscription, payment, billNumber } = await loadSchoolBill(req);
  return ok(res, { billNumber, batchLabel: batchLabelOf(subscription), html: renderBillHtml(org, payment, { billNumber }) });
}

/** A bill of one of the school's batches as a PDF download. */
export async function getBatchBillPdf(req: PortalRequest, res: Response) {
  const { org, payment, billNumber } = await loadSchoolBill(req);
  const pdf = await renderBillPdf(org, payment, billNumber);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${billPdfFilename(payment, billNumber)}"`);
  return res.status(200).send(pdf);
}

export async function getNotifications(req: PortalRequest, res: Response) {
  const organizationId = req.portalUser!.organizationId!;
  const result = await listNotifications(organizationId, req.query as { page?: number; pageSize?: number });
  return ok(res, result);
}

export async function readNotifications(req: PortalRequest, res: Response) {
  const organizationId = req.portalUser!.organizationId!;
  const updated = await markNotificationsRead(organizationId, (req.body as { notificationIds?: string[] }).notificationIds);
  return ok(res, { updated });
}

/**
 * Full activation codes as an .xlsx file: everything, one batch, or chosen classes. Requires a
 * recent password entry (see requireRecentLogin). Used codes are included; revoked, replaced
 * and deleted ones are left out.
 */
export async function exportCodes(req: PortalRequest, res: Response) {
  const organizationId = req.portalUser!.organizationId!;
  const org = await getOrganization(organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  if (!isCodeVaultEnabled()) {
    throw new ApiError(503, "CODE_VAULT_DISABLED", "Code download is not available yet. Please contact CensorX for your codes.");
  }
  const query = req.query as { subscriptionId?: string; batchNames?: string[] };

  let scopeLabel: string | undefined;
  if (query.subscriptionId) {
    const subscriptions = await listOrganizationSubscriptions(organizationId);
    const subscription = subscriptions.find((item) => item.subscriptionId === query.subscriptionId);
    if (!subscription) throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "Batch not found.");
    scopeLabel = batchLabelOf(subscription);
  }

  const workbook = await buildCodesWorkbook({
    filters: { organizationId, subscriptionId: query.subscriptionId, batchNames: query.batchNames },
    schoolName: org.name,
    scopeLabel,
  });

  await writeAuditLog({
    actorUid: req.portalUser!.uid,
    actorRole: "SCHOOL_ADMIN",
    action: "CODES_EXPORTED",
    organizationId,
    targetType: "organization",
    targetId: organizationId,
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
