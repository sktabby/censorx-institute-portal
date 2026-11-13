import crypto from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { Collections } from "../config/collections";
import { adminAuth } from "../config/firebaseAdmin";
import { logger } from "../config/logger";
import { db, newDocId, serverTimestamp } from "../repositories/firestoreRepository";
import {
  getOrganization,
  getActiveSubscription,
  getOrganizationSeatUsage,
  listOrganizationCodes,
  listOrganizationLicenses,
} from "../repositories/organizationRepository";
import { writeAuditLog } from "../repositories/auditLogRepository";
import { ApiError } from "../middleware/errorHandler";
import { sendBatchRenewalEmail, sendSchoolAdminWelcomeEmail } from "./emailService";
import { buildPaymentRecord, sendBillForOrganization } from "./billService";
import { carryOverStrandedLicenses, restoreCoverage } from "./coverageRenewalService";
import { allocateBatch, listOrganizationBatches, repointPendingBatches } from "./batchService";
import { hasActiveCodeStatuses } from "../utils/deleteGuards";
import type {
  CreateOrganizationInput,
  RenewBatchesInput,
  RenewSubscriptionInput,
} from "../types/serviceInputs";
import type { ActivationCodeStatus } from "../models/types";

export interface RenewBatchesResult {
  subscriptionId: string;
  renewedBatches: string[];
  licensesRestored: number;
  codesRestored: number;
  studentsReactivated: number;
  renewalEmail?: { sent: boolean; to: string; warning?: string };
  /**
   * Seats reserved for a new batch, if one was allocated. No codes exist for it
   * yet — it is generated from Create Codes.
   */
  allocatedBatch: { batchId: string; batchName: string; seatCount: number } | null;
  /** Every batch allocated by this renewal, in order. `allocatedBatch` is the first of these. */
  allocatedBatches: Array<{ batchId: string; batchName: string; seatCount: number }>;
  /**
   * Previously-allocated batches that were still awaiting code generation and
   * have been moved onto this renewal's window.
   */
  repointedBatches: string[];
  seatLimit: number;
}

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
 * Writes back the activated-seat count derived from the licenses themselves.
 * Read paths derive seats from effective license status (see seatAccounting);
 * this stored counter exists only as the transaction-local guard used by
 * redemption, so it must be re-anchored whenever coverage changes in bulk.
 */
