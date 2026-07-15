import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

/**
 * IMPORTANT: These values must come from the SAME Firebase project the
 * CensorX Android app already uses — never create a new Firebase project
 * for the website. See docs/SHARED_FIREBASE_SETUP.md for exactly where
 * to copy these values from in the Firebase Console.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseApp = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);

// App Check is intentionally NOT initialized by default. Enable once the
// shared Firebase project has App Check configured and verified — see
// VITE_ENABLE_APP_CHECK / VITE_FIREBASE_APP_CHECK_SITE_KEY.
