# Shared Firebase Setup

This website must connect to the **same** Firebase project already used by
the CensorX Android application. Do not create a new Firebase project, a new
Firestore database, or a second organization/licensing system.

## Steps

1. Open the [Firebase Console](https://console.firebase.google.com).
2. Select the **existing** Firebase project used by the Android app (do not
   click "Add project").
3. Go to **Project Settings** (gear icon).
4. Under **Your apps**, check whether a **Web app** already exists.
   - If not, click **Add app → Web** and register a new web app named e.g.
     `CensorX Institute Portal`.
5. Copy the Firebase Web SDK config values shown into `client/.env`:
   ```
   VITE_FIREBASE_API_KEY=
   VITE_FIREBASE_AUTH_DOMAIN=
   VITE_FIREBASE_PROJECT_ID=
   VITE_FIREBASE_STORAGE_BUCKET=
   VITE_FIREBASE_MESSAGING_SENDER_ID=
   VITE_FIREBASE_APP_ID=
   ```
6. **Do not create a new Firebase project.** Confirm the Project ID matches
   the Android app's `google-services.json` `project_id`.
7. Under **Authentication → Sign-in method**, confirm **Email/Password** is
   enabled. Enable it if it is not already.
8. Under **Project Settings → Service accounts**, generate (or reuse) a
   Firebase Admin service account:
   - For local development: download the JSON key and set
     `GOOGLE_APPLICATION_CREDENTIALS=/local/path/service-account.json` in
     `server/.env`.
   - For Render/production: copy `project_id`, `client_email`, and
     `private_key` into `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and
     `FIREBASE_PRIVATE_KEY` respectively. **Add credentials only to the
     Render backend service — never to the frontend.**
9. Under **Authentication → Settings → Authorized domains**, add:
   - `portal.censorx.in` (production)
   - Your Render frontend preview domain (during testing)
   - `localhost` (already present by default, for local dev)
10. **Firebase App Check**: leave `APP_CHECK_ENFORCED=false` /
    `VITE_ENABLE_APP_CHECK=false` until App Check is configured and verified
    end-to-end for both the website and the Android app. Configure it later
    in **App Check** in the console, then flip both flags to `true`.
11. Confirm you are pointed at the same Firestore database the Android app
    uses (Firestore → your default database, in Native mode).
12. Set `ORG_CODE_PEPPER` in `server/.env` to a long, random, secret value.
    **This exact value must also be available to the Android redemption
    flow / shared backend service** — it is used to HMAC-hash activation
    codes. Never expose this value to the React frontend.
13. **Review existing Firestore Security Rules** before deploying anything
    new. The Android app may already depend on the current rules. See
    `docs/firestore.rules.proposed` for a proposed ruleset scoped to the
    portal's collections — merge it carefully, don't replace wholesale.
14. **Review existing Android data collections** before this website writes
    to any collection. Collection names in
    `server/src/config/collections.ts` are assumed values — update them to
    match whatever the Android app already uses if they differ.

## Summary of required environment variables

### `client/.env`
```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_API_BASE_URL=http://localhost:8080/api/v1
VITE_ENABLE_APP_CHECK=false
VITE_FIREBASE_APP_CHECK_SITE_KEY=
```

### `server/.env`
```
NODE_ENV=development
PORT=8080
CLIENT_ORIGINS=http://localhost:5173
GOOGLE_APPLICATION_CREDENTIALS=
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
ORG_CODE_PEPPER=
APP_CHECK_ENFORCED=false
ALLOW_ADMIN_BOOTSTRAP=false
TRUST_PROXY=1
LOG_LEVEL=info
```
