import { Timestamp } from "firebase-admin/firestore";
import ExcelJS from "exceljs";
import { Collections } from "../config/collections";
import { logger } from "../config/logger";
import { db, newDocId, serverTimestamp } from "../repositories/firestoreRepository";
import {
  getOrganization,
  getEffectiveActivationCodeStatus,
  getEffectiveOrganizationStatus,
  getSubscriptionById,
  getSubscriptionSeatUsage,
  listOrganizationSubscriptions,
} from "../repositories/organizationRepository";
import { writeAuditLog } from "../repositories/auditLogRepository";
import { ApiError } from "../middleware/errorHandler";
import { hashFromRawCode } from "./codeCryptoService";
import { CODE_ROW_FIELDS, LICENSE_CODE_ROW_FIELDS, onlyFields } from "../utils/firestoreFields";
import { batchLabelOf, findClassRecord, findPendingBatch, markBatchGenerated } from "./batchService";
import { createBatch } from "./batchSubscriptionService";
import { buildVaultEntry, isCodeVaultEnabled, vaultRef } from "./codeVaultService";
import { planDurationToMs } from "../utils/planDuration";
import { isSchoolNameConfirmationValid } from "../utils/deleteGuards";
import { buildPlaintextCodesForMode, type PlaintextCodeEntry } from "../utils/codeGenerationModes";
import { sendActivationCodesEmail } from "./emailService";
import { subscriptionPlanName } from "./studentCounts";
import { createNotification } from "./notificationService";
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
  /** The email is being sent after the response (see emailInBackground). */
  queued?: boolean;
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
  /** Batch period this code sits on and its label, e.g. "Batch 2". */
  subscriptionId: string;
  batchLabel: string | null;
  studentIdentifier: string | null;
  studentEmail: string | null;
  createdAt: string | null;
  redeemedAt: string | null;
  /** Date this code's licence stops working. */
  expiresAt: string | null;
}

