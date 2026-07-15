# Android Backend Integration

This document is for the CensorX Android developer integrating with the
Institute Portal's shared backend service for organization code redemption.

## API base URL

- Production: `https://api.censorx.in/api/v1`
- If this logic is later migrated into Firebase Functions, the equivalent
  Functions URL will be documented here at that time — the request/response
  contracts below will remain the same.

## Required headers

```
Authorization: Bearer <FIREBASE_ID_TOKEN>
X-Firebase-AppCheck: <app-check-token>   (once App Check is enforced)
Content-Type: application/json
```

The Firebase ID token must come from the **same Firebase project** as the
Android app already uses (shared Auth). The backend verifies it with the
Firebase Admin SDK on every request.

## Redeem an activation code

```
POST /api/v1/organization/licenses/redeem
```

Request body:
```json
{
  "code": "MNSTR7K3MQ9TD4PWAR8F2",
  "deviceId": "string",
  "deviceFingerprint": "string",
  "deviceModel": "string",
  "studentIdentifier": "string",
  "studentName": "string",
  "studentEmail": "optional@example.com"
}
```

Success response:
```json
{
  "success": true,
  "data": {
    "licenseId": "string",
    "organizationId": "string",
    "expiresAt": "ISO-8601 timestamp"
  },
  "meta": {}
}
```

Failure response (always generic — do not attempt to infer why redemption
failed from the message; log analysis happens server-side only):
```json
{
  "success": false,
  "error": { "code": "REDEMPTION_FAILED", "message": "Code cannot be redeemed." }
}
```

## Entitlement endpoints

```
GET  /api/v1/organization/entitlement
POST /api/v1/organization/entitlement/refresh
```

Both require the same `Authorization` header. Use `refresh` periodically
(e.g. once per app foreground, or daily) to re-validate server-side status
and extend the offline validity window.

## Code normalization (must match exactly)

Before hashing, codes are normalized as:
1. Strip all whitespace and hyphens.
2. Uppercase the remaining characters.

Examples:
- `cx-7k3m-q9td-4pwa-r8f2` -> `CX7K3MQ9TD4PWAR8F2`
- `mnstr-01` -> `MNSTR01`
- `mnstr7k3mq9td4pwar8f2` -> `MNSTR7K3MQ9TD4PWAR8F2`

Institute portal admins can now generate organization codes in either of
these formats:
- School-prefix plus random suffix, e.g. `MNSTR7K3MQ9TD4PWAR8F2`
- School-prefix plus student identifier, e.g. `MNSTR01`

The format changed only at the plaintext-code layer. Storage and redemption
still use the same normalization and HMAC-SHA256 hashing pipeline:
`normalizeActivationCode(rawCode)` followed by
`hashActivationCode(normalizedCode)`.

The Android app does **not** need to replicate hashing — only pass the raw,
user-entered code to the redeem endpoint. The backend performs
normalization and HMAC-SHA256 hashing server-side.

## Why the Android app must not contain hardcoded codes

Activation codes are single-use, cryptographically random secrets tied to a
specific license record. Hardcoding any value defeats the security model and
risks shipping a working code inside the APK.

## Why the Android app must not know `ORG_CODE_PEPPER`

The pepper is the secret key used to HMAC-hash codes before storage. If it
ships inside the app, anyone could compute valid-looking code hashes offline
and attempt redemption/enumeration attacks. It must exist only on the
backend.

## Why expiry must use backend server time

Device clocks can be changed by the user. All expiry checks (subscription
expiry, license expiry) are evaluated using Firestore server timestamps on
the backend — never trust a client-supplied date for expiry logic.

## Why organization access must stay separate from parent subscriptions

`userOrganizationEntitlements/{uid}` records use `source: "ORGANIZATION_LICENSE"`
specifically so organization-funded access can be told apart from a user's
personal/parent-purchased subscription. Do not merge these into a single
entitlement type — a student's organization access should not be able to
silently override or be overridden by an unrelated personal subscription.

## Secure local entitlement caching

Cache the entitlement response locally (e.g. encrypted local storage) along
with `offlineValidUntil`. Allow app functionality while offline only until
that timestamp, then require a successful `entitlement/refresh` call before
continuing.

## Generic error handling

Always show the user a generic "this code could not be redeemed, please
check it and try again" message. Do not display backend error codes/messages
verbatim in the UI — they are meant for logs, not end users.
