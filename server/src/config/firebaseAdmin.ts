import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getAuth, type Auth } from "firebase-admin/auth";
import { env } from "./env";

/**
 * IMPORTANT: This connects to the SAME Firebase project already used by the
 * CensorX Android application. Do NOT point this at a new/separate project.
 *
 * Two supported credential modes:
 *  1. GOOGLE_APPLICATION_CREDENTIALS -> path to a downloaded service-account
 *     JSON file. Recommended for local development.
 *  2. FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY ->
 *     discrete env vars. Recommended for Render / production, where the
 *     private key is stored as a single-line escaped string and newlines
 *     must be restored.
 */
function buildFirebaseApp(): App {
  const existing = getApps();
  if (existing.length > 0) {
    return existing[0];
  }

  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    // The Admin SDK will automatically pick up GOOGLE_APPLICATION_CREDENTIALS
    // from the environment when no explicit credential is passed.
    return initializeApp();
  }

  const privateKey = (env.FIREBASE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");

  return initializeApp({
    credential: cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

export const firebaseApp: App = buildFirebaseApp();
export const db: Firestore = getFirestore(firebaseApp);
export const adminAuth: Auth = getAuth(firebaseApp);

// Firestore settings that are safe defaults for server-side usage.
db.settings({ ignoreUndefinedProperties: true });
