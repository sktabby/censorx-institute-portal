import { Timestamp } from "firebase-admin/firestore";
import ExcelJS from "exceljs";
import { Collections } from "../config/collections";
import { logger } from "../config/logger";
import { db, newDocId, serverTimestamp } from "../repositories/firestoreRepository";
import {
  getOrganization,
  getActiveSubscription,
  getCurrentSubscription,
  getEffectiveActivationCodeStatus,
} from "../repositories/organizationRepository";
import { writeAuditLog } from "../repositories/auditLogRepository";
import { ApiError } from "../middleware/errorHandler";
import { hashFromRawCode } from "./codeCryptoService";
import { planDurationToMs } from "../utils/planDuration";
import { isSchoolNameConfirmationValid } from "../utils/deleteGuards";
import { buildPlaintextCodesForMode, type PlaintextCodeEntry } from "../utils/codeGenerationModes";
import { sendActivationCodesEmail } from "./emailService";
import type { CreateCodesWithSubscriptionInput, GenerateCodesInput } from "../types/serviceInputs";
import type {
  ActivationCodeStatus,
  LicenseStatus,
  Organization,
  OrganizationActivationCode,
  OrganizationLicense,
  OrganizationSubscription,
} from "../models/types";

export interface GeneratedCodeResult {
  plaintextCode: string;
  codeLast4: string;
  licenseId: string;
  studentIdentifier?: string | null;
}

export interface CodeEmailDeliveryResult {
  sent: boolean;
  to: string;
  warning?: string;
}

export interface GenerateCodesResult {
  batchName: string;
  codes: GeneratedCodeResult[];
  emailDelivery?: CodeEmailDeliveryResult;
}

export interface CodeListRow {
  licenseId: string;
  organizationId: string;
  schoolName: string;
  maskedCode: string;
  codeLast4: string;
  status: ActivationCodeStatus;
  batchName: string | null;
  studentIdentifier: string | null;
  studentEmail: string | null;
  createdAt: string | null;
  redeemedAt: string | null;
}

export interface CodeListFilters {
  organizationId?: string;
  status?: ActivationCodeStatus;
  batchName?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

function maskCode(last4: string) {
  return `****-${last4}`;
}

function timestampToIso(value: unknown): string | null {
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as FirebaseFirestore.Timestamp).toDate().toISOString();
  }
  return null;
}

function getTimestampMillis(value: unknown): number {
  if (value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as FirebaseFirestore.Timestamp).toMillis();
  }
  return 0;
}

function parsePagination(filters: CodeListFilters) {
  const page = Math.max(1, Number(filters.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize ?? 10)));
  return { page, pageSize };
}

function buildCodeEntries(input: GenerateCodesInput, org: Organization): PlaintextCodeEntry[] {
  if (input.codes) {
    if (input.codes.length !== input.numberOfCodes) {
      throw new ApiError(400, "CODE_COUNT_MISMATCH", "Provided code count must match numberOfCodes.");
    }
    const identifiers = input.studentIdentifiers?.map((id) => id.trim().toUpperCase()) ?? [];
    return input.codes.map((code, index) => ({
      plaintextCode: code.toUpperCase(),
      studentIdentifier: identifiers[index] ?? null,
    }));
  }

  return buildPlaintextCodesForMode({
    schoolName: org.name,
    numberOfCodes: input.numberOfCodes,
    codeGenerationMode: input.codeGenerationMode,
    studentIdentifiers: input.studentIdentifiers,
  });
}

function safeAttachmentName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "activation-codes";
}

