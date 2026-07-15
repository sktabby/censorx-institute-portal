import crypto from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { Collections } from "../config/collections";
import { adminAuth } from "../config/firebaseAdmin";
import { logger } from "../config/logger";
import { db, newDocId, serverTimestamp } from "../repositories/firestoreRepository";
import { getOrganization, getActiveSubscription } from "../repositories/organizationRepository";
import { writeAuditLog } from "../repositories/auditLogRepository";
import { ApiError } from "../middleware/errorHandler";
import { sendSchoolAdminWelcomeEmail } from "./emailService";
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
 * Creates an organization with no initial subscription and provisions its
 * SCHOOL_ADMIN portal account. Seats and plan details are added when codes
 * are generated or the subscription is renewed.
 */
export async function createOrganization(input: CreateOrganizationInput, actorUid: string) {
  const organizationId = newDocId(Collections.organizations);
  const tempPassword = generateTemporaryPassword();
  let schoolAdminUid: string | undefined;

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

    await sendSchoolAdminWelcomeEmail({ to: input.contactEmail, tempPassword });

    await writeAuditLog({
      actorUid,
      actorRole: "SUPER_ADMIN",
      action: "ORGANIZATION_CREATED",
      organizationId,
      targetType: "organization",
      targetId: organizationId,
      metadata: { name: input.name, schoolAdminUid: authUser.uid },
    });

    return { organizationId, schoolAdminUid: authUser.uid, emailSent: true };
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

export async function renewSubscription(
  organizationId: string,
  input: RenewSubscriptionInput,
  actorUid: string
) {
  const org = await getOrganization(organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  assertOrganizationNotArchived(org);

  const oldSubscription = await getActiveSubscription(organizationId);
  const newSubscriptionId = newDocId(Collections.organizationSubscriptions);

  await db.runTransaction(async (tx) => {
    const orgRef = db.collection(Collections.organizations).doc(organizationId);
    const newSubRef = db.collection(Collections.organizationSubscriptions).doc(newSubscriptionId);

    tx.set(newSubRef, {
      subscriptionId: newSubscriptionId,
      organizationId,
      planDuration: input.planDuration,
      startAt: Timestamp.fromDate(new Date(input.startAt)),
      expiresAt: Timestamp.fromDate(new Date(input.expiresAt)),
      seatLimit: input.seatLimit ?? org.purchasedSeats,
      status: "ACTIVE",
      billingReference: input.billingReference ?? null,
      notes: input.notes ?? null,
      createdAt: serverTimestamp(),
      createdBy: actorUid,
      updatedAt: serverTimestamp(),
      renewedFromSubscriptionId: oldSubscription?.subscriptionId ?? null,
    });

    if (oldSubscription) {
      const oldSubRef = db.collection(Collections.organizationSubscriptions).doc(oldSubscription.subscriptionId);
      tx.update(oldSubRef, { status: "RENEWED", updatedAt: serverTimestamp() });
    }

    tx.update(orgRef, {
      currentSubscriptionId: newSubscriptionId,
      purchasedSeats: input.seatLimit ?? org.purchasedSeats,
      status: "ACTIVE",
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    });
  });

  await writeAuditLog({
    actorUid,
    actorRole: "SUPER_ADMIN",
    action: "SUBSCRIPTION_RENEWED",
    organizationId,
    targetType: "subscription",
    targetId: newSubscriptionId,
    metadata: { previousSubscriptionId: oldSubscription?.subscriptionId ?? null },
  });

  return { subscriptionId: newSubscriptionId };
}

export async function cancelSubscription(organizationId: string, actorUid: string) {
  const org = await getOrganization(organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  assertOrganizationNotArchived(org);
  if (!org.currentSubscriptionId) throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "No active subscription found.");

  const subRef = db.collection(Collections.organizationSubscriptions).doc(org.currentSubscriptionId);
  const subSnap = await subRef.get();
  if (!subSnap.exists) throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "No active subscription found.");

  await subRef.update({ status: "CANCELLED", updatedAt: serverTimestamp() });

  await writeAuditLog({
    actorUid,
    actorRole: "SUPER_ADMIN",
    action: "SUBSCRIPTION_CANCELLED",
    organizationId,
    targetType: "subscription",
    targetId: org.currentSubscriptionId,
    metadata: {},
  });
}

export async function extendSubscription(organizationId: string, newExpiresAt: string, actorUid: string) {
  const org = await getOrganization(organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  assertOrganizationNotArchived(org);

  const subscription = await getActiveSubscription(organizationId);
  if (!subscription) throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "No active subscription found.");

  const newExpiry = Timestamp.fromDate(new Date(newExpiresAt));
  if (newExpiry.toMillis() <= subscription.expiresAt.toMillis()) {
    throw new ApiError(400, "INVALID_EXPIRY", "New expiry date must be later than the current expiry date.");
  }

  await db
    .collection(Collections.organizationSubscriptions)
    .doc(subscription.subscriptionId)
    .update({ expiresAt: newExpiry, updatedAt: serverTimestamp() });

  await writeAuditLog({
    actorUid,
    actorRole: "SUPER_ADMIN",
    action: "SUBSCRIPTION_EXTENDED",
    organizationId,
    targetType: "subscription",
    targetId: subscription.subscriptionId,
    metadata: { newExpiresAt },
  });
}

export async function increaseSeats(organizationId: string, additionalSeats: number, actorUid: string) {
  const org = await getOrganization(organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  assertOrganizationNotArchived(org);

  const newSeatLimit = org.purchasedSeats + additionalSeats;

  await db.runTransaction(async (tx) => {
    const orgRef = db.collection(Collections.organizations).doc(organizationId);
    tx.update(orgRef, { purchasedSeats: newSeatLimit, updatedAt: serverTimestamp(), updatedBy: actorUid });

    if (org.currentSubscriptionId) {
      const subRef = db.collection(Collections.organizationSubscriptions).doc(org.currentSubscriptionId);
      tx.update(subRef, { seatLimit: newSeatLimit, updatedAt: serverTimestamp() });
    }
  });

  await writeAuditLog({
    actorUid,
    actorRole: "SUPER_ADMIN",
    action: "SEATS_INCREASED",
    organizationId,
    targetType: "organization",
    targetId: organizationId,
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

  const codeSnap = await db
    .collection(Collections.organizationActivationCodes)
    .where("organizationId", "==", organizationId)
    .get();
  const statuses = codeSnap.docs.map((doc) => doc.data().status as ActivationCodeStatus);

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