export interface CodeListFilters {
  organizationId?: string;
  subscriptionId?: string;
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

/**
 * Student IDs (from the list given) that this school has already used on any code, in any
 * state: active, used, revoked, replaced or deleted. A student ID is never used twice in a school.
 */
export async function findUsedStudentIds(organizationId: string, ids: string[]): Promise<string[]> {
  const wanted = new Map<string, string>();
  ids.forEach((id) => {
    const key = id.trim().toUpperCase();
    if (key && !wanted.has(key)) wanted.set(key, id.trim());
  });
  if (wanted.size === 0) return [];
  const snap = await onlyFields(
    db.collection(Collections.organizationLicenses).where("organizationId", "==", organizationId),
    ["studentIdentifier"]
  ).get();
  const taken = new Set<string>();
  snap.docs.forEach((doc) => {
    const value = (doc.data() as { studentIdentifier?: string | null }).studentIdentifier;
    const key = value?.trim().toUpperCase();
    if (key && wanted.has(key)) taken.add(wanted.get(key)!);
  });
  return Array.from(taken);
}

/** Codes saved per database write. 3 records per code, well inside the database's limits. */
const CODES_PER_SAVE = 200;

/** Deletes documents written by a code run that failed part-way. Best effort, logged if it fails. */
async function removeWrites(refs: FirebaseFirestore.DocumentReference[]) {
  for (let start = 0; start < refs.length; start += 400) {
    try {
      await db.runTransaction(async (tx) => {
        refs.slice(start, start + 400).forEach((ref) => tx.delete(ref));
      });
    } catch (err) {
      logger.error({ err, count: refs.length }, "Could not remove codes of a failed run; delete them from Manage Codes");
    }
  }
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
      contactName: input.org.contactName,
      planName: subscriptionPlanName(input.subscription),
      batchLabel: batchLabelOf(input.subscription),
      batchName: input.batchName,
      codeCount: input.codes.length,
      expiresAt: input.subscription.expiresAt.toDate(),
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
        "Codes generated successfully, but the email to the school could not be sent. Download the codes now and share them with the school, or let the school download them from its portal.",
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

// Unused-code counting lives in the seat-usage helpers, which derive it from
// EFFECTIVE license status so past-due codes never overcharge capacity.

/**
 * Legacy one-shot path (plan + codes in one call): creates a NEW batch holding a single class
 * sized to the request, then generates that class's codes. Nothing already in the school is
 * touched — existing batches keep their own dates and codes.
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

  const { startAt, expiresAt } = resolvePlanWindow(input);
  const batchName = input.batchName ?? `batch-${Date.now()}`;

  const batch = await createBatch(
    input.organizationId,
    {
      planDuration: input.planDuration,
      startAt: startAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      classes: [{ batchName, seatCount: input.numberOfCodes }],
      notes: input.notes,
      idempotencyKey: `${input.idempotencyKey}-batch`,
    },
    actorUid,
    // The codes email that follows is the school's notice; no separate "batch set up" mail here.
    { notify: false }
  );

  const generated = await generateCodesForOrganization(
    { ...input, batchName, subscriptionId: batch.subscriptionId },
    actorUid
  );

  return { ...generated, subscriptionId: batch.subscriptionId };
}

/**
 * Generates N activation codes for one class of one batch. Performs all pre-flight
 * validation against that batch (its own window and its own seats), then writes one
 * license + one activation-code doc per code inside a single Firestore transaction.
 * When the code vault is configured, an encrypted copy of each code is written in the
 * same transaction so the school can download it later; redemption never reads it.
 */
export async function generateCodesForOrganization(
  input: GenerateCodesInput,
  actorUid: string,
  options: {
    emailSchoolCodes?: boolean;
    /**
     * Seats that are about to be freed by the same operation. A replacement retires one unused
     * code as it makes another, so it needs no spare seat of its own.
     */
    capacityCredit?: number;
    /** Replacing a code adds to the sheet that already holds it; everything else may not. */
    allowExistingSheet?: boolean;
    /**
     * Send the codes email after returning, so the admin sees the codes at once instead of
     * waiting for the mail server. The school's in-app notice follows the email.
     */
    emailInBackground?: boolean;
  } = {}
): Promise<GenerateCodesResult> {
  const org = await getOrganization(input.organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");

  if (org.status === "SUSPENDED") {
    throw new ApiError(409, "ORG_SUSPENDED", "This school is suspended. Codes cannot be generated.");
  }
  if (org.status === "ARCHIVED") {
    throw new ApiError(409, "ORG_ARCHIVED", "This school has been archived. Codes cannot be generated.");
  }

  // A class that was set up on the Subscription page knows which batch it belongs to, so the
  // caller may leave subscriptionId out and the class decides.
  const pendingBatch = input.batchName ? await findPendingBatch(input.organizationId, input.batchName) : null;
  const classRecord = pendingBatch ?? (input.batchName ? await findClassRecord(input.organizationId, input.batchName) : null);
  const subscriptionId = input.subscriptionId ?? classRecord?.subscriptionId;
  if (!subscriptionId) {
    throw new ApiError(400, "SUBSCRIPTION_REQUIRED", "A batch is required to generate codes.");
  }
  if (pendingBatch && pendingBatch.subscriptionId !== subscriptionId) {
    throw new ApiError(409, "CLASS_BATCH_MISMATCH", `"${input.batchName}" belongs to a different batch.`);
  }

  // The class's own batch decides everything: its window and its seats. Other batches of the
  // school, live or ended, have no say here.
  const subscription = await getSubscriptionById(input.organizationId, subscriptionId);
  if (!subscription) {
    throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "Batch not found for this school.");
  }
  if (subscription.status === "EXPIRED") {
    throw new ApiError(409, "SUBSCRIPTION_EXPIRED", `${batchLabelOf(subscription)} has ended. Renew it before making codes.`);
  }
  if (subscription.status !== "ACTIVE") {
    throw new ApiError(409, "SUBSCRIPTION_INACTIVE", `${batchLabelOf(subscription)} is not active (${subscription.status}).`);
  }

  // The school is EXPIRED only when every batch has ended, which cannot be true with a live
  // batch — but a stale stored EXPIRED would still block redemption, so heal it here.
  const allSubscriptions = await listOrganizationSubscriptions(input.organizationId);
  if (getEffectiveOrganizationStatus(org, allSubscriptions) === "EXPIRED") {
    throw new ApiError(409, "ORG_EXPIRED", "Every batch of this school has ended. Renew a batch or create a new one first.");
  }
  if (org.status === "EXPIRED") {
    await db
      .collection(Collections.organizations)
      .doc(input.organizationId)
      .update({ status: "ACTIVE", updatedAt: serverTimestamp(), updatedBy: actorUid });
  }

  const idempotencyRef = db.collection(Collections.organizationAuditLogs).doc(`idem_${input.idempotencyKey}`);
  if ((await idempotencyRef.get()).exists) {
    throw new ApiError(409, "DUPLICATE_REQUEST", "This code generation request has already been processed.");
  }

  const batchName = input.batchName ?? `batch-${Date.now()}`;

  // Fulfilling a class that was sized on the Subscription page: generation must not exceed
  // what is still waiting (seats reserved minus codes already made). Checked before the general
  // capacity gate so the more specific, actionable message wins when both would reject.
  let existingClassCodes = 0;
  if (input.batchName) {
    const existingCodes = await db
      .collection(Collections.organizationActivationCodes)
      .where("organizationId", "==", input.organizationId)
      .where("batchName", "==", input.batchName)
      .get();
    existingClassCodes = existingCodes.size;
  }
  if (pendingBatch) {
    const waiting = Math.max(0, pendingBatch.seatCount - existingClassCodes);
    if (input.numberOfCodes > waiting) {
      throw new ApiError(
        409,
        "BATCH_ALLOCATION_EXCEEDED",
        `"${batchName}" has ${waiting} seat(s) waiting for codes; cannot generate ${input.numberOfCodes}.`
      );
    }
  }

  // A class that already has all its codes is not topped up from here: doing so would quietly
  // use seats that belong to other classes still waiting for theirs. More codes for a class come
  // from "Add codes to class" on the Subscription page, and a lost code is replaced with
  // replaceLicense().
  if (input.batchName && !pendingBatch && !options.allowExistingSheet && existingClassCodes > 0) {
    throw new ApiError(
      409,
      "SHEET_ALREADY_HAS_CODES",
      `"${batchName}" already has codes. To make more, add codes to this class on the Subscription page.`
    );
  }

  const seatUsage = await getSubscriptionSeatUsage(input.organizationId, subscription);
  const remainingCapacity = seatUsage.remainingCapacity;

  if (input.numberOfCodes <= 0) {
    throw new ApiError(400, "INVALID_QUANTITY", "Requested quantity is invalid.");
  }
  if (input.numberOfCodes > remainingCapacity + (options.capacityCredit ?? 0)) {
    throw new ApiError(
      409,
      "CAPACITY_EXCEEDED",
      `Requested quantity (${input.numberOfCodes}) exceeds the seats left in ${batchLabelOf(subscription)} (${remainingCapacity}).`
    );
  }
  const vaultEnabled = isCodeVaultEnabled();

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

  // A student ID is never used twice in a school (checked against every code it has ever had).
  if (!options.allowExistingSheet) {
    const studentIds = hashedEntries
      .map((entry, index) => entry.studentIdentifier ?? (input.studentIdentifierPrefix ? `${input.studentIdentifierPrefix}-${index + 1}` : null))
      .filter((id): id is string => !!id);
    const used = await findUsedStudentIds(input.organizationId, studentIds);
    if (used.length > 0) {
      throw new ApiError(
        409,
        "STUDENT_ID_ALREADY_USED",
        `${used.length === 1 ? "This student ID is" : `${used.length} student IDs are`} already used in this school: ${used
          .slice(0, 10)
          .join(", ")}${used.length > 10 ? ` and ${used.length - 10} more` : ""}. Each student ID can be used only once.`
      );
    }
  }

  // Codes built from student IDs (or given by the caller) can repeat ones made earlier, so they
  // are checked first for a clear message. Random codes are 1-in-billions to collide and the
  // save below refuses an existing code anyway, so they skip this (it is slow on a slow link).
  const deterministic = !!input.codes || input.codeGenerationMode === "STUDENT_IDS";
  const CHECK_CHUNK = 100;
  for (let start = 0; deterministic && start < hashedEntries.length; start += CHECK_CHUNK) {
    const snaps = await Promise.all(
      hashedEntries
        .slice(start, start + CHECK_CHUNK)
        .map((entry) => db.collection(Collections.organizationActivationCodes).doc(entry.hash).get())
    );
    if (snaps.some((snap) => snap.exists)) {
      throw new ApiError(409, "CODE_ALREADY_EXISTS", "One of the generated codes already exists.");
    }
  }

  const results: GeneratedCodeResult[] = hashedEntries.map((entry) => ({
    plaintextCode: entry.plaintextCode,
    codeLast4: entry.last4,
    licenseId: "",
    studentIdentifier: entry.studentIdentifier,
  }));

  // Saved in chunks: one save of every code, licence and vault copy (3 records per code) is
  // too big for the database at around 1,000 codes. If any chunk fails, the chunks already
  // saved are removed again, so a class is never left half-made and can simply be retried.
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
  });

