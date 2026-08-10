/**
 * Recomputes organizations.activatedSeats from actual licence state.
 *
 * Read paths derive seats from effective licence status (see
 * utils/seatAccounting), so a drifted counter is invisible in the UI — but
 * redemptionService still gates on `activatedSeats >= purchasedSeats` inside
 * the redemption transaction, where a collection scan is not possible. A
 * counter that has drifted LOW silently oversells seats; one that has drifted
 * HIGH locks students out of redemption.
 *
 * Usage:
 *   npx tsx scripts/reconcileActivatedSeats.ts           # report only
 *   npx tsx scripts/reconcileActivatedSeats.ts --apply   # write corrections
 */
import { Collections } from "../src/config/collections";
import { db } from "../src/config/firebaseAdmin";
import { getEffectiveLicenseStatus } from "../src/repositories/organizationRepository";
import type { Organization, OrganizationLicense, OrganizationSubscription } from "../src/models/types";

const APPLY = process.argv.includes("--apply");

async function main() {
  const now = new Date();
  const [orgsSnap, licensesSnap, subscriptionsSnap] = await Promise.all([
    db.collection(Collections.organizations).get(),
    db.collection(Collections.organizationLicenses).get(),
    db.collection(Collections.organizationSubscriptions).get(),
  ]);

  const subscriptionById = new Map<string, OrganizationSubscription>();
  subscriptionsSnap.docs.forEach((doc) => subscriptionById.set(doc.id, doc.data() as OrganizationSubscription));

  const activeByOrg = new Map<string, number>();
  licensesSnap.docs.forEach((doc) => {
    const license = doc.data() as OrganizationLicense;
    const effective = getEffectiveLicenseStatus(license, subscriptionById.get(license.subscriptionId), now);
    if (effective !== "ACTIVE") return;
    activeByOrg.set(license.organizationId, (activeByOrg.get(license.organizationId) ?? 0) + 1);
  });

  let drifted = 0;
  const updates: Array<{ id: string; from: number; to: number }> = [];

  for (const doc of orgsSnap.docs) {
    const org = doc.data() as Organization;
    const actual = activeByOrg.get(org.organizationId) ?? 0;
    const stored = org.activatedSeats ?? 0;
    if (stored === actual) continue;

    drifted++;
    updates.push({ id: org.organizationId, from: stored, to: actual });
    // eslint-disable-next-line no-console
    console.log(
      `${org.organizationId}  ${org.name}\n  activatedSeats stored=${stored} actual=${actual} (drift ${actual - stored})`
    );
  }

  // eslint-disable-next-line no-console
  console.log(`\n${drifted} organization(s) drifted out of ${orgsSnap.size}.`);

  if (!APPLY) {
    // eslint-disable-next-line no-console
    console.log("Report only. Re-run with --apply to write corrections.");
    return;
  }

  for (const update of updates) {
    await db
      .collection(Collections.organizations)
      .doc(update.id)
      .update({ activatedSeats: update.to, updatedAt: new Date() });
    // eslint-disable-next-line no-console
    console.log(`corrected ${update.id}: ${update.from} -> ${update.to}`);
  }

  // eslint-disable-next-line no-console
  console.log(`\nApplied ${updates.length} correction(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
