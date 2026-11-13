import type { Response } from "express";
import { Collections } from "../config/collections";
import { collection } from "../repositories/firestoreRepository";
import {
  getActiveSubscription,
  getEffectiveActivationCodeStatus,
  getEffectiveLicenseStatus,
  getEffectiveOrganizationStatus,
  getOrganization,
  getOrganizationSeatUsage,
  listOrganizationLicenses,
  withEffectiveSubscriptionStatus,
} from "../repositories/organizationRepository";
import { buildSeatUsage, mergeSeatUsage, EMPTY_SEAT_USAGE } from "../utils/seatAccounting";
import type { PortalRequest } from "../middleware/requirePortalUser";
import { ApiError } from "../middleware/errorHandler";
import { ok } from "../utils/apiResponse";
import * as organizationService from "../services/organizationService";
import * as codeGenerationService from "../services/codeGenerationService";
import * as batchService from "../services/batchService";
import { renderBillHtml, sendBillForOrganization } from "../services/billService";
import { writeAuditLog } from "../repositories/auditLogRepository";
import type {
  LicenseStatus,
  Organization,
  OrganizationActivationCode,
  OrganizationLicense,
  OrganizationSubscription,
} from "../models/types";

type OrganizationListRow = Organization & {
  activeCodesRemaining: number;
  organizationStatus: Organization["status"];
  subscriptionStatus: OrganizationSubscription["status"] | "NONE";
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

function buildOrganizationRow(
  org: Organization,
  subscriptionsById: Map<string, OrganizationSubscription>,
  activeCodesRemaining: number,
  now: Date
): OrganizationListRow {
  const currentSubscription = org.currentSubscriptionId ? subscriptionsById.get(org.currentSubscriptionId) ?? null : null;
  return {
    ...org,
    organizationStatus: org.status,
    subscriptionStatus: currentSubscription?.status ?? "NONE",
    status: getEffectiveOrganizationStatus(org, currentSubscription, now),
    activeCodesRemaining,
  };
}

function timestampMillis(value: unknown): number {
  if (value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as FirebaseFirestore.Timestamp).toMillis();
  }
  return 0;
}

export async function getDashboard(_req: PortalRequest, res: Response) {
  const [orgsSnap, subscriptionsSnap, licensesSnap] = await Promise.all([
    collection(Collections.organizations).get(),
    collection(Collections.organizationSubscriptions).get(),
    collection(Collections.organizationLicenses).get(),
  ]);
  const now = new Date();
  const subscriptionsById = buildEffectiveSubscriptionMap(subscriptionsSnap.docs, now);
  const orgs = orgsSnap.docs
    .map((d) => buildOrganizationRow(d.data() as Organization, subscriptionsById, 0, now))
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

  // Seat totals are derived from licenses, not from the stored purchasedSeats /
  // activatedSeats counters, so expired seats stop being counted as in-use.
  const seatUsage = orgs.reduce(
    (acc, org) =>
      mergeSeatUsage(
        acc,
        buildSeatUsage({
          effectiveStatuses: statusesByOrg.get(org.organizationId) ?? [],
          seatLimit: (org.currentSubscriptionId ? subscriptionsById.get(org.currentSubscriptionId)?.seatLimit : 0) ?? 0,
        })
      ),
    EMPTY_SEAT_USAGE
  );

  return ok(res, {
    totalSchools: orgs.length,
    activeSchools: orgs.filter((o) => o.status === "ACTIVE").length,
    expiredSchools: orgs.filter((o) => o.status === "EXPIRED").length,
    totalStudentSeats: seatUsage.totalSeats,
    activatedStudents: seatUsage.activatedSeats,
    totalStudentsJoined: seatUsage.activatedSeats,
    availableSeats: seatUsage.availableSeats,
    seatUsage,
  });
}

export async function listOrganizations(req: PortalRequest, res: Response) {
  const { search = "", status, includeArchived = false, page = 1, pageSize = 10 } = req.query as any;
  const [orgsSnap, codesSnap, subscriptionsSnap, licensesSnap] = await Promise.all([
    collection(Collections.organizations).get(),
    collection(Collections.organizationActivationCodes).get(),
    collection(Collections.organizationSubscriptions).get(),
    collection(Collections.organizationLicenses).get(),
  ]);
  const now = new Date();
  const subscriptionsById = buildEffectiveSubscriptionMap(subscriptionsSnap.docs, now);
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
    return buildOrganizationRow(org, subscriptionsById, activeCodeCounts.get(org.organizationId) ?? 0, now);
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
  const currentSubscription = await getActiveSubscription(req.params.organizationId);
  const seatUsage = await getOrganizationSeatUsage(req.params.organizationId, currentSubscription);

  return ok(res, {
    ...org,
    organizationStatus: org.status,
    subscriptionStatus: currentSubscription?.status ?? "NONE",
    status: getEffectiveOrganizationStatus(org, currentSubscription),
    currentSubscription,
    // Authoritative seat numbers. Clients render these and must not recompute
    // capacity from purchasedSeats/activatedSeats.
    seatUsage,
    purchasedSeats: seatUsage.totalSeats,
    activatedSeats: seatUsage.activatedSeats,
  });
}

/** Returns the school's bill as HTML for viewing or printing in the portal. */
export async function getOrganizationBill(req: PortalRequest, res: Response) {
  const org = await getOrganization(req.params.organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  if (!org.payment) {
    throw new ApiError(404, "BILL_NOT_FOUND", "This school has no payment record, so there is no bill.");
  }
  return ok(res, { billNumber: org.payment.billNumber, html: renderBillHtml(org, org.payment) });
}

/** Emails the school's bill to its contact email again. */
export async function sendOrganizationBill(req: PortalRequest, res: Response) {
  const org = await getOrganization(req.params.organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  if (!org.payment) {
    throw new ApiError(404, "BILL_NOT_FOUND", "This school has no payment record, so there is no bill.");
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

export async function renewOrganizationBatches(req: PortalRequest, res: Response) {
  const result = await organizationService.renewBatches(
    req.params.organizationId,
    req.body,
    req.portalUser!.uid
  );

  // No plaintext codes are ever returned here: renewal allocates seats and
  // time only. A newly allocated batch is generated from Create Codes.
  const meta =
    result.allocatedBatches.length > 0
      ? {
          warning: `Seats allocated for ${result.allocatedBatches.map((item) => `"${item.batchName}"`).join(", ")}. Generate the codes in Create Codes when ready.`,
        }
      : {};

  return ok(res, result, meta, 201);
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
    : await codeGenerationService.generateCodesForOrganization(input, req.portalUser!.uid);
  // Plaintext codes are exposed only in this generation response; the service
  // also uses the same in-memory values for the automatic school email.
  return ok(res, result, { warning: "Download these activation codes now. Full codes cannot be viewed again after leaving this page." }, 201);
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