  const written: FirebaseFirestore.DocumentReference[] = [];
  try {
    for (let start = 0; start < hashedEntries.length; start += CODES_PER_SAVE) {
      const chunkRefs: FirebaseFirestore.DocumentReference[] = [];
      await db.runTransaction(async (tx) => {
        chunkRefs.length = 0; // a retried transaction starts its chunk again
        hashedEntries.slice(start, start + CODES_PER_SAVE).forEach((entry, offset) => {
          const index = start + offset;
          const licenseId = newDocId(Collections.organizationLicenses);
          const licenseRef = db.collection(Collections.organizationLicenses).doc(licenseId);
          const codeRef = db.collection(Collections.organizationActivationCodes).doc(entry.hash);
          const studentIdentifier =
            entry.studentIdentifier ?? (input.studentIdentifierPrefix ? `${input.studentIdentifierPrefix}-${index + 1}` : null);

          tx.set(licenseRef, {
            licenseId,
            organizationId: input.organizationId,
            subscriptionId,
            batchName,
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
            subscriptionId,
            batchName,
            status: "UNUSED",
            createdAt: serverTimestamp(),
            createdBy: actorUid,
            redeemedAt: null,
            replacedAt: null,
            replacedBy: null,
          });

          // Encrypted copy for the school's Download Codes page. Separate collection, never
          // read by redemption, so the hash-based flow above is unchanged.
          if (vaultEnabled) {
            tx.set(
              vaultRef(licenseId),
              buildVaultEntry({
                licenseId,
                organizationId: input.organizationId,
                subscriptionId,
                batchName,
                codeHash: entry.hash,
                codeLast4: entry.last4,
                plaintextCode: entry.plaintextCode,
              })
            );
          }

          chunkRefs.push(licenseRef, codeRef, ...(vaultEnabled ? [vaultRef(licenseId)] : []));
          results[index].licenseId = licenseId;
        });
      });
      written.push(...chunkRefs);
    }
  } catch (err) {
    await removeWrites([...written, idempotencyRef]);
    if (err instanceof ApiError) throw err;
    if ((err as { code?: number | string })?.code === 6 || (err as { code?: string })?.code === "already-exists") {
      throw new ApiError(409, "CODE_ALREADY_EXISTS", "One of the generated codes already exists. Nothing was kept; please try again.");
    }
    logger.error({ err, organizationId: input.organizationId, batchName, saved: written.length }, "Saving generated codes failed; rolled back");
    throw new ApiError(
      502,
      "CODE_SAVE_FAILED",
      "The codes could not be saved (the connection to the database failed). Nothing was kept for this class, so you can try again."
    );
  }

