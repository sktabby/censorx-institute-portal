import crypto from "node:crypto";
import ExcelJS from "exceljs";
import { Collections } from "../config/collections";
import { env } from "../config/env";
import { db, serverTimestamp } from "../repositories/firestoreRepository";
import { getEffectiveActivationCodeStatus, getEffectiveLicenseStatus } from "../repositories/organizationRepository";
import { ApiError } from "../middleware/errorHandler";
import { batchLabelOf } from "./batchService";
import type {
  ActivationCodeStatus,
  OrganizationActivationCode,
  OrganizationCodeVaultEntry,
  OrganizationLicense,
  OrganizationSubscription,
} from "../models/types";

/**
 * Encrypted storage of full activation codes so a school can download them again.
 *
 * This is separate from, and never consulted by, code redemption: the mobile app still
 * matches on the HMAC hash in organizationActivationCodes. The vault only exists because
 * the codes email can be lost. Codes generated before the vault existed have no entry
 * and are reported as unavailable.
 *
 * Key: CODE_VAULT_KEY (any high-entropy string), stretched to 32 bytes with SHA-256.
 * Cipher: AES-256-GCM, fresh 12-byte IV per code, 16-byte auth tag.
 */

const KEY_VERSION = 1;
const CODE_UNAVAILABLE = "Not available — created before secure storage";

/** Statuses that are never offered to a school again. */
const EXCLUDED_STATUSES = new Set<ActivationCodeStatus>(["REVOKED", "REPLACED", "DELETED"]);

let cachedKey: Buffer | null | undefined;

function vaultKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  cachedKey = env.CODE_VAULT_KEY ? crypto.createHash("sha256").update(env.CODE_VAULT_KEY, "utf8").digest() : null;
  return cachedKey;
}

export function isCodeVaultEnabled(): boolean {
  return vaultKey() !== null;
}

export interface EncryptedCode {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

export function encryptCode(plaintextCode: string): EncryptedCode {
  const key = vaultKey();
  if (!key) throw new ApiError(503, "CODE_VAULT_DISABLED", "CODE_VAULT_KEY is not configured.");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintextCode, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: KEY_VERSION,
  };
}