async function buildActivationCodesWorkbook(input: {
  codes: GeneratedCodeResult[];
  batchName: string;
  expiresAt: FirebaseFirestore.Timestamp;
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CensorX";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Activation Codes");
  worksheet.columns = [
    { header: "Serial number", key: "serialNumber", width: 16 },
    { header: "Student activation code", key: "studentActivationCode", width: 28 },
    { header: "Code last four", key: "codeLastFour", width: 16 },
    { header: "License ID", key: "licenseId", width: 28 },
    { header: "Expiry date", key: "expiryDate", width: 16 },
    { header: "Batch name", key: "batchName", width: 24 },
  ];
  worksheet.getRow(1).font = { bold: true };

  const expiryDate = input.expiresAt.toDate().toISOString().slice(0, 10);
  input.codes.forEach((code, index) => {
    worksheet.addRow({
      serialNumber: index + 1,
      studentActivationCode: code.plaintextCode,
      codeLastFour: code.codeLast4,
      licenseId: code.licenseId,
      expiryDate,
      batchName: input.batchName,
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

async function sendGeneratedCodesEmail(input: {
  org: Organization;
  batchName: string;
  subscription: OrganizationSubscription;
  codes: GeneratedCodeResult[];
}): Promise<CodeEmailDeliveryResult> {
  try {
    const attachment = await buildActivationCodesWorkbook({
      codes: input.codes,
      batchName: input.batchName,
      expiresAt: input.subscription.expiresAt,
    });
    await sendActivationCodesEmail({
      to: input.org.contactEmail,
      schoolName: input.org.name,
      batchName: input.batchName,
      attachment: {
        filename: `${safeAttachmentName(input.org.name)}-${safeAttachmentName(input.batchName)}-activation-codes.xlsx`,
        content: attachment,
      },
    });
    return { sent: true, to: input.org.contactEmail };
  } catch (err) {
    logger.warn(
      { err, organizationId: input.org.organizationId, batchName: input.batchName, to: input.org.contactEmail },
      "Activation code email could not be sent"
    );
    return {
      sent: false,
      to: input.org.contactEmail,
      warning:
        "Codes generated successfully, but the email to the school could not be sent. Please download the CSV and share it manually.",
    };
  }
}

function resolvePlanWindow(input: CreateCodesWithSubscriptionInput) {
  if (input.planDuration === "CUSTOM") {
    if (!input.startAt || !input.expiresAt) {
      throw new ApiError(400, "CUSTOM_DATES_REQUIRED", "Custom plans require start and expiry dates.");
    }
    const startAt = new Date(input.startAt);
    const expiresAt = new Date(input.expiresAt);
    if (expiresAt.getTime() <= startAt.getTime()) {
      throw new ApiError(400, "INVALID_PLAN_DATES", "Expiry date must be after start date.");
    }
    return { startAt, expiresAt };
  }

  const durationMs = planDurationToMs(input.planDuration);
  if (!durationMs) throw new ApiError(400, "INVALID_PLAN_DURATION", "Invalid plan duration.");
  const startAt = new Date();
  return { startAt, expiresAt: new Date(startAt.getTime() + durationMs) };
}

async function countUnusedCodes(organizationId: string) {
  const existingCodesSnap = await db
    .collection(Collections.organizationActivationCodes)
    .where("organizationId", "==", organizationId)
    .where("status", "==", "UNUSED")
    .get();
  return existingCodesSnap.size;
}

/**
 * Uses an existing effective-active subscription when one exists. Only schools
 * with no usable current subscription are bootstrapped with a new subscription.
 */
export async function createSubscriptionAndGenerateCodes(
  input: CreateCodesWithSubscriptionInput,
  actorUid: string
): Promise<GenerateCodesResult & { subscriptionId: string }> {
  const org = await getOrganization(input.organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  if (org.status === "ARCHIVED") {
    throw new ApiError(409, "ORG_ARCHIVED", "This school has been archived. Codes cannot be generated.");
  }

  const idempotencyRef = db.collection(Collections.organizationAuditLogs).doc(`idem_${input.idempotencyKey}`);
  if ((await idempotencyRef.get()).exists) {
    throw new ApiError(409, "DUPLICATE_REQUEST", "This code generation request has already been processed.");
  }

  const activeSubscription = await getActiveSubscription(input.organizationId);
  const nowMillis = Date.now();
  const shouldUseExistingSubscription =
    !!activeSubscription &&
    activeSubscription.status === "ACTIVE" &&
    activeSubscription.expiresAt.toMillis() > nowMillis;

  if (shouldUseExistingSubscription) {
    const generated = await generateCodesForOrganization(
      {
        ...input,
        subscriptionId: activeSubscription.subscriptionId,
      },
      actorUid
    );
    return { ...generated, subscriptionId: activeSubscription.subscriptionId };
  }

  const { startAt, expiresAt } = resolvePlanWindow(input);
  const storedCurrentSubscription = activeSubscription
    ? await getCurrentSubscription(input.organizationId, { effectiveStatus: false })
    : null;
  const existingUnusedCodes = await countUnusedCodes(input.organizationId);
  const seatLimit = org.activatedSeats + existingUnusedCodes + input.numberOfCodes;
  const subscriptionId = newDocId(Collections.organizationSubscriptions);

  await db.runTransaction(async (tx) => {
    const orgRef = db.collection(Collections.organizations).doc(input.organizationId);
    const subscriptionRef = db.collection(Collections.organizationSubscriptions).doc(subscriptionId);
    const now = serverTimestamp();

    tx.set(subscriptionRef, {
      subscriptionId,
      organizationId: input.organizationId,
      planDuration: input.planDuration,
      startAt: Timestamp.fromDate(startAt),
      expiresAt: Timestamp.fromDate(expiresAt),
      seatLimit,
      status: "ACTIVE",
      billingReference: null,
      notes: input.notes ?? null,
      createdAt: now,
      createdBy: actorUid,
      updatedAt: now,
      renewedFromSubscriptionId: activeSubscription?.subscriptionId ?? null,
    });

    if (activeSubscription) {
      tx.update(db.collection(Collections.organizationSubscriptions).doc(activeSubscription.subscriptionId), {
        status: storedCurrentSubscription?.status === "ACTIVE" ? "RENEWED" : storedCurrentSubscription?.status ?? activeSubscription.status,
        updatedAt: now,
      });
    }

    tx.update(orgRef, {
      currentSubscriptionId: subscriptionId,
      purchasedSeats: seatLimit,
      status: "ACTIVE",
      updatedAt: now,
      updatedBy: actorUid,
    });
  });

  const persistedSubscription = await getActiveSubscription(input.organizationId);
  if (!persistedSubscription || persistedSubscription.subscriptionId !== subscriptionId) {
    throw new ApiError(
      500,
      "SUBSCRIPTION_LINK_FAILED",
      "Subscription was created but could not be linked to the school. Please retry code generation."
    );
  }

  const generated = await generateCodesForOrganization(
    {
      ...input,
      subscriptionId,
    },
    actorUid
  );

  return { ...generated, subscriptionId };
}

/**
 * Generates N activation codes for an organization. Performs all
 * pre-flight validation, then writes one license + one activation-code
 * doc per code inside a single Firestore transaction. Plaintext codes
 * are returned ONLY from this function call - never stored, never
 * retrievable again.
 */
export async function generateCodesForOrganization(
  input: GenerateCodesInput,
  actorUid: string,
  options: { emailSchoolCodes?: boolean } = {}
): Promise<GenerateCodesResult> {
  const org = await getOrganization(input.organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");

  if (!input.subscriptionId) {
    throw new ApiError(400, "SUBSCRIPTION_REQUIRED", "A subscription is required to generate codes.");
  }

  if (org.status === "SUSPENDED") {
    throw new ApiError(409, "ORG_SUSPENDED", "This school is suspended. Codes cannot be generated.");
  }
  if (org.status === "ARCHIVED") {
    throw new ApiError(409, "ORG_ARCHIVED", "This school has been archived. Codes cannot be generated.");
  }
  if (org.status === "EXPIRED") {
    throw new ApiError(409, "ORG_EXPIRED", "This school's access has expired. Codes cannot be generated.");
  }

  const subscription = await getActiveSubscription(input.organizationId);
  if (!subscription || subscription.subscriptionId !== input.subscriptionId) {
    throw new ApiError(409, "SUBSCRIPTION_MISMATCH", "The selected subscription is not the active subscription.");
  }
  if (subscription.expiresAt.toMillis() <= Date.now()) {
    throw new ApiError(409, "SUBSCRIPTION_EXPIRED", "The subscription has expired.");
  }
  if (subscription.status !== "ACTIVE") {
    throw new ApiError(409, "SUBSCRIPTION_INACTIVE", "The subscription is not active.");
  }

  const idempotencyRef = db.collection(Collections.organizationAuditLogs).doc(`idem_${input.idempotencyKey}`);
  if ((await idempotencyRef.get()).exists) {
    throw new ApiError(409, "DUPLICATE_REQUEST", "This code generation request has already been processed.");
  }

  const existingUnusedCodes = await countUnusedCodes(input.organizationId);
  const remainingCapacity = subscription.seatLimit - org.activatedSeats - existingUnusedCodes;

  if (input.numberOfCodes <= 0) {
    throw new ApiError(400, "INVALID_QUANTITY", "Requested quantity is invalid.");
  }
  if (input.numberOfCodes > remainingCapacity) {
    throw new ApiError(
      409,
      "CAPACITY_EXCEEDED",
      `Requested quantity (${input.numberOfCodes}) exceeds remaining seat capacity (${remainingCapacity}).`
    );
  }

  const batchName = input.batchName ?? `batch-${Date.now()}`;
  const plainEntries = buildCodeEntries(input, org);
  const seenHashes = new Set<string>();
  const hashedEntries = plainEntries.map((entry) => {
    const derived = hashFromRawCode(entry.plaintextCode);
    if (seenHashes.has(derived.hash)) {
      throw new ApiError(400, "DUPLICATE_CODE", "Duplicate generated code detected.");
    }
    seenHashes.add(derived.hash);
    return { ...entry, hash: derived.hash, last4: derived.last4 };
  });

  for (const entry of hashedEntries) {
    const existing = await db.collection(Collections.organizationActivationCodes).doc(entry.hash).get();
    if (existing.exists) {
      throw new ApiError(409, "CODE_ALREADY_EXISTS", "One of the generated codes already exists.");
    }
  }

  const results: GeneratedCodeResult[] = hashedEntries.map((entry) => ({
    plaintextCode: entry.plaintextCode,
    codeLast4: entry.last4,
    licenseId: "",
    studentIdentifier: entry.studentIdentifier,
  }));

  await db.runTransaction(async (tx) => {
    tx.set(idempotencyRef, {
      auditId: idempotencyRef.id,
      actorUid,
      actorRole: "SUPER_ADMIN",
      action: "CODE_GENERATION_IDEMPOTENCY_LOCK",
      organizationId: input.organizationId,
      targetType: "codeBatch",
      targetId: batchName,
      metadata: { numberOfCodes: input.numberOfCodes },
      createdAt: serverTimestamp(),
    });

    hashedEntries.forEach((entry, index) => {
      const licenseId = newDocId(Collections.organizationLicenses);
      const licenseRef = db.collection(Collections.organizationLicenses).doc(licenseId);
      const codeRef = db.collection(Collections.organizationActivationCodes).doc(entry.hash);
      const studentIdentifier =
        entry.studentIdentifier ?? (input.studentIdentifierPrefix ? `${input.studentIdentifierPrefix}-${index + 1}` : null);

      tx.set(licenseRef, {
        licenseId,
        organizationId: input.organizationId,
        subscriptionId: input.subscriptionId,
        status: "UNUSED",
        studentUid: null,
        studentIdentifier,
        studentName: null,
        studentEmail: null,
        parentName: null,
        parentEmail: null,
        parentPhone: null,
        deviceId: null,
        deviceFingerprint: null,
        deviceModel: null,
        redeemedAt: null,
        expiresAt: subscription.expiresAt,
        lastActiveAt: null,
        revokedAt: null,
        revokedBy: null,
        revocationReason: null,
        createdAt: serverTimestamp(),
        createdBy: actorUid,
        updatedAt: serverTimestamp(),
      });

      tx.create(codeRef, {
        codeHash: entry.hash,
        codeLast4: entry.last4,
        licenseId,
        organizationId: input.organizationId,
        subscriptionId: input.subscriptionId,
        batchName,
        status: "UNUSED",
        createdAt: serverTimestamp(),
        createdBy: actorUid,
        redeemedAt: null,
        replacedAt: null,
        replacedBy: null,
      });

      results[index].licenseId = licenseId;
    });
  });

  await writeAuditLog({
    actorUid,
    actorRole: "SUPER_ADMIN",
    action: "CODES_GENERATED",
    organizationId: input.organizationId,
    targetType: "codeBatch",
    targetId: batchName,
    metadata: { numberOfCodes: input.numberOfCodes, batchName, codeGenerationMode: input.codeGenerationMode ?? "RANDOM" },
  });

  const shouldEmailSchoolCodes = options.emailSchoolCodes ?? true;
  const emailDelivery = shouldEmailSchoolCodes
    ? await sendGeneratedCodesEmail({ org, batchName, subscription, codes: results })
    : undefined;

  // Plaintext activation codes exist only in memory during this request. This
  // automatic email plus the one-time browser response are the only transmission
  // paths; lost codes are handled by replaceLicense(), never by re-reading codes.
  return { batchName, codes: results, emailDelivery };
}

export async function listCodeRows(filters: CodeListFilters) {
  const { page, pageSize } = parsePagination(filters);
  const [codesSnap, licensesSnap, orgsSnap, subscriptionsSnap] = await Promise.all([
    db.collection(Collections.organizationActivationCodes).get(),
    db.collection(Collections.organizationLicenses).get(),
    db.collection(Collections.organizations).get(),
    db.collection(Collections.organizationSubscriptions).get(),
  ]);

  const licenseById = new Map<string, OrganizationLicense>();
  licensesSnap.docs.forEach((doc) => licenseById.set(doc.id, doc.data() as OrganizationLicense));

  const subscriptionById = new Map<string, OrganizationSubscription>();
  subscriptionsSnap.docs.forEach((doc) => subscriptionById.set(doc.id, doc.data() as OrganizationSubscription));

  const orgNameById = new Map<string, string>();
  orgsSnap.docs.forEach((doc) => {
    const org = doc.data() as Organization;
    orgNameById.set(org.organizationId, org.name);
  });

  const search = filters.search?.trim().toLowerCase() ?? "";
  let rows = codesSnap.docs.map((doc) => {
    const code = doc.data() as OrganizationActivationCode;
    const license = licenseById.get(code.licenseId);
    const subscription = subscriptionById.get(code.subscriptionId);
    const schoolName = orgNameById.get(code.organizationId) ?? "Unknown school";
    return {
      licenseId: code.licenseId,
      organizationId: code.organizationId,
      schoolName,
      maskedCode: maskCode(code.codeLast4),
      codeLast4: code.codeLast4,
      status: getEffectiveActivationCodeStatus(code, subscription, license),
      batchName: code.batchName,
      studentIdentifier: license?.studentIdentifier ?? null,
      studentEmail: license?.studentEmail ?? null,
      createdAt: timestampToIso(code.createdAt),
      redeemedAt: timestampToIso(code.redeemedAt),
      createdAtMillis: getTimestampMillis(code.createdAt),
    };
  });

  rows = rows.filter((row) => {
    const matchesOrg = !filters.organizationId || row.organizationId === filters.organizationId;
    const matchesStatus = !filters.status || row.status === filters.status;
    const matchesBatch = !filters.batchName || row.batchName === filters.batchName;
    const matchesSearch =
      !search ||
      row.maskedCode.toLowerCase().includes(search) ||
      row.codeLast4.toLowerCase().includes(search) ||
      row.schoolName.toLowerCase().includes(search) ||
      (row.studentIdentifier ?? "").toLowerCase().includes(search) ||
      (row.studentEmail ?? "").toLowerCase().includes(search);
    return matchesOrg && matchesStatus && matchesBatch && matchesSearch;
  });

  rows.sort((a, b) => b.createdAtMillis - a.createdAtMillis);

  const total = rows.length;
  const items = rows.slice((page - 1) * pageSize, page * pageSize).map(({ createdAtMillis: _createdAtMillis, ...row }) => row);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function revokeLicense(licenseId: string, reason: string, actorUid: string) {
  const licenseRef = db.collection(Collections.organizationLicenses).doc(licenseId);
  const snap = await licenseRef.get();
  if (!snap.exists) throw new ApiError(404, "LICENSE_NOT_FOUND", "License not found.");
  const license = snap.data() as OrganizationLicense;

  await db.runTransaction(async (tx) => {
    const orgRef = db.collection(Collections.organizations).doc(license.organizationId);
    const orgSnap = license.status === "ACTIVE" ? await tx.get(orgRef) : null;

    tx.update(licenseRef, {
      status: "REVOKED",
      revokedAt: serverTimestamp(),
      revokedBy: actorUid,
      revocationReason: reason,
      updatedAt: serverTimestamp(),
    });

    const codesSnap = await db
      .collection(Collections.organizationActivationCodes)
      .where("licenseId", "==", licenseId)
      .limit(1)
      .get();

    codesSnap.forEach((doc) => {
      tx.update(doc.ref, { status: "REVOKED" });
    });

    if (license.status === "ACTIVE" && orgSnap?.exists) {
      const currentSeats = (orgSnap.data() as Organization).activatedSeats;
      tx.update(orgRef, { activatedSeats: Math.max(0, currentSeats - 1), updatedAt: serverTimestamp() });
    }
  });

  await writeAuditLog({
    actorUid,
    actorRole: "SUPER_ADMIN",
    action: "LICENSE_REVOKED",
    organizationId: license.organizationId,
    targetType: "license",
    targetId: licenseId,
    metadata: { reason },
  });
}

export async function replaceLicense(licenseId: string, reason: string | undefined, actorUid: string) {
  const licenseRef = db.collection(Collections.organizationLicenses).doc(licenseId);
  const snap = await licenseRef.get();
  if (!snap.exists) throw new ApiError(404, "LICENSE_NOT_FOUND", "License not found.");
  const oldLicense = snap.data() as OrganizationLicense;

  if (oldLicense.status !== "UNUSED") {
    throw new ApiError(409, "LICENSE_NOT_REPLACEABLE", "Only unused licenses/codes can be replaced.");
  }

  const result = await generateCodesForOrganization(
    {
      organizationId: oldLicense.organizationId,
      subscriptionId: oldLicense.subscriptionId,
      numberOfCodes: 1,
      batchName: `replacement-${licenseId}`,
      idempotencyKey: `replace-${licenseId}-${Date.now()}`,
    },
    actorUid,
    { emailSchoolCodes: false }
  );

  await db.runTransaction(async (tx) => {
    tx.update(licenseRef, { status: "REVOKED", updatedAt: serverTimestamp() });

    const oldCodesSnap = await db
      .collection(Collections.organizationActivationCodes)
      .where("licenseId", "==", licenseId)
      .limit(1)
      .get();

    oldCodesSnap.forEach((doc) => {
      tx.update(doc.ref, {
        status: "REPLACED",
        replacedAt: serverTimestamp(),
        replacedBy: actorUid,
      });
    });
  });

  await writeAuditLog({
    actorUid,
    actorRole: "SUPER_ADMIN",
    action: "LICENSE_REPLACED",
    organizationId: oldLicense.organizationId,
    targetType: "license",
    targetId: licenseId,
    metadata: { reason: reason ?? null, newLicenseId: result.codes[0]?.licenseId },
  });

  return result;
}

export async function deleteLicense(licenseId: string, actorUid: string) {
  const licenseRef = db.collection(Collections.organizationLicenses).doc(licenseId);
  const snap = await licenseRef.get();
  if (!snap.exists) throw new ApiError(404, "LICENSE_NOT_FOUND", "License not found.");
  const license = snap.data() as OrganizationLicense;

  const codeSnap = await db
    .collection(Collections.organizationActivationCodes)
    .where("licenseId", "==", licenseId)
    .limit(1)
    .get();

  await db.runTransaction(async (tx) => {
    const orgRef = db.collection(Collections.organizations).doc(license.organizationId);
    const orgSnap = license.status === "ACTIVE" ? await tx.get(orgRef) : null;
    const now = serverTimestamp();

    tx.update(licenseRef, {
      status: "DELETED" satisfies LicenseStatus,
      revokedAt: now,
      revokedBy: actorUid,
      revocationReason: "Deleted by admin",
      updatedAt: now,
    });

    codeSnap.docs.forEach((doc) => tx.update(doc.ref, { status: "DELETED" satisfies ActivationCodeStatus }));

    if (license.status === "ACTIVE" && orgSnap?.exists) {
      const currentSeats = (orgSnap.data() as Organization).activatedSeats;
      tx.update(orgRef, { activatedSeats: Math.max(0, currentSeats - 1), updatedAt: now });
    }

    if (license.studentUid) {
      tx.set(
        db.collection(Collections.userOrganizationEntitlements).doc(license.studentUid),
        { status: "DELETED", updatedAt: now, serverCheckedAt: Timestamp.now() },
        { merge: true }
      );
    }
  });

  await writeAuditLog({
    actorUid,
    actorRole: "SUPER_ADMIN",
    action: "LICENSE_DELETED",
    organizationId: license.organizationId,
    targetType: "license",
    targetId: licenseId,
    metadata: { softDelete: true },
  });
}

export async function deleteCodeBatch(input: {
  organizationId: string;
  batchName: string;
  confirmSchoolName: string;
  actorUid: string;
}) {
  const org = await getOrganization(input.organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");

  if (!isSchoolNameConfirmationValid(input.confirmSchoolName, org.name)) {
    throw new ApiError(400, "CONFIRMATION_MISMATCH", "Type the school name exactly to confirm deleting this sheet.");
  }

  const codesSnap = await db
    .collection(Collections.organizationActivationCodes)
    .where("organizationId", "==", input.organizationId)
    .where("batchName", "==", input.batchName)
    .get();

  if (codesSnap.empty) throw new ApiError(404, "BATCH_NOT_FOUND", "Code sheet not found.");

  const licenseSnaps = await Promise.all(
    codesSnap.docs.map((doc) => db.collection(Collections.organizationLicenses).doc((doc.data() as OrganizationActivationCode).licenseId).get())
  );

  const now = serverTimestamp();
  let activeRedeemedDeleted = 0;
  const batches: FirebaseFirestore.WriteBatch[] = [db.batch()];
  let writeCount = 0;
  const addWrite = (fn: (batch: FirebaseFirestore.WriteBatch) => void) => {
    if (writeCount >= 450) {
      batches.push(db.batch());
      writeCount = 0;
    }
    fn(batches[batches.length - 1]);
    writeCount++;
  };

  codesSnap.docs.forEach((doc) => addWrite((batch) => batch.update(doc.ref, { status: "DELETED" })));

  licenseSnaps.forEach((licenseSnap) => {
    if (!licenseSnap.exists) return;
    const license = licenseSnap.data() as OrganizationLicense;
    if (license.status === "ACTIVE") activeRedeemedDeleted++;

    addWrite((batch) =>
      batch.update(licenseSnap.ref, {
        status: "DELETED",
        revokedAt: now,
        revokedBy: input.actorUid,
        revocationReason: `Deleted with sheet ${input.batchName}`,
        updatedAt: now,
      })
    );

    if (license.studentUid) {
      addWrite((batch) =>
        batch.set(
          db.collection(Collections.userOrganizationEntitlements).doc(license.studentUid!),
          { status: "DELETED", updatedAt: now, serverCheckedAt: Timestamp.now() },
          { merge: true }
        )
      );
    }
  });

  if (activeRedeemedDeleted > 0) {
    addWrite((batch) =>
      batch.update(db.collection(Collections.organizations).doc(input.organizationId), {
        activatedSeats: Math.max(0, org.activatedSeats - activeRedeemedDeleted),
        updatedAt: now,
        updatedBy: input.actorUid,
      })
    );
  }

  await Promise.all(batches.map((batch) => batch.commit()));

  await writeAuditLog({
    actorUid: input.actorUid,
    actorRole: "SUPER_ADMIN",
    action: "CODE_BATCH_DELETED",
    organizationId: input.organizationId,
    targetType: "codeBatch",
    targetId: input.batchName,
    metadata: { softDelete: true, codesDeleted: codesSnap.size, activeRedeemedDeleted },
  });

  return { deletedCodes: codesSnap.size, activeRedeemedDeleted };
}
