import crypto from "node:crypto";
import { Collections } from "../config/collections";
import { adminAuth } from "../config/firebaseAdmin";
import { logger } from "../config/logger";
import { db, newDocId, serverTimestamp } from "../repositories/firestoreRepository";
import {
  getOrganization,
  getActiveSubscription,
  listOrganizationCodes,
  listOrganizationSubscriptions,
} from "../repositories/organizationRepository";
import { writeAuditLog } from "../repositories/auditLogRepository";
import { ApiError } from "../middleware/errorHandler";
import { sendSchoolAdminWelcomeEmail } from "./emailService";
import { buildPaymentRecord, sendBillForOrganization } from "./billService";
import { cancelBatch, extendBatch, renewBatch } from "./batchSubscriptionService";
import { hasActiveCodeStatuses } from "../utils/deleteGuards";
import type { CreateOrganizationInput, RenewSubscriptionInput } from "../types/serviceInputs";
import type { ActivationCodeStatus } from "../models/types";

const PASSWORD_LENGTH = 16;

function randomChars(charset: string, length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += charset[bytes[i] % charset.length];
  }
  return out;
}

export function generateTemporaryPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*";
  const all = `${upper}${lower}${digits}${symbols}`;
  return upper[crypto.randomBytes(1)[0] % upper.length] +
    lower[crypto.randomBytes(1)[0] % lower.length] +
    digits[crypto.randomBytes(1)[0] % digits.length] +
    symbols[crypto.randomBytes(1)[0] % symbols.length] +
    randomChars(all, PASSWORD_LENGTH - 4);
}