async function syncActivatedSeats(organizationId: string, activatedSeats: number, actorUid: string) {
  await db
    .collection(Collections.organizations)
    .doc(organizationId)
    .update({ activatedSeats, updatedAt: serverTimestamp(), updatedBy: actorUid });
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

export async function renewSubscription(
  organizationId: string,
  input: RenewSubscriptionInput,
  actorUid: string
) {
  const org = await getOrganization(organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  assertOrganizationNotArchived(org);

  // Same guard renewBatches has. Without it this path accepted an expiry
  // earlier than its start, which produced a subscription born expired.
  const renewStartAt = new Date(input.startAt);
  const renewExpiresAt = new Date(input.expiresAt);
  if (renewExpiresAt.getTime() <= renewStartAt.getTime()) {
    throw new ApiError(400, "INVALID_PLAN_DATES", "Expiry date must be after start date.");
  }

  const oldSubscription = await getActiveSubscription(organizationId);
  const newSubscriptionId = newDocId(Collections.organizationSubscriptions);
  const newExpiresAt = Timestamp.fromDate(renewExpiresAt);

  await db.runTransaction(async (tx) => {
    const orgRef = db.collection(Collections.organizations).doc(organizationId);
    const newSubRef = db.collection(Collections.organizationSubscriptions).doc(newSubscriptionId);

    tx.set(newSubRef, {
      subscriptionId: newSubscriptionId,
      organizationId,
      planDuration: input.planDuration,
      startAt: Timestamp.fromDate(renewStartAt),
      expiresAt: newExpiresAt,
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

  // Move the school's existing licenses and codes onto the new window, so
  // students who were locked out by the previous expiry regain access with
  // the same activation codes.
  const restored = await restoreCoverage({
    organizationId,
    targetSubscriptionId: newSubscriptionId,
    expiresAt: newExpiresAt,
    actorUid,
  });

  await syncActivatedSeats(organizationId, restored.activatedSeats, actorUid);

  await writeAuditLog({
    actorUid,
    actorRole: "SUPER_ADMIN",
    action: "SUBSCRIPTION_RENEWED",
    organizationId,
    targetType: "subscription",
    targetId: newSubscriptionId,
    metadata: {
      previousSubscriptionId: oldSubscription?.subscriptionId ?? null,
      licensesRestored: restored.licensesRestored,
      codesRestored: restored.codesRestored,
      studentsReactivated: restored.studentsReactivated,
      activatedSeats: restored.activatedSeats,
    },
  });

  return { subscriptionId: newSubscriptionId, ...restored };
}

/**
 * Batch-wise renewal — seats and time only.
 *
 * Renews any combination of the school's existing batches in place: the same
 * activation codes move onto a new subscription window, so nothing is
 * regenerated and no codes are mailed. It may also allocate one brand-new
 * batch, which reserves named, sized seats WITHOUT generating codes; those are
 * generated later in Create Codes against the window allocated here.
 *
 * Either half may be used alone. This function must never generate codes or
 * trigger a codes email — that responsibility belongs solely to Create Codes.
 */
export async function renewBatches(
  organizationId: string,
  input: RenewBatchesInput,
  actorUid: string
): Promise<RenewBatchesResult> {
  const org = await getOrganization(organizationId);
  if (!org) throw new ApiError(404, "ORG_NOT_FOUND", "School not found.");
  assertOrganizationNotArchived(org);
  if (org.status === "SUSPENDED") {
    throw new ApiError(409, "ORG_SUSPENDED", "This school is suspended. Renew is not available.");
  }

  const selectedBatchNames = Array.from(new Set(input.batchNames ?? []));
  // One or several new classes: the single `newBatch` form and the `newBatches` list both work.
  const newBatches = [...(input.newBatch ? [input.newBatch] : []), ...(input.newBatches ?? [])];

  if (selectedBatchNames.length === 0 && newBatches.length === 0) {
    throw new ApiError(
      400,
      "NOTHING_TO_RENEW",
      "Select at least one batch to renew, or allocate a new batch."
    );
  }

  if (newBatches.some((item) => !item.batchName?.trim())) {
    throw new ApiError(400, "BATCH_NAME_REQUIRED", "A name is required for the new batch.");
  }

  const newNames = newBatches.map((item) => item.batchName.trim().toLowerCase());
  if (new Set(newNames).size !== newNames.length) {
    throw new ApiError(409, "BATCH_NAME_TAKEN", "Each new class needs its own name.");
  }

  const batches = await listOrganizationBatches(organizationId);
  const batchByName = new Map(batches.map((batch) => [batch.batchName, batch]));

  const unknownBatch = selectedBatchNames.find((name) => !batchByName.has(name));
  if (unknownBatch) {
    throw new ApiError(404, "BATCH_NOT_FOUND", `Code sheet not found: ${unknownBatch}`);
  }

  const takenName = newBatches.find((item) => batchByName.has(item.batchName.trim()));
  if (takenName) {
    throw new ApiError(
      409,
      "BATCH_NAME_TAKEN",
      `A batch named "${takenName.batchName}" already exists for this school.`
    );
  }

  const startAt = new Date(input.startAt);
  const expiresAt = new Date(input.expiresAt);
  if (expiresAt.getTime() <= startAt.getTime()) {
    throw new ApiError(400, "INVALID_PLAN_DATES", "Expiry date must be after start date.");
  }
  const newExpiresAt = Timestamp.fromDate(expiresAt);

  // Seats carried over by the renewed batches, plus whatever the new batch adds.
  const renewedSeats = selectedBatchNames.reduce(
    (sum, name) => sum + (batchByName.get(name)?.renewableCount ?? 0),
    0
  );

  // Batches this renewal leaves alone keep their own window, so any seat still
  // live in them must also fit under the new limit. Omitting these made the new
  // limit too small and the follow-up code generation fail on capacity.
  // Batch membership is read from the code documents, matching restoreCoverage.
  const [existingLicenses, existingCodes] = await Promise.all([
    listOrganizationLicenses(organizationId),
    listOrganizationCodes(organizationId),
  ]);
  const batchByLicenseId = new Map(existingCodes.map((code) => [code.licenseId, code.batchName]));
  const selectedSet = new Set(selectedBatchNames);
  const retainedSeats = existingLicenses.filter((license) => {
    const licenseBatch = batchByLicenseId.get(license.licenseId) ?? null;
    const isBeingRenewed = licenseBatch !== null && selectedSet.has(licenseBatch);
    return !isBeingRenewed && (license.status === "ACTIVE" || license.status === "UNUSED");
  }).length;

  // Classes still waiting for their codes hold seats too. They have no licences yet, so the
  // count above cannot see them; without this, adding a class while another is still waiting
  // quietly dropped the waiting class's seats from the limit.
  const waitingSeats = batches
    .filter((batch) => batch.isPending && !selectedSet.has(batch.batchName))
    .reduce((sum, batch) => sum + batch.pendingSeats, 0);
  const newSeats = newBatches.reduce((sum, item) => sum + item.seatCount, 0);

  const seatLimit = input.seatLimit ?? renewedSeats + retainedSeats + waitingSeats + newSeats;

  const oldSubscription = await getActiveSubscription(organizationId);
  const newSubscriptionId = newDocId(Collections.organizationSubscriptions);
  const newStartAt = Timestamp.fromDate(startAt);

  await db.runTransaction(async (tx) => {
    const orgRef = db.collection(Collections.organizations).doc(organizationId);
    const newSubRef = db.collection(Collections.organizationSubscriptions).doc(newSubscriptionId);
    const now = serverTimestamp();

    tx.set(newSubRef, {
      subscriptionId: newSubscriptionId,
      organizationId,
      planDuration: input.planDuration,
      startAt: newStartAt,
      expiresAt: newExpiresAt,
      seatLimit,
      status: "ACTIVE",
      billingReference: input.billingReference ?? null,
      notes: input.notes ?? null,
      createdAt: now,
      createdBy: actorUid,
      updatedAt: now,
      renewedFromSubscriptionId: oldSubscription?.subscriptionId ?? null,
    });

    if (oldSubscription) {
      tx.update(db.collection(Collections.organizationSubscriptions).doc(oldSubscription.subscriptionId), {
        status: "RENEWED",
        updatedAt: now,
      });
    }

    tx.update(orgRef, {
      currentSubscriptionId: newSubscriptionId,
      purchasedSeats: seatLimit,
      status: "ACTIVE",
      updatedAt: now,
      updatedBy: actorUid,
    });
  });

  // Renew the selected batches in place — same codes, new window.
  const restored = selectedBatchNames.length
    ? await restoreCoverage({
        organizationId,
        targetSubscriptionId: newSubscriptionId,
        expiresAt: newExpiresAt,
        batchNames: selectedBatchNames,
        actorUid,
      })
    : null;

  // Licences that were still valid on the subscription this renewal just
  // superseded must not be left behind on a dead record — including when this
  // renewal selected no batches at all (seat-only allocation). Their own
  // expiresAt is preserved, so an unrenewed batch gains no extra time.
  const carriedOver = oldSubscription
    ? await carryOverStrandedLicenses({
        organizationId,
        fromSubscriptionId: oldSubscription.subscriptionId,
        toSubscriptionId: newSubscriptionId,
      })
    : { licensesCarried: 0, codesCarried: 0, entitlementsCarried: 0 };

  // Any batch still awaiting generation moves onto the new window too, so its
  // codes are not issued already-expired once Create Codes runs. The names are
  // reported back so this date change is visible rather than silent.
  const repointedBatches = await repointPendingBatches({
    organizationId,
    subscriptionId: newSubscriptionId,
    startAt: newStartAt,
    expiresAt: newExpiresAt,
  });

  // Seat-only allocation. Renew School never generates codes and never emails:
  // it reserves named, sized capacity that Create Codes fulfils later.
  const allocatedBatches: Array<{ batchId: string; batchName: string; seatCount: number }> = [];
  for (const item of newBatches) {
    allocatedBatches.push(
      await allocateBatch({
        organizationId,
        batchName: item.batchName.trim(),
        seatCount: item.seatCount,
        subscriptionId: newSubscriptionId,
        startAt: newStartAt,
        expiresAt: newExpiresAt,
        actorUid,
      })
    );
  }
  const allocated = allocatedBatches[0] ?? null;

  const seatUsage = await getOrganizationSeatUsage(organizationId, { seatLimit });
  await syncActivatedSeats(organizationId, seatUsage.activatedSeats, actorUid);

  // Only the renewal notice is sent here. A newly allocated batch has no codes
  // to mail; that email is sent by Create Codes when the codes are generated.
  let renewalEmail: { sent: boolean; to: string; warning?: string } | undefined;
  if (restored && restored.licensesRestored > 0) {
    try {
      await sendBatchRenewalEmail({
        to: org.contactEmail,
        schoolName: org.name,
        batchNames: selectedBatchNames,
        expiresAt,
        studentsReactivated: restored.studentsReactivated,
      });
      renewalEmail = { sent: true, to: org.contactEmail };
    } catch (err) {
      logger.warn({ err, organizationId, batchNames: selectedBatchNames }, "Batch renewal email could not be sent");
      renewalEmail = {
        sent: false,
        to: org.contactEmail,
        warning: "Batches renewed successfully, but the notification email to the school could not be sent.",
      };
    }
  }

  await writeAuditLog({
    actorUid,
    actorRole: "SUPER_ADMIN",
    action: "BATCHES_RENEWED",
    organizationId,
    targetType: "subscription",
    targetId: newSubscriptionId,
    metadata: {
      previousSubscriptionId: oldSubscription?.subscriptionId ?? null,
      renewedBatches: selectedBatchNames,
      licensesRestored: restored?.licensesRestored ?? 0,
      studentsReactivated: restored?.studentsReactivated ?? 0,
      allocatedBatchName: allocated?.batchName ?? null,
      allocatedSeats: allocated?.seatCount ?? 0,
      allocatedBatches: allocatedBatches.map((item) => ({ name: item.batchName, seats: item.seatCount })),
      repointedBatches,
      licensesCarriedOver: carriedOver.licensesCarried,
      seatLimit,
    },
  });

  if (repointedBatches.length > 0) {
    logger.info(
      { organizationId, subscriptionId: newSubscriptionId, repointedBatches },
      "Pending batches moved onto the new renewal window"
    );
  }

  return {
    subscriptionId: newSubscriptionId,
    renewedBatches: selectedBatchNames,
    licensesRestored: restored?.licensesRestored ?? 0,
    codesRestored: restored?.codesRestored ?? 0,
    studentsReactivated: restored?.studentsReactivated ?? 0,
    renewalEmail,
    allocatedBatch: allocated,
    allocatedBatches,
    repointedBatches,
    seatLimit,
  };
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
    .update({ expiresAt: newExpiry, status: "ACTIVE", updatedAt: serverTimestamp() });

  // Licenses carry their own expiresAt, so extending only the subscription
  // would leave every student still locked out.
  const restored = await restoreCoverage({
    organizationId,
    targetSubscriptionId: subscription.subscriptionId,
    expiresAt: newExpiry,
    actorUid,
  });

  await syncActivatedSeats(organizationId, restored.activatedSeats, actorUid);

  if (org.status === "EXPIRED") {
    await db
      .collection(Collections.organizations)
      .doc(organizationId)
      .update({ status: "ACTIVE", updatedAt: serverTimestamp(), updatedBy: actorUid });
  }

  await writeAuditLog({
    actorUid,
    actorRole: "SUPER_ADMIN",
    action: "SUBSCRIPTION_EXTENDED",
    organizationId,
    targetType: "subscription",
    targetId: subscription.subscriptionId,
    metadata: {
      newExpiresAt,
      licensesRestored: restored.licensesRestored,
      studentsReactivated: restored.studentsReactivated,
    },
  });

  return restored;
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