export function decryptCode(entry: Pick<OrganizationCodeVaultEntry, "ciphertext" | "iv" | "authTag">): string {
  const key = vaultKey();
  if (!key) throw new ApiError(503, "CODE_VAULT_DISABLED", "CODE_VAULT_KEY is not configured.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(entry.iv, "base64"));
  decipher.setAuthTag(Buffer.from(entry.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(entry.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

/** The document stored for one code. Document ID is the licenseId. */
export function buildVaultEntry(input: {
  licenseId: string;
  organizationId: string;
  subscriptionId: string;
  batchName: string | null;
  codeHash: string;
  codeLast4: string;
  plaintextCode: string;
}) {
  const encrypted = encryptCode(input.plaintextCode);
  return {
    licenseId: input.licenseId,
    organizationId: input.organizationId,
    subscriptionId: input.subscriptionId,
    batchName: input.batchName,
    codeHash: input.codeHash,
    codeLast4: input.codeLast4,
    ...encrypted,
    createdAt: serverTimestamp(),
  };
}

export function vaultRef(licenseId: string) {
  return db.collection(Collections.organizationCodeVault).doc(licenseId);
}

export interface CodeExportFilters {
  organizationId: string;
  /** Only this batch period. */
  subscriptionId?: string;
  /** Only these classes (sheet names). */
  batchNames?: string[];
}

export interface CodeExportRow {
  batchLabel: string;
  batchName: string;
  serial: number;
  code: string;
  codeAvailable: boolean;
  codeLast4: string;
  status: ActivationCodeStatus;
  studentIdentifier: string | null;
  studentName: string | null;
  expiresAt: string | null;
  licenseId: string;
}

function timestampMillis(value: unknown): number {
  if (value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as FirebaseFirestore.Timestamp).toMillis();
  }
  return 0;
}

function isoDate(value: unknown): string | null {
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as FirebaseFirestore.Timestamp).toDate().toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Every code of the school (or of one batch / some classes), with the full code where the
 * vault holds it. Used codes are included on purpose — the school asked to see them — and
 * revoked, replaced or deleted codes are left out because they can never be used.
 */
export async function collectCodeExportRows(filters: CodeExportFilters): Promise<CodeExportRow[]> {
  const codesQuery = filters.subscriptionId
    ? db
        .collection(Collections.organizationActivationCodes)
        .where("organizationId", "==", filters.organizationId)
        .where("subscriptionId", "==", filters.subscriptionId)
    : db.collection(Collections.organizationActivationCodes).where("organizationId", "==", filters.organizationId);

  const [codesSnap, licensesSnap, subscriptionsSnap, vaultSnap] = await Promise.all([
    codesQuery.get(),
    db.collection(Collections.organizationLicenses).where("organizationId", "==", filters.organizationId).get(),
    db.collection(Collections.organizationSubscriptions).where("organizationId", "==", filters.organizationId).get(),
    db.collection(Collections.organizationCodeVault).where("organizationId", "==", filters.organizationId).get(),
  ]);

  const licenseById = new Map<string, OrganizationLicense>();
  licensesSnap.docs.forEach((doc) => licenseById.set(doc.id, doc.data() as OrganizationLicense));
  const subscriptionById = new Map<string, OrganizationSubscription>();
  subscriptionsSnap.docs.forEach((doc) => subscriptionById.set(doc.id, doc.data() as OrganizationSubscription));
  const vaultByLicenseId = new Map<string, OrganizationCodeVaultEntry>();
  vaultSnap.docs.forEach((doc) => vaultByLicenseId.set(doc.id, doc.data() as OrganizationCodeVaultEntry));

  const classFilter = filters.batchNames?.length ? new Set(filters.batchNames) : null;
  const now = new Date();
  const vaultEnabled = isCodeVaultEnabled();

  const rows = codesSnap.docs
    .map((doc) => doc.data() as OrganizationActivationCode)
    .filter((code) => !EXCLUDED_STATUSES.has(code.status))
    .filter((code) => !classFilter || (code.batchName !== null && classFilter.has(code.batchName)))
    .map((code) => {
      const license = licenseById.get(code.licenseId);
      const subscription = subscriptionById.get(code.subscriptionId);
      const entry = vaultEnabled ? vaultByLicenseId.get(code.licenseId) : undefined;
      let plaintext: string | null = null;
      if (entry) {
        try {
          plaintext = decryptCode(entry);
        } catch {
          plaintext = null;
        }
      }
      return {
        batchLabel: subscription ? batchLabelOf(subscription) : "-",
        batchName: code.batchName ?? "(unnamed)",
        serial: 0,
        code: plaintext ?? CODE_UNAVAILABLE,
        codeAvailable: plaintext !== null,
        codeLast4: code.codeLast4,
        status: getEffectiveActivationCodeStatus(code, subscription, license, now),
        studentIdentifier: license?.studentIdentifier ?? null,
        studentName: license?.studentName ?? null,
        expiresAt: license ? isoDate(license.expiresAt) : subscription ? isoDate(subscription.expiresAt) : null,
        licenseId: code.licenseId,
        sortKey: `${subscription?.batchNumber ?? 1}`.padStart(6, "0") + (code.batchName ?? "") + `${timestampMillis(code.createdAt)}`.padStart(16, "0"),
        licenseStatus: license ? getEffectiveLicenseStatus(license, subscription, now) : null,
      };
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  // Serial numbers restart for every class.
  const serialByClass = new Map<string, number>();
  return rows.map(({ sortKey: _sortKey, licenseStatus: _licenseStatus, ...row }) => {
    const key = `${row.batchLabel}\u0000${row.batchName}`;
    const serial = (serialByClass.get(key) ?? 0) + 1;
    serialByClass.set(key, serial);
    return { ...row, serial };
  });
}

export interface CodeExportWorkbook {
  buffer: Buffer;
  filename: string;
  rowCount: number;
  unavailableCount: number;
}

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "codes";
}

/**
 * Builds the .xlsx the school downloads: one sheet with every selected code, full codes
 * included (used ones too — the school asked for that), one serial sequence per class.
 */
export async function buildCodesWorkbook(input: {
  filters: CodeExportFilters;
  schoolName: string;
  /** Used in the file name, e.g. the batch label. */
  scopeLabel?: string;
}): Promise<CodeExportWorkbook> {
  const rows = await collectCodeExportRows(input.filters);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CensorX";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Activation Codes");
  sheet.columns = [
    { header: "Batch", key: "batchLabel", width: 12 },
    { header: "Class", key: "batchName", width: 22 },
    { header: "Serial", key: "serial", width: 8 },
    { header: "Activation code", key: "code", width: 30 },
    { header: "Status", key: "status", width: 12 },
    { header: "Student ID", key: "studentIdentifier", width: 16 },
    { header: "Student name", key: "studentName", width: 24 },
    { header: "Valid until", key: "expiresAt", width: 14 },
    { header: "Code last four", key: "codeLast4", width: 14 },
    { header: "License ID", key: "licenseId", width: 28 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  rows.forEach((row) => {
    sheet.addRow({
      batchLabel: row.batchLabel,
      batchName: row.batchName,
      serial: row.serial,
      code: row.code,
      status: row.status,
      studentIdentifier: row.studentIdentifier ?? "",
      studentName: row.studentName ?? "",
      expiresAt: row.expiresAt ?? "",
      codeLast4: row.codeLast4,
      licenseId: row.licenseId,
    });
  });

  const raw = await workbook.xlsx.writeBuffer();
  const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  const stamp = new Date().toISOString().slice(0, 10);
  const scope = input.scopeLabel ? `-${safeName(input.scopeLabel)}` : "";

  return {
    buffer,
    filename: `${safeName(input.schoolName)}${scope}-activation-codes-${stamp}.xlsx`,
    rowCount: rows.length,
    unavailableCount: rows.filter((row) => !row.codeAvailable).length,
  };
}
