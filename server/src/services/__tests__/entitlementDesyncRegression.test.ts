import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression cover for the production incident of 2026-08-04, in which a
 * student with a healthy, unexpired licence lost access overnight.
 *
 * Three defects compounded:
 *   A. refreshEntitlement demanded subscription.status === "ACTIVE", so a
 *      RENEWED (superseded but unexpired) subscription denied access.
 *   C. A renewal that selected zero batches still superseded the subscription
 *      every existing licence sat on, stranding them.
 *   B. The expiry sweep wrote EXPIRED to the one-per-student entitlement while
 *      expiring a stale sibling licence, clobbering a valid entitlement.
 *
 * The whole sequence passed 56 pre-existing tests undetected, so it is
 * reproduced here end to end rather than as three isolated unit checks.
 */

process.env.ORG_CODE_PEPPER = "a-very-long-test-pepper-value-1234567890";
process.env.CLIENT_ORIGINS = "http://localhost:5173";
process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/fake-service-account.json";

type StoredDoc = Record<string, unknown>;

const firestoreMock = vi.hoisted(() => {
  const stores = new Map<string, Map<string, StoredDoc>>();
  const counters = new Map<string, number>();

  function getStore(name: string) {
    let store = stores.get(name);
    if (!store) {
      store = new Map<string, StoredDoc>();
      stores.set(name, store);
    }
    return store;
  }

  function applyWrite(ref: any, data: StoredDoc, merge = false) {
    const store = getStore(ref.collectionName);
    const existing = merge ? store.get(ref.id) ?? {} : {};
    store.set(ref.id, { ...existing, ...data });
  }

  function makeDocRef(collectionName: string, id: string): any {
    return {
      id,
      collectionName,
      get: async () => makeDocSnap(collectionName, id),
      set: async (d: StoredDoc, o?: { merge?: boolean }) => applyWrite({ collectionName, id }, d, o?.merge),
      update: async (d: StoredDoc) => applyWrite({ collectionName, id }, d, true),
    };
  }

  function makeDocSnap(collectionName: string, id: string): any {
    const data = getStore(collectionName).get(id);
    return {
      id,
      exists: !!data,
      ref: makeDocRef(collectionName, id),
      data: () => (data ? { ...data } : undefined),
    };
  }

  function makeQuery(collectionName: string, filters: Array<[string, unknown]> = [], max?: number): any {
    return {
      where: (f: string, _o: string, v: unknown) => makeQuery(collectionName, [...filters, [f, v]], max),
      limit: (n: number) => makeQuery(collectionName, filters, n),
      get: async () => {
        const docs = Array.from(getStore(collectionName).entries())
          .filter(([, d]) => filters.every(([f, v]) => d[f] === v))
          .slice(0, max)
          .map(([id]) => makeDocSnap(collectionName, id));
        return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn: any) => docs.forEach(fn) };
      },
    };
  }

  const db: any = {
    collection: vi.fn((name: string) => ({
      doc: (id: string) => makeDocRef(name, id),
      where: (f: string, o: string, v: unknown) => makeQuery(name).where(f, o, v),
      limit: (n: number) => makeQuery(name).limit(n),
      get: () => makeQuery(name).get(),
    })),
    batch: vi.fn(() => {
      const ops: Array<() => void> = [];
      return {
        update: (ref: any, d: StoredDoc) => ops.push(() => applyWrite(ref, d, true)),
        set: (ref: any, d: StoredDoc, o?: { merge?: boolean }) => ops.push(() => applyWrite(ref, d, o?.merge)),
        commit: async () => ops.forEach((op) => op()),
      };
    }),
    runTransaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => {
      const ops: Array<() => void> = [];
      const tx = {
        get: (ref: any) => ref.get(),
        set: (ref: any, d: StoredDoc, o?: { merge?: boolean }) => ops.push(() => applyWrite(ref, d, o?.merge)),
        update: (ref: any, d: StoredDoc) => ops.push(() => applyWrite(ref, d, true)),
        create: (ref: any, d: StoredDoc) => ops.push(() => applyWrite(ref, d)),
      };
      const r = await fn(tx);
      ops.forEach((op) => op());
      return r;
    }),
  };

  return {
    db,
    getStore,
    seed: (n: string, id: string, d: StoredDoc) => getStore(n).set(id, d),
    newDocId: vi.fn((n: string) => {
      const next = (counters.get(n) ?? 0) + 1;
      counters.set(n, next);
      return `${n}-${next}`;
    }),
    reset: () => {
      stores.clear();
      counters.clear();
    },
  };
});

