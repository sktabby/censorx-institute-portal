/**
 * One-time migration to the batch model.
 *
 * For every school:
 *   1. Every existing subscription period becomes part of "Batch 1" (batchNumber 1) unless it
 *      already carries a batch number.
 *   2. Periods that have already ended, were renewed or were cancelled are stamped as
 *      "already notified", so the first run of the notification job sends no old notices.
 *   3. The school's aggregates are recomputed from its batches and licences:
 *        purchasedSeats = seats of every live batch, activatedSeats = students holding a seat,
 *        status ACTIVE while any batch is live / EXPIRED when all have ended (SUSPENDED and
 *        ARCHIVED are kept), currentSubscriptionId = the primary batch.
 *
 * Safe to run more than once. Nothing is deleted.
 *
 * Usage:
 *   npx tsx scripts/migrateToBatches.ts           # report only
 *   npx tsx scripts/migrateToBatches.ts --apply   # write changes
 */
import { Timestamp } from "firebase-admin/firestore";
import { Collections } from "../src/config/collections";
import { db } from "../src/config/firebaseAdmin";
import {
  getEffectiveLicenseStatus,
  isLiveBatch,
  pickPrimarySubscription,
  sumLiveSeatLimit,
} from "../src/repositories/organizationRepository";
import type { Organization, OrganizationLicense, OrganizationSubscription } from "../src/models/types";

const APPLY = process.argv.includes("--apply");

function log(message: string) {
  // eslint-disable-next-line no-console
  console.log(message);
}

async function main() {
  const now = new Date();
  const nowTimestamp = Timestamp.fromDate(now);
  const [orgsSnap, subscriptionsSnap, licensesSnap] = await Promise.all([
    db.collection(Collections.organizations).get(),
    db.collection(Collections.organizationSubscriptions).get(),
    db.collection(Collections.organizationLicenses).get(),
  ]);

  const subscriptionsByOrg = new Map<string, Array<{ ref: FirebaseFirestore.DocumentReference; data: OrganizationSubscription }>>();
  subscriptionsSnap.docs.forEach((doc) => {
    const data = doc.data() as OrganizationSubscription;
    const bucket = subscriptionsByOrg.get(data.organizationId) ?? [];
    bucket.push({ ref: doc.ref, data });
    subscriptionsByOrg.set(data.organizationId, bucket);
  });
  const subscriptionById = new Map<string, OrganizationSubscription>();
  subscriptionsSnap.docs.forEach((doc) => subscriptionById.set(doc.id, doc.data() as OrganizationSubscription));

  const licensesByOrg = new Map<string, OrganizationLicense[]>();
  licensesSnap.docs.forEach((doc) => {
    const license = doc.data() as OrganizationLicense;
    const bucket = licensesByOrg.get(license.organizationId) ?? [];
    bucket.push(license);
    licensesByOrg.set(license.organizationId, bucket);
  });

  let subscriptionUpdates = 0;
  let organizationUpdates = 0;
  const writes: Array<() => Promise<unknown>> = [];

  for (const orgDoc of orgsSnap.docs) {
    const org = orgDoc.data() as Organization;
    const periods = subscriptionsByOrg.get(org.organizationId) ?? [];
    log(`\n${org.organizationId}  ${org.name}  (${periods.length} period(s), stored status ${org.status})`);

    // 1 + 2: batch number and notification stamps on each period.
    for (const period of periods) {
      const update: Record<string, unknown> = {};
      if (period.data.batchNumber === undefined || period.data.batchNumber === null) {
        update.batchNumber = 1;
        update.batchLabel = period.data.batchLabel ?? "Batch 1";
      }
      const ended = period.data.expiresAt.toMillis() <= now.getTime();
      const superseded = period.data.status === "RENEWED" || period.data.status === "CANCELLED";
      if ((ended || superseded) && !period.data.endedNoticeSentAt) {
        update.endedNoticeSentAt = nowTimestamp;
        update.endedEmailedAt = nowTimestamp;
      }
      if ((ended || superseded) && !period.data.renewalReminderSentAt) {
        update.renewalReminderSentAt = nowTimestamp;
        update.renewalReminderEmailedAt = nowTimestamp;
      }
      if (Object.keys(update).length === 0) continue;

      subscriptionUpdates++;
      log(`  period ${period.data.subscriptionId}: ${JSON.stringify(Object.keys(update))}`);
      writes.push(() => period.ref.update({ ...update, updatedAt: nowTimestamp }));
    }

    // 3: aggregates from batches and licences.
    const effectivePeriods = periods.map((period) => ({
      ...period.data,
      batchNumber: period.data.batchNumber ?? 1,
    }));
    const licenses = licensesByOrg.get(org.organizationId) ?? [];
    const activatedSeats = licenses.filter(
      (license) => getEffectiveLicenseStatus(license, subscriptionById.get(license.subscriptionId), now) === "ACTIVE"
    ).length;
    const purchasedSeats = sumLiveSeatLimit(effectivePeriods, now);
    const primary = pickPrimarySubscription(effectivePeriods, now);

    const orgUpdate: Record<string, unknown> = {};
    if ((org.purchasedSeats ?? 0) !== purchasedSeats) orgUpdate.purchasedSeats = purchasedSeats;
    if ((org.activatedSeats ?? 0) !== activatedSeats) orgUpdate.activatedSeats = activatedSeats;
    if (org.status === "ACTIVE" || org.status === "EXPIRED") {
      if (effectivePeriods.length > 0) {
        const status = effectivePeriods.some((period) => isLiveBatch(period, now)) ? "ACTIVE" : "EXPIRED";
        if (status !== org.status) orgUpdate.status = status;
      }
    }
    if (primary && org.currentSubscriptionId !== primary.subscriptionId) {
      orgUpdate.currentSubscriptionId = primary.subscriptionId;
    }

    if (Object.keys(orgUpdate).length > 0) {
      organizationUpdates++;
      log(
        `  school: ${Object.entries(orgUpdate)
          .map(([key, value]) => `${key} ${String((org as unknown as Record<string, unknown>)[key])} -> ${String(value)}`)
          .join(", ")}`
      );
      writes.push(() => orgDoc.ref.update({ ...orgUpdate, updatedAt: nowTimestamp }));
    } else {
      log("  school: no change");
    }
  }

  log(`\n${subscriptionUpdates} period(s) and ${organizationUpdates} school(s) need updating out of ${orgsSnap.size} school(s).`);

  if (!APPLY) {
    log("Report only. Re-run with --apply to write these changes.");
    return;
  }

  for (const write of writes) {
    await write();
  }
  log(`Applied ${writes.length} write(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
