import { Timestamp } from "firebase-admin/firestore";
import { Collections } from "../config/collections";
import { db } from "../repositories/firestoreRepository";
import { getEffectiveLicenseStatus, subscriptionProvidesCoverage } from "../repositories/organizationRepository";
import { writeAuditLog } from "../repositories/auditLogRepository";
import { ApiError } from "../middleware/errorHandler";
import { hashFromRawCode } from "./codeCryptoService";
import type { OrganizationLicense, OrganizationSubscription } from "../models/types";

export interface RedeemInput {
  code: string;
  deviceId: string;
  deviceFingerprint: string;
  deviceModel: string;
  studentIdentifier: string;
  studentName: string;
  studentEmail?: string;
}

const GENERIC_FAILURE_MESSAGE = "Code cannot be redeemed.";

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Android-compatible redemption flow. Runs entirely inside one Firestore
 * transaction so seat-capacity and duplicate-redemption checks cannot
 * race. Every internal failure reason is logged server-side only; the
 * caller always receives the same generic failure message so codes
 * cannot be enumerated/probed.
 */
export async function redeemActivationCode(input: RedeemInput, studentUid: string) {
  const { hash } = hashFromRawCode(input.code);

  try {
    const result = await db.runTransaction(async (tx) => {
      const codeRef = db.collection(Collections.organizationActivationCodes).doc(hash);
      const codeSnap = await tx.get(codeRef);
      if (!codeSnap.exists) throw new ApiError(400, "REDEMPTION_FAILED", GENERIC_FAILURE_MESSAGE);
      const code = codeSnap.data()!;

      if (code.status !== "UNUSED") {
        throw new ApiError(400, "REDEMPTION_FAILED", GENERIC_FAILURE_MESSAGE);
      }

      const licenseRef = db.collection(Collections.organizationLicenses).doc(code.licenseId);
      const licenseSnap = await tx.get(licenseRef);
      if (!licenseSnap.exists || licenseSnap.data()!.status !== "UNUSED") {
        throw new ApiError(400, "REDEMPTION_FAILED", GENERIC_FAILURE_MESSAGE);
      }
      const license = licenseSnap.data()!;

      const orgRef = db.collection(Collections.organizations).doc(code.organizationId);
      const orgSnap = await tx.get(orgRef);
      if (!orgSnap.exists || orgSnap.data()!.status !== "ACTIVE") {
        throw new ApiError(400, "REDEMPTION_FAILED", GENERIC_FAILURE_MESSAGE);
      }
      const org = orgSnap.data()!;

      const subRef = db.collection(Collections.organizationSubscriptions).doc(code.subscriptionId);
      const subSnap = await tx.get(subRef);
      if (!subSnap.exists) {
        throw new ApiError(400, "REDEMPTION_FAILED", GENERIC_FAILURE_MESSAGE);
      }
      const subscription = subSnap.data() as OrganizationSubscription;
      const validationNow = new Date();

      // Server-time expiry check — never trust client-supplied dates.
      // Same coverage predicate as the entitlement path: a code sitting on a
      // superseded-but-unexpired subscription must still redeem.
      if (!subscriptionProvidesCoverage(subscription, validationNow)) {
        throw new ApiError(400, "REDEMPTION_FAILED", GENERIC_FAILURE_MESSAGE);
      }
      if (license.expiresAt.toMillis() <= validationNow.getTime()) {
        throw new ApiError(400, "REDEMPTION_FAILED", GENERIC_FAILURE_MESSAGE);
      }

      // Duplicate-entitlement check: a user may not hold two active
      // organization entitlements simultaneously.
      const entitlementRef = db.collection(Collections.userOrganizationEntitlements).doc(studentUid);
      const entitlementSnap = await tx.get(entitlementRef);
      if (entitlementSnap.exists && entitlementSnap.data()!.status === "ACTIVE") {
        throw new ApiError(400, "REDEMPTION_FAILED", GENERIC_FAILURE_MESSAGE);
      }

      // Seat capacity check.
      if (org.activatedSeats >= org.purchasedSeats) {
        throw new ApiError(400, "REDEMPTION_FAILED", GENERIC_FAILURE_MESSAGE);
      }

      // Device restriction: allowedDevicesPerStudent enforced per license
      // (single-device model — extend here if multi-device support is added).
      if (license.deviceId && license.deviceId !== input.deviceId) {
        throw new ApiError(400, "REDEMPTION_FAILED", GENERIC_FAILURE_MESSAGE);
      }

      const parentProfileRef = db.collection(Collections.users).doc(studentUid);
      const parentProfileSnap = await tx.get(parentProfileRef);
      const parentProfile = parentProfileSnap.exists ? parentProfileSnap.data()! : {};
      const parentSnapshot = {
        parentName: nullableString(parentProfile.fullName),
        parentEmail: nullableString(parentProfile.email),
        parentPhone: nullableString(parentProfile.phone),
      };

      const now = Timestamp.now();

      tx.update(licenseRef, {
        status: "ACTIVE",
        studentUid,
        studentIdentifier: input.studentIdentifier,
        studentName: input.studentName,
        studentEmail: input.studentEmail ?? null,
        // Snapshot captured once at redemption time; this is not a live parent profile lookup.
        ...parentSnapshot,
        deviceId: input.deviceId,
        deviceFingerprint: input.deviceFingerprint,
        deviceModel: input.deviceModel,
        redeemedAt: now,
        lastActiveAt: now,
        updatedAt: now,
      });

      tx.update(codeRef, { status: "REDEEMED", redeemedAt: now });

      tx.update(orgRef, { activatedSeats: org.activatedSeats + 1, updatedAt: now });

      const memberRef = db.collection(Collections.organizationMembers).doc(`${code.organizationId}_${studentUid}`);
      tx.set(memberRef, {
        organizationId: code.organizationId,
        uid: studentUid,
        licenseId: code.licenseId,
        joinedAt: now,
      });

      tx.set(entitlementRef, {
        uid: studentUid,
        organizationId: code.organizationId,
        licenseId: code.licenseId,
        subscriptionId: code.subscriptionId,
        status: "ACTIVE",
        source: "ORGANIZATION_LICENSE",
        expiresAt: subscription.expiresAt,
        serverCheckedAt: now,
        offlineValidUntil: Timestamp.fromMillis(now.toMillis() + 7 * 24 * 60 * 60 * 1000),
        deviceId: input.deviceId,
        deviceFingerprint: input.deviceFingerprint,
        createdAt: entitlementSnap.exists ? entitlementSnap.data()!.createdAt : now,
        updatedAt: now,
      });

      return {
        licenseId: code.licenseId,
        organizationId: code.organizationId,
        expiresAt: subscription.expiresAt.toDate().toISOString(),
      };
    });

    await writeAuditLog({
      actorUid: studentUid,
      actorRole: "STUDENT",
      action: "CODE_REDEEMED",
      organizationId: result.organizationId,
      targetType: "license",
      targetId: result.licenseId,
      metadata: { deviceModel: input.deviceModel },
    });

    return result;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(400, "REDEMPTION_FAILED", GENERIC_FAILURE_MESSAGE);
  }
}

