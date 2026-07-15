# CensorX.ai Institute Portal

A standalone website (React + Node.js/Express) for CensorX school and
institute partnerships. It connects to the **same shared Firebase project**
(Firestore + Firebase Authentication) already used by the CensorX Android
app — it does not create a new Firebase project or a second licensing
system.

## Project structure

```
censorx-institute-portal/
├── client/                 React + TypeScript + Vite + Tailwind frontend
│   └── src/
│       ├── api/             Axios client (attaches Firebase ID token)
│       ├── components/      Reusable UI (DataTable, StatusBadge, SummaryCard)
│       ├── config/          Firebase client SDK config
│       ├── contexts/        AuthContext (Firebase auth + /auth/me profile)
│       ├── layouts/         PublicLayout, PortalLayout (admin/school sidebar)
│       ├── pages/
│       │   ├── admin/        Super Admin Portal pages
│       │   └── school/       School Portal pages
│       ├── routes/          ProtectedRoute (role-based route guarding)
│       └── types/
├── server/                 Node.js + TypeScript + Express backend
│   └── src/
│       ├── config/          env validation, Firebase Admin init, logger, collections
│       ├── controllers/     Route handlers
│       ├── middleware/      Auth, validation, rate limiting, error handling
│       ├── models/          Shared TypeScript types
│       ├── repositories/    Firestore data access
│       ├── routes/          Express routers (versioned /api/v1)
│       ├── schemas/         Zod request validation schemas
│       ├── services/        Business logic (code generation, redemption, org mgmt)
│       └── scripts/         bootstrapSuperAdmin.ts
├── docs/
│   ├── SHARED_FIREBASE_SETUP.md       How to point this at the existing Firebase project
│   ├── ANDROID_BACKEND_INTEGRATION.md For the Android developer
│   └── firestore.rules.proposed       Proposed rules — REVIEW before deploying
├── render.yaml
└── package.json
```

## Public pages

Home, Features, Contact, Login.

## Authenticated portals

- **Super Admin Portal** (`/admin`): Dashboard, Schools, Create School, Codes, Subscriptions
- **School Portal** (`/school`): Dashboard, Student Codes, Students, Subscription

## Local development

```bash
# from the repo root
npm install --workspaces

# copy env templates and fill in the shared Firebase project's values
cp client/.env.example client/.env
cp server/.env.example server/.env

# run both (in separate terminals)
npm run dev:server
npm run dev:client
```

Frontend: http://localhost:5173
Backend health check: http://localhost:8080/api/v1/health

## Creating the first Super Admin

There is no public registration for portal admins. The target user must
already exist in Firebase Authentication (create them in the Firebase
Console first), then run:

```bash
cd server
ALLOW_ADMIN_BOOTSTRAP=true npm run bootstrap:superadmin -- --email=admin@censorx.in
```

## Build & test

```bash
npm run typecheck:client
npm run typecheck:server
npm run test:server
npm run build:client
npm run build:server
```

## Deployment (Render)

See `render.yaml`. Two services:
- `censorx-institute-portal-api` (Express, → `api.censorx.in`)
- `censorx-institute-portal-client` (static Vite build, → `portal.censorx.in`)

Set the environment variables listed in `server/.env.example` and
`client/.env.example` in the Render dashboard (they are marked `sync: false`
in `render.yaml` and must be entered manually).

## Shared Firebase project — required reading before deploying

See `docs/SHARED_FIREBASE_SETUP.md`. In short: **do not create a new
Firebase project.** Point both `client/.env` and `server/.env` at the
existing project already used by the Android app, and review
`docs/firestore.rules.proposed` with someone familiar with the Android
app's existing Firestore rules before merging/deploying any rules changes.

## Android integration

See `docs/ANDROID_BACKEND_INTEGRATION.md` for the redemption API contract
the Android app will call.