  // The allocation has now been fulfilled, so it stops showing as pending.
  if (pendingBatch) {
    await markBatchGenerated(input.organizationId, batchName);
  }

  await writeAuditLog({
    actorUid,
    actorRole: "SUPER_ADMIN",
    action: "CODES_GENERATED",
    organizationId: input.organizationId,
    targetType: "codeBatch",
    targetId: batchName,
    metadata: {
      numberOfCodes: input.numberOfCodes,
      batchName,
      subscriptionId,
      batchLabel: batchLabelOf(subscription),
      codeGenerationMode: input.codeGenerationMode ?? "RANDOM",
      storedInVault: vaultEnabled,
    },
  });

  const shouldEmailSchoolCodes = options.emailSchoolCodes ?? true;
  const notifySchool = async (delivery: CodeEmailDeliveryResult) =>
    createNotification({
      organizationId: input.organizationId,
      type: "CODES_READY",
      title: `Codes ready for ${batchName}`,
      message: `${input.numberOfCodes} activation code${input.numberOfCodes === 1 ? "" : "s"} for "${batchName}" (${batchLabelOf(subscription)}) ${
        delivery.sent ? `were emailed to ${delivery.to}` : "are ready"
      }. You can download them any time from Download Codes.`,
      subscriptionId,
      batchLabel: batchLabelOf(subscription),
    });

  let emailDelivery: CodeEmailDeliveryResult | undefined;
  if (shouldEmailSchoolCodes && options.emailInBackground) {
    emailDelivery = { sent: false, queued: true, to: org.contactEmail };
    void (async () => {
      try {
        await notifySchool(await sendGeneratedCodesEmail({ org, batchName, subscription, codes: results }));
      } catch (err) {
        logger.warn({ err, organizationId: input.organizationId, batchName }, "Codes email or notice (background) failed");
      }
    })();
  } else if (shouldEmailSchoolCodes) {
    emailDelivery = await sendGeneratedCodesEmail({ org, batchName, subscription, codes: results });
    await notifySchool(emailDelivery);
  }