export async function getEntitlement(uid: string) {
  const snap = await db.collection(Collections.userOrganizationEntitlements).doc(uid).get();
  return snap.exists ? snap.data() : null;
}

export async function refreshEntitlement(uid: string) {
  const ref = db.collection(Collections.userOrganizationEntitlements).doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw new ApiError(404, "NO_ENTITLEMENT", "No organization entitlement found.");

  const entitlement = snap.data()!;
  const subSnap = await db.collection(Collections.organizationSubscriptions).doc(entitlement.subscriptionId).get();
  const licenseSnap = await db.collection(Collections.organizationLicenses).doc(entitlement.licenseId).get();

  const subscription = subSnap.exists ? (subSnap.data() as OrganizationSubscription) : null;
  // Coverage, not the literal status string: a subscription superseded by a
  // renewal (status RENEWED) is still within the window the school paid for.
  const subscriptionActive = subscriptionProvidesCoverage(subscription);
  const license = licenseSnap.exists ? (licenseSnap.data() as OrganizationLicense) : null;
  const licenseActive = !!license && getEffectiveLicenseStatus(license, subscription) === "ACTIVE";

  const now = Timestamp.now();
  const status = subscriptionActive && licenseActive ? "ACTIVE" : "EXPIRED";

  await ref.update({
    status,
    serverCheckedAt: now,
    offlineValidUntil: Timestamp.fromMillis(now.toMillis() + 7 * 24 * 60 * 60 * 1000),
    updatedAt: now,
  });

  return { ...entitlement, status };
}