vi.mock("../../repositories/firestoreRepository", () => ({
  db: firestoreMock.db,
  collection: vi.fn((n: string) => firestoreMock.db.collection(n)),
  newDocId: firestoreMock.newDocId,
  serverTimestamp: vi.fn(() => "SERVER_TS"),
}));
vi.mock("../../config/firebaseAdmin", () => ({ adminAuth: {}, db: firestoreMock.db }));
vi.mock("../../repositories/auditLogRepository", () => ({ writeAuditLog: vi.fn() }));
vi.mock("../emailService", () => ({
  sendBatchRenewalEmail: vi.fn(),
  sendActivationCodesEmail: vi.fn(),
  sendSchoolAdminWelcomeEmail: vi.fn(),
}));

const ts = (isoStr: string) => ({
  toMillis: () => new Date(isoStr).getTime(),
  toDate: () => new Date(isoStr),
});

const ORG = "org-1";
const STUDENT = "student-1";
const PAST = "2026-07-18T00:00:00.000Z";
const NOW = new Date("2026-08-05T03:15:00.000Z");

/**
 * Mirrors the real school: one live licence in batch "c", plus older stale
 * licences for the SAME student from previous subscriptions.
 */
function seedSchool() {
  firestoreMock.seed("organizations", ORG, {
    organizationId: ORG,
    name: "tabish high school",
    contactEmail: "admin@school.test",
    status: "ACTIVE",
    currentSubscriptionId: "sub-current",
    activatedSeats: 1,
    purchasedSeats: 34,
  });
  firestoreMock.seed("organizationSubscriptions", "sub-current", {
    subscriptionId: "sub-current",
    organizationId: ORG,
    planDuration: "YEARLY",
    status: "ACTIVE",
    startAt: ts("2026-08-04T00:00:00.000Z"),
    expiresAt: ts("2027-08-08T00:00:00.000Z"),
    createdAt: ts("2026-08-04T00:00:00.000Z"),
    seatLimit: 34,
    renewedFromSubscriptionId: null,
  });
  // A long-dead subscription the student also has a licence on.
  firestoreMock.seed("organizationSubscriptions", "sub-stale", {
    subscriptionId: "sub-stale",
    organizationId: ORG,
    planDuration: "YEARLY",
    status: "RENEWED",
    startAt: ts("2026-07-15T00:00:00.000Z"),
    expiresAt: ts(PAST),
    createdAt: ts("2026-07-15T00:00:00.000Z"),
    seatLimit: 15,
    renewedFromSubscriptionId: null,
  });

  // The student's CURRENT, healthy licence.
  firestoreMock.seed("organizationLicenses", "lic-live", {
    licenseId: "lic-live",
    organizationId: ORG,
    subscriptionId: "sub-current",
    batchName: "c",
    status: "ACTIVE",
    studentUid: STUDENT,
    expiresAt: ts("2027-08-08T00:00:00.000Z"),
    createdAt: ts("2026-07-28T00:00:00.000Z"),
  });
  firestoreMock.seed("organizationActivationCodes", "code-live", {
    codeHash: "code-live",
    codeLast4: "SJNX",
    licenseId: "lic-live",
    organizationId: ORG,
    subscriptionId: "sub-current",
    batchName: "c",
    status: "REDEEMED",
    createdAt: ts("2026-07-28T00:00:00.000Z"),
  });

  // A genuinely stale licence for the SAME student — the clobber vector.
  firestoreMock.seed("organizationLicenses", "lic-stale", {
    licenseId: "lic-stale",
    organizationId: ORG,
    subscriptionId: "sub-stale",
    batchName: "old",
    status: "ACTIVE",
    studentUid: STUDENT,
    expiresAt: ts(PAST),
    createdAt: ts("2026-07-15T00:00:00.000Z"),
  });
  firestoreMock.seed("organizationActivationCodes", "code-stale", {
    codeHash: "code-stale",
    codeLast4: "OLD1",
    licenseId: "lic-stale",
    organizationId: ORG,
    subscriptionId: "sub-stale",
    batchName: "old",
    status: "REDEEMED",
    createdAt: ts("2026-07-15T00:00:00.000Z"),
  });

  firestoreMock.seed("userOrganizationEntitlements", STUDENT, {
    uid: STUDENT,
    organizationId: ORG,
    licenseId: "lic-live",
    subscriptionId: "sub-current",
    status: "ACTIVE",
    expiresAt: ts("2027-08-08T00:00:00.000Z"),
    createdAt: ts("2026-07-28T00:00:00.000Z"),
  });
}

