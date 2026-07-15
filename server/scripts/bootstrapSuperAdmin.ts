/**
 * Bootstraps the FIRST Super Admin portal user.
 *
 * There is intentionally no public registration flow for portal admins.
 * This script is the only way to create a SUPER_ADMIN portalUsers doc.
 *
 * Usage:
 *   ALLOW_ADMIN_BOOTSTRAP=true npm run bootstrap:superadmin -- --email=admin@censorx.in
 *   ALLOW_ADMIN_BOOTSTRAP=true npm run bootstrap:superadmin -- --uid=<firebase-uid>
 *
 * The target user MUST already exist in the shared Firebase Authentication
 * project (create them in the Firebase Console first, or have them sign up
 * via a separate trusted flow) — this script never creates Auth users.
 */
import { env } from "../src/config/env";
import { adminAuth } from "../src/config/firebaseAdmin";
import { Collections } from "../src/config/collections";
import { db, serverTimestamp } from "../src/repositories/firestoreRepository";

async function main() {
  if (!env.ALLOW_ADMIN_BOOTSTRAP) {
    console.error(
      "Refusing to run: set ALLOW_ADMIN_BOOTSTRAP=true in the environment to enable this script."
    );
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const emailArg = args.find((a) => a.startsWith("--email="))?.split("=")[1];
  const uidArg = args.find((a) => a.startsWith("--uid="))?.split("=")[1];

  if (!emailArg && !uidArg) {
    console.error("Provide --email=<email> or --uid=<firebase-uid>");
    process.exit(1);
  }

  const userRecord = uidArg
    ? await adminAuth.getUser(uidArg)
    : await adminAuth.getUserByEmail(emailArg!);

  await db
    .collection(Collections.portalUsers)
    .doc(userRecord.uid)
    .set(
      {
        uid: userRecord.uid,
        email: userRecord.email ?? "",
        displayName: userRecord.displayName ?? userRecord.email ?? "Super Admin",
        role: "SUPER_ADMIN",
        organizationId: null,
        status: "ACTIVE",
        mustChangePassword: false,
        createdAt: serverTimestamp(),
        createdBy: "bootstrap-script",
        updatedAt: serverTimestamp(),
        lastLoginAt: null,
      },
      { merge: true }
    );

  // Optional coarse secondary check via custom claims.
  await adminAuth.setCustomUserClaims(userRecord.uid, { portalRole: "SUPER_ADMIN" });

  console.log(`Super Admin bootstrap complete for uid=${userRecord.uid} email=${userRecord.email}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
