import type { Response } from "express";
import {
  getOrganization,
  getActiveSubscription,
  listOrganizationCodes,
  listOrganizationLicenses,
  subscriptions,
  withEffectiveSubscriptionStatus,
} from "../repositories/organizationRepository";
import type { PortalRequest } from "../middleware/requirePortalUser";
import { ApiError } from "../middleware/errorHandler";
import { ok } from "../utils/apiResponse";
import { listCodeRows } from "../services/codeGenerationService";
import type { OrganizationLicense, OrganizationSubscription } from "../models/types";

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

function buildSubscriptionHistoryRow(subscription: OrganizationSubscription) {
  return {
    subscriptionId: subscription.subscriptionId,
    planDuration: subscription.planDuration,
    seatLimit: subscription.seatLimit,
    startAt: timestampToIso(subscription.startAt),
    expiresAt: timestampToIso(subscription.expiresAt),
    status: subscription.status,
    createdAt: timestampToIso(subscription.createdAt),
    sortMillis: timestampMillis(subscription.createdAt) || timestampMillis(subscription.startAt),
  };
}

export async function getDashboard(req: PortalRequest, res: Response) {
  const organizationId = req.portalUser!.organizationId!;
  const org = await getOrganization(organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  const subscription = await getActiveSubscription(organizationId);
  const [codes, licenses] = await Promise.all([
    listOrganizationCodes(organizationId),
    listOrganizationLicenses(organizationId),
  ]);
  const subscriptionStatus = subscription?.status ?? "NONE";
  const isSubscribed = subscriptionStatus === "ACTIVE";
  const subscriptionDisplayStatus = isSubscribed
    ? "Subscribed"
    : subscriptionStatus === "NONE"
      ? "Not Subscribed"
      : subscriptionStatus;
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
    subscriptionStatus,
    subscriptionDisplayStatus,
    isSubscribed,
    subscriptionId: subscription?.subscriptionId ?? null,
    plan: subscription?.planDuration ?? null,
    planDuration: subscription?.planDuration ?? null,
    status: subscriptionStatus,
    startAt: subscription?.startAt ?? null,
    expiresAt: subscription?.expiresAt ?? null,
    seatLimit: subscription?.seatLimit ?? 0,
    totalSeats: org.purchasedSeats,
    totalStudentSeats: org.purchasedSeats,
    activatedSeats: org.activatedSeats,
    totalRedeemedStudents: org.activatedSeats,
    availableSeats: org.purchasedSeats - org.activatedSeats,
    unusedCodes: codes.filter((c) => c.status === "UNUSED").length,
    revokedCodes: codes.filter((c) => c.status === "REVOKED").length,
    recentActivations,
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

export async function getSubscription(req: PortalRequest, res: Response) {
  const organizationId = req.portalUser!.organizationId!;
  const org = await getOrganization(organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  const [subscription, historySnap] = await Promise.all([
    getActiveSubscription(organizationId),
    subscriptions().where("organizationId", "==", organizationId).get(),
  ]);
  const history = historySnap.docs
    .map((doc) => withEffectiveSubscriptionStatus(doc.data() as OrganizationSubscription))
    .map(buildSubscriptionHistoryRow)
    .sort((a, b) => b.sortMillis - a.sortMillis)
    .map(({ sortMillis: _sortMillis, ...row }) => row);

  return ok(res, {
    plan: subscription?.planDuration ?? null,
    status: subscription?.status ?? "NONE",
    startAt: subscription?.startAt ?? null,
    expiresAt: subscription?.expiresAt ?? null,
    totalSeats: org.purchasedSeats,
    activatedSeats: org.activatedSeats,
    availableSeats: org.purchasedSeats - org.activatedSeats,
    allowedDevicesPerStudent: org.allowedDevicesPerStudent,
    history,
  });
}