  // Plaintext codes are returned once here and emailed to the school. When the vault is
  // configured they can also be downloaded from the school portal; otherwise a lost code is
  // handled by replaceLicense(), never by re-reading codes.
  return { batchName, codes: results, emailDelivery };
}

export async function listCodeRows(filters: CodeListFilters) {
  const { page, pageSize } = parsePagination(filters);
  // One school (the school's own page, or the admin filtering by school): read only that
  // school's records. Codes and licences are trimmed to the fields a row shows.
  const scoped = (name: string) =>
    filters.organizationId ? db.collection(name).where("organizationId", "==", filters.organizationId) : db.collection(name);
  const [codesSnap, licensesSnap, orgDocs, subscriptionsSnap] = await Promise.all([
    onlyFields(scoped(Collections.organizationActivationCodes), CODE_ROW_FIELDS).get(),
    onlyFields(scoped(Collections.organizationLicenses), LICENSE_CODE_ROW_FIELDS).get(),
    filters.organizationId
      ? db
          .collection(Collections.organizations)
          .doc(filters.organizationId)
          .get()
          .then((doc) => (doc.exists ? [doc] : []))
      : db
          .collection(Collections.organizations)
          .get()
          .then((snap) => snap.docs),
    scoped(Collections.organizationSubscriptions).get(),
  ]);

  const licenseById = new Map<string, OrganizationLicense>();
  licensesSnap.docs.forEach((doc) => licenseById.set(doc.id, doc.data() as OrganizationLicense));

  const subscriptionById = new Map<string, OrganizationSubscription>();
  subscriptionsSnap.docs.forEach((doc) => subscriptionById.set(doc.id, doc.data() as OrganizationSubscription));

  const orgNameById = new Map<string, string>();
  orgDocs.forEach((doc) => {
    const org = doc.data() as Organization;
    orgNameById.set(org.organizationId ?? doc.id, org.name);
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
      subscriptionId: code.subscriptionId,
      batchLabel: subscription ? batchLabelOf(subscription) : null,
      studentIdentifier: license?.studentIdentifier ?? null,
      studentEmail: license?.studentEmail ?? null,
      createdAt: timestampToIso(code.createdAt),
      redeemedAt: timestampToIso(code.redeemedAt),
      expiresAt: timestampToIso(license?.expiresAt ?? subscription?.expiresAt),
      createdAtMillis: getTimestampMillis(code.createdAt),
    };
  });

  rows = rows.filter((row) => {
    const matchesOrg = !filters.organizationId || row.organizationId === filters.organizationId;
    const matchesSubscription = !filters.subscriptionId || row.subscriptionId === filters.subscriptionId;
    const matchesStatus = !filters.status || row.status === filters.status;
    const matchesBatch = !filters.batchName || row.batchName === filters.batchName;
    const matchesSearch =
      !search ||
      row.maskedCode.toLowerCase().includes(search) ||
      row.codeLast4.toLowerCase().includes(search) ||
      row.schoolName.toLowerCase().includes(search) ||
      (row.studentIdentifier ?? "").toLowerCase().includes(search) ||
      (row.studentEmail ?? "").toLowerCase().includes(search);
    return matchesOrg && matchesSubscription && matchesStatus && matchesBatch && matchesSearch;
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

  // The replacement stays in the same class AND the same batch as the code it replaces, so the
  // class keeps its count and the batch's own dates apply to it. A code whose batch has ended
  // cannot be replaced until that batch is renewed.
  const ownSubscription = await getSubscriptionById(oldLicense.organizationId, oldLicense.subscriptionId);
  if (!ownSubscription) {
    throw new ApiError(409, "SUBSCRIPTION_REQUIRED", "This code's batch could not be found, so the code cannot be replaced.");
  }
  if (ownSubscription.status !== "ACTIVE") {
    throw new ApiError(
      409,
      "BATCH_NOT_LIVE",
      `${batchLabelOf(ownSubscription)} has ended, so this code cannot be replaced. Renew the batch first.`
    );
  }

  const result = await generateCodesForOrganization(
    {
      organizationId: oldLicense.organizationId,
      subscriptionId: ownSubscription.subscriptionId,
      numberOfCodes: 1,
      batchName: oldLicense.batchName ?? `replacement-${licenseId}`,
      idempotencyKey: `replace-${licenseId}-${Date.now()}`,
    },
    actorUid,
    { emailSchoolCodes: false, capacityCredit: 1, allowExistingSheet: true }
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