function makeOrganizationIdentifier(name: string, organizationId: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "school"}-${organizationId.slice(-6).toLowerCase()}`;
}

async function cleanupCreatedSchool(input: { uid?: string; organizationId?: string }) {
  try {
    if (input.uid) {
      await adminAuth.deleteUser(input.uid).catch((err: any) => {
        if (err?.code !== "auth/user-not-found") throw err;
      });
      await db.collection(Collections.portalUsers).doc(input.uid).delete().catch(() => undefined);
    }
    if (input.organizationId) {
      await db.collection(Collections.organizations).doc(input.organizationId).delete().catch(() => undefined);
    }
  } catch (err) {
    logger.error({ err, uid: input.uid, organizationId: input.organizationId }, "Failed to clean up after school creation error");
  }
}

function assertOrganizationNotArchived(org: { status: string }) {
  if (org.status === "ARCHIVED") {
    throw new ApiError(409, "ORG_ARCHIVED", "This school has been archived and cannot be modified.");
  }
}

/**
 * Creates an organization with no batch yet and provisions its SCHOOL_ADMIN portal
 * account. Dates, seats, payment and classes are added per batch on the Subscription page.
 * A payment may still be passed by older callers; it is stored on the school as before.
 */
export async function createOrganization(input: CreateOrganizationInput, actorUid: string) {
  const organizationId = newDocId(Collections.organizations);
  const tempPassword = generateTemporaryPassword();
  let schoolAdminUid: string | undefined;
  // Only present when the Create School form sent payment details.
  const payment = input.payment ? buildPaymentRecord(input.payment, organizationId) : null;

  try {
    const authUser = await adminAuth.createUser({
      email: input.contactEmail,
      password: tempPassword,
      displayName: input.contactName,
    });
    schoolAdminUid = authUser.uid;

    await db.runTransaction(async (tx) => {
      const orgRef = db.collection(Collections.organizations).doc(organizationId);
      const portalUserRef = db.collection(Collections.portalUsers).doc(authUser.uid);
      const now = serverTimestamp();

      tx.set(orgRef, {
        organizationId,
        name: input.name,
        identifier: makeOrganizationIdentifier(input.name, organizationId),
        contactName: input.contactName,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        address: "",
        city: "",
        state: "",
        country: "",
        status: "ACTIVE",
        purchasedSeats: 0,
        activatedSeats: 0,
        allowedDevicesPerStudent: 1,
        currentSubscriptionId: null,
        billingReference: null,
        notes: null,
        ...(payment ? { payment } : {}),
        createdAt: now,
        createdBy: actorUid,
        updatedAt: now,
        updatedBy: actorUid,
      });

      tx.set(portalUserRef, {
        uid: authUser.uid,
        email: input.contactEmail,
        displayName: input.contactName,
        role: "SCHOOL_ADMIN",
        organizationId,
        status: "ACTIVE",
        mustChangePassword: true,
        createdAt: now,
        createdBy: actorUid,
        updatedAt: now,
        lastLoginAt: null,
      });
    });

    await sendSchoolAdminWelcomeEmail({ to: input.contactEmail, schoolName: input.name, tempPassword });

    await writeAuditLog({
      actorUid,
      actorRole: "SUPER_ADMIN",
      action: "ORGANIZATION_CREATED",
      organizationId,
      targetType: "organization",
      targetId: organizationId,
      metadata: { name: input.name, schoolAdminUid: authUser.uid },
    });

    // The bill is best-effort: the school already exists and the admin already has a
    // login, so a failed bill email must never undo the school. The caller is told instead.
    let billEmail: { sent: boolean; to: string; warning?: string } | undefined;
    if (payment) {
      try {
        await sendBillForOrganization(
          {
            organizationId,
            name: input.name,
            contactName: input.contactName,
            contactEmail: input.contactEmail,
            contactPhone: input.contactPhone,
          },
          payment
        );
        billEmail = { sent: true, to: input.contactEmail };
      } catch (err) {
        logger.warn({ err, organizationId }, "School created but the bill email could not be sent");
        billEmail = {
          sent: false,
          to: input.contactEmail,
          warning: "The school was created, but the bill email could not be sent. You can resend it from the school page.",
        };
      }
    }

    return { organizationId, schoolAdminUid: authUser.uid, emailSent: true, billEmail };
  } catch (err) {
    await cleanupCreatedSchool({ uid: schoolAdminUid, organizationId });
    if (err instanceof ApiError) throw err;
    if (typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "auth/email-already-exists") {
      throw new ApiError(409, "SCHOOL_ADMIN_EMAIL_EXISTS", "A portal account already exists for this email.");
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    throw new ApiError(500, "SCHOOL_CREATION_FAILED", `School creation failed during account setup or email sending: ${message}`);
  }
}

/**
 * Picks the batch a school-level (legacy) action applies to: the live batch ending last, else
 * the most recent one. Every batch action now takes an explicit subscriptionId; these
 * wrappers only keep the old school-level routes working.
 */
async function requirePrimaryBatch(organizationId: string) {
  const subscription = await getActiveSubscription(organizationId);
  if (!subscription) {
    throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "This school has no batch yet. Create one on the Subscription page.");
  }
  return subscription;
}

/** Legacy school-level renew: renews the school's primary batch. */
export async function renewSubscription(
  organizationId: string,
  input: RenewSubscriptionInput,
  actorUid: string
) {
  const org = await getOrganization(organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  assertOrganizationNotArchived(org);

  // Checked first so a bad window is reported before anything else is looked up.
  const renewStartAt = new Date(input.startAt);
  const renewExpiresAt = new Date(input.expiresAt);
  if (renewExpiresAt.getTime() <= renewStartAt.getTime()) {
    throw new ApiError(400, "INVALID_PLAN_DATES", "Expiry date must be after start date.");
  }

  const target = await requirePrimaryBatch(organizationId);
  return renewBatch(
    organizationId,
    target.subscriptionId,
    {
      planDuration: input.planDuration,
      startAt: input.startAt,
      expiresAt: input.expiresAt,
      seatLimit: input.seatLimit,
      billingReference: input.billingReference,
      notes: input.notes,
      idempotencyKey: `legacy-renew-${organizationId}-${Date.now()}`,
    },
    actorUid
  );
}

/** Legacy school-level cancel: cancels the school's primary batch. */
export async function cancelSubscription(organizationId: string, actorUid: string) {
  const org = await getOrganization(organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  assertOrganizationNotArchived(org);
  const target = await requirePrimaryBatch(organizationId);
  return cancelBatch(organizationId, target.subscriptionId, actorUid);
}

/** Legacy school-level extend: extends the school's primary batch. */
export async function extendSubscription(organizationId: string, newExpiresAt: string, actorUid: string) {
  const org = await getOrganization(organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  assertOrganizationNotArchived(org);
  const target = await requirePrimaryBatch(organizationId);
  return extendBatch(organizationId, target.subscriptionId, newExpiresAt, actorUid);
}

/** Legacy: adds seats to the school's primary batch without naming a class. */
export async function increaseSeats(organizationId: string, additionalSeats: number, actorUid: string) {
  const org = await getOrganization(organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  assertOrganizationNotArchived(org);
  const target = await requirePrimaryBatch(organizationId);
  if (target.status !== "ACTIVE") {
    throw new ApiError(409, "BATCH_NOT_LIVE", "The school's current batch is not live, so seats cannot be added to it.");
  }

  const newSeatLimit = target.seatLimit + additionalSeats;
  const subscriptions = await listOrganizationSubscriptions(organizationId);
  const purchasedSeats = subscriptions.reduce(
    (sum, s) => sum + (s.status === "ACTIVE" ? (s.subscriptionId === target.subscriptionId ? newSeatLimit : s.seatLimit) : 0),
    0
  );

  await db.runTransaction(async (tx) => {
    tx.update(db.collection(Collections.organizations).doc(organizationId), {
      purchasedSeats,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    });
    tx.update(db.collection(Collections.organizationSubscriptions).doc(target.subscriptionId), {
      seatLimit: newSeatLimit,
      updatedAt: serverTimestamp(),
    });
  });

  await writeAuditLog({
    actorUid,
    actorRole: "SUPER_ADMIN",
    action: "SEATS_INCREASED",
    organizationId,
    targetType: "subscription",
    targetId: target.subscriptionId,
    metadata: { additionalSeats, newSeatLimit },
  });
}

export async function setOrganizationStatus(
  organizationId: string,
  status: "ACTIVE" | "SUSPENDED",
  actorUid: string
) {
  const org = await getOrganization(organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  if (org.status === "ARCHIVED") {
    throw new ApiError(409, "ORG_ARCHIVED", "Archived schools cannot be reactivated from this action.");
  }

  await db
    .collection(Collections.organizations)
    .doc(organizationId)
    .update({ status, updatedAt: serverTimestamp(), updatedBy: actorUid });

  await writeAuditLog({
    actorUid,
    actorRole: "SUPER_ADMIN",
    action: status === "SUSPENDED" ? "ORGANIZATION_SUSPENDED" : "ORGANIZATION_REACTIVATED",
    organizationId,
    targetType: "organization",
    targetId: organizationId,
    metadata: {},
  });
}

export async function deleteOrganization(organizationId: string, actorUid: string) {
  const org = await getOrganization(organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  if (org.status === "ARCHIVED") {
    return;
  }

  // Effective status, not the stored field: codes whose coverage has lapsed are
  // no longer usable and must not block deleting the school, even when the
  // expiry sweep has not yet materialised EXPIRED onto them.
  const codes = await listOrganizationCodes(organizationId);
  const statuses = codes.map((code) => code.status as ActivationCodeStatus);

  if (hasActiveCodeStatuses(statuses)) {
    throw new ApiError(
      409,
      "ACTIVE_CODES_REMAIN",
      "Delete all active codes for this school first (Manage Codes section) before deleting the school."
    );
  }

  const portalUsersSnap = await db
    .collection(Collections.portalUsers)
    .where("organizationId", "==", organizationId)
    .get();

  const subscriptionsSnap = await db
    .collection(Collections.organizationSubscriptions)
    .where("organizationId", "==", organizationId)
    .get();

  for (const userDoc of portalUsersSnap.docs) {
    await adminAuth.deleteUser(userDoc.id).catch((err: any) => {
      if (err?.code !== "auth/user-not-found") throw err;
    });
  }

  const batch = db.batch();
  const now = serverTimestamp();
  batch.update(db.collection(Collections.organizations).doc(organizationId), {
    status: "ARCHIVED",
    updatedAt: now,
    updatedBy: actorUid,
  });

  subscriptionsSnap.docs.forEach((doc) => {
    batch.update(doc.ref, { status: "CANCELLED", updatedAt: now });
  });

  portalUsersSnap.docs.forEach((doc) => {
    batch.update(doc.ref, { status: "DISABLED", updatedAt: now });
  });

  await batch.commit();

  await writeAuditLog({
    actorUid,
    actorRole: "SUPER_ADMIN",
    action: "ORGANIZATION_ARCHIVED",
    organizationId,
    targetType: "organization",
    targetId: organizationId,
    metadata: { disabledPortalUsers: portalUsersSnap.size },
  });
}