describe("entitlement desync regression (2026-08-04 incident)", () => {
  beforeEach(() => {
    firestoreMock.reset();
    seedSchool();
  });

  it("renewal with empty renewedBatches must not break existing valid licences' entitlements", async () => {
    const { renewBatches } = await import("../organizationService");
    const { runExpirySweep } = await import("../expirySweepService");
    const { refreshEntitlement } = await import("../redemptionService");

    // 1. Renew the batch the student is actually in.
    await renewBatches(
      ORG,
      {
        batchNames: ["c"],
        planDuration: "YEARLY",
        startAt: "2026-08-04T00:00:00.000Z",
        expiresAt: "2027-08-08T00:00:00.000Z",
        idempotencyKey: "idem-regression-1",
      },
      "super-admin"
    );
    expect((await refreshEntitlement(STUDENT)).status).toBe("ACTIVE");

    // 2. The trigger: a second renewal that renews NOTHING and only allocates
    //    seats. This supersedes the subscription the licence sits on.
    const second = await renewBatches(
      ORG,
      {
        batchNames: [],
        newBatch: { batchName: "new batch", seatCount: 10 },
        planDuration: "YEARLY",
        startAt: "2026-08-04T00:00:00.000Z",
        expiresAt: "2027-08-05T00:00:00.000Z",
        idempotencyKey: "idem-regression-2",
      },
      "super-admin"
    );
    expect(second.renewedBatches).toEqual([]);

    // Defect C: the live licence must not be stranded on the superseded record.
    const liveLicence = firestoreMock.getStore("organizationLicenses").get("lic-live");
    expect(liveLicence?.subscriptionId).toBe(second.subscriptionId);
    // Carrying over must NOT hand out extra time.
    expect((liveLicence?.expiresAt as any).toDate().toISOString()).toBe("2027-08-08T00:00:00.000Z");

    // Defect A: access survives the supersede.
    expect((await refreshEntitlement(STUDENT)).status).toBe("ACTIVE");

    // 3. The overnight sweep, which expires the student's stale sibling licence.
    const sweep = await runExpirySweep({ now: NOW });
    expect(firestoreMock.getStore("organizationLicenses").get("lic-stale")?.status).toBe("EXPIRED");

    // Defect B: the stale licence must not speak for the student.
    expect(sweep.entitlementsExpired).toBe(0);
    expect(firestoreMock.getStore("userOrganizationEntitlements").get(STUDENT)?.status).toBe("ACTIVE");

    // 4. The symptom that was actually reported: the morning after.
    expect((await refreshEntitlement(STUDENT)).status).toBe("ACTIVE");
    expect(firestoreMock.getStore("organizationLicenses").get("lic-live")?.status).toBe("ACTIVE");
  });

  it("a RENEWED but unexpired subscription still provides coverage (Defect A)", async () => {
    const { subscriptionProvidesCoverage } = await import("../../repositories/organizationRepository");

    const superseded = { status: "RENEWED" as const, expiresAt: ts("2027-08-08T00:00:00.000Z") as any };
    const lapsed = { status: "RENEWED" as const, expiresAt: ts(PAST) as any };
    const cancelled = { status: "CANCELLED" as const, expiresAt: ts("2027-08-08T00:00:00.000Z") as any };

    expect(subscriptionProvidesCoverage(superseded, NOW)).toBe(true);
    // A superseded subscription past its own date does stop covering.
    expect(subscriptionProvidesCoverage(lapsed, NOW)).toBe(false);
    // Cancellation withdraws service regardless of remaining window.
    expect(subscriptionProvidesCoverage(cancelled, NOW)).toBe(false);
    expect(subscriptionProvidesCoverage(null, NOW)).toBe(false);
  });

  it("still expires the entitlement when the student has no live licence left (Defect B not over-corrected)", async () => {
    const { runExpirySweep } = await import("../expirySweepService");

    // Point the entitlement at the stale licence and kill the live one.
    firestoreMock.seed("userOrganizationEntitlements", STUDENT, {
      uid: STUDENT,
      organizationId: ORG,
      licenseId: "lic-stale",
      subscriptionId: "sub-stale",
      status: "ACTIVE",
      expiresAt: ts(PAST),
    });
    firestoreMock.getStore("organizationLicenses").delete("lic-live");

    const sweep = await runExpirySweep({ now: NOW });

    expect(sweep.entitlementsExpired).toBe(1);
    expect(firestoreMock.getStore("userOrganizationEntitlements").get(STUDENT)?.status).toBe("EXPIRED");
  });

  it("renewSubscription rejects an expiry earlier than its start (Defect from sub xwC2f94vJQL5DyCjRRbF)", async () => {
    const { renewSubscription } = await import("../organizationService");

    await expect(
      renewSubscription(
        ORG,
        {
          planDuration: "YEARLY",
          startAt: "2026-07-28T00:00:00.000Z",
          expiresAt: "2026-07-03T00:00:00.000Z",
        },
        "super-admin"
      )
    ).rejects.toMatchObject({ code: "INVALID_PLAN_DATES" });
  });
});
