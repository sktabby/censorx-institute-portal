import { beforeEach, describe, expect, it, vi } from "vitest";

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

  function makeDocRef(collectionName: string, id: string): any {
    return {
      id,
      collectionName,
      get: async () => makeDocSnap(collectionName, id),
      update: async (data: StoredDoc) => applyWrite({ collectionName, id }, data, true),
      set: async (data: StoredDoc, options?: { merge?: boolean }) =>
        applyWrite({ collectionName, id }, data, options?.merge),
      delete: async () => getStore(collectionName).delete(id),
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
          .filter(([, data]) => filters.every(([f, v]) => data[f] === v))
          .slice(0, max)
          .map(([id]) => makeDocSnap(collectionName, id));
        return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn: any) => docs.forEach(fn) };
      },
    };
  }

  function applyWrite(ref: any, data: StoredDoc, merge = false) {
    const store = getStore(ref.collectionName);
    const existing = merge ? store.get(ref.id) ?? {} : {};
    store.set(ref.id, { ...existing, ...data });
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
        update: (ref: any, data: StoredDoc) => ops.push(() => applyWrite(ref, data, true)),
        set: (ref: any, data: StoredDoc, o?: { merge?: boolean }) => ops.push(() => applyWrite(ref, data, o?.merge)),
        commit: async () => ops.forEach((op) => op()),
      };
    }),
    runTransaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => {
      const ops: Array<() => void> = [];
      const tx = {
        get: (ref: any) => ref.get(),
        set: (ref: any, data: StoredDoc, o?: { merge?: boolean }) => ops.push(() => applyWrite(ref, data, o?.merge)),
        update: (ref: any, data: StoredDoc) => ops.push(() => applyWrite(ref, data, true)),
        create: (ref: any, data: StoredDoc) => ops.push(() => applyWrite(ref, data)),
      };
      const result = await fn(tx);
      ops.forEach((op) => op());
      return result;
    }),
  };

  return {
    db,
    getStore,
    seed: (name: string, id: string, data: StoredDoc) => getStore(name).set(id, data),
    newDocId: vi.fn((name: string) => {
      const next = (counters.get(name) ?? 0) + 1;
      counters.set(name, next);
      return `${name}-${next}`;
    }),
    reset: () => {
      stores.clear();
      counters.clear();
      db.collection.mockClear();
      db.batch.mockClear();
      db.runTransaction.mockClear();
    },
  };
});

vi.mock("../../repositories/firestoreRepository", () => ({
  db: firestoreMock.db,
  collection: vi.fn((name: string) => firestoreMock.db.collection(name)),
  newDocId: firestoreMock.newDocId,
  serverTimestamp: vi.fn(() => "SERVER_TS"),
}));
vi.mock("../../config/firebaseAdmin", () => ({
  adminAuth: { deleteUser: vi.fn(async () => undefined) },
  db: firestoreMock.db,
}));
vi.mock("../../repositories/auditLogRepository", () => ({ writeAuditLog: vi.fn() }));
vi.mock("../emailService", () => ({
  sendBatchRenewalEmail: vi.fn(),
  sendActivationCodesEmail: vi.fn(),
  sendSchoolAdminWelcomeEmail: vi.fn(),
}));

const ts = (iso: string) => ({ toMillis: () => new Date(iso).getTime(), toDate: () => new Date(iso) });
const LAPSED = "2026-01-01T00:00:00.000Z";
const FUTURE = "2099-01-01T00:00:00.000Z";

function seedSubscription(id: string, expiresAt: string, status = "ACTIVE") {
  firestoreMock.seed("organizationSubscriptions", id, {
    subscriptionId: id,
    organizationId: "org-1",
    planDuration: "YEARLY",
    status,
    startAt: ts("2025-01-01T00:00:00.000Z"),
    expiresAt: ts(expiresAt),
    createdAt: ts("2025-01-01T00:00:00.000Z"),
    seatLimit: 3,
    renewedFromSubscriptionId: null,
  });
}

function seedPair(
  batch: string,
  suffix: string,
  subscriptionId: string,
  codeStatus: string,
  licenseStatus: string,
  studentUid: string | null,
  expiresAt: string
) {
  firestoreMock.seed("organizationActivationCodes", `code-${suffix}`, {
    codeHash: `code-${suffix}`,
    codeLast4: "1234",
    licenseId: `lic-${suffix}`,
    organizationId: "org-1",
    subscriptionId,
    batchName: batch,
    status: codeStatus,
    createdAt: ts("2025-06-01T00:00:00.000Z"),
    redeemedAt: codeStatus === "REDEEMED" ? ts("2025-07-01T00:00:00.000Z") : null,
  });
  firestoreMock.seed("organizationLicenses", `lic-${suffix}`, {
    licenseId: `lic-${suffix}`,
    organizationId: "org-1",
    subscriptionId,
    batchName: batch,
    status: licenseStatus,
    studentUid,
    expiresAt: ts(expiresAt),
    createdAt: ts("2025-06-01T00:00:00.000Z"),
  });
}

const window2027 = {
  planDuration: "YEARLY" as const,
  startAt: "2026-07-01T00:00:00.000Z",
  expiresAt: "2027-07-01T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// 1. Seats after renewing 2 expired batches + adding 1 new batch
// ---------------------------------------------------------------------------
describe("[1] seat totals after a combined batch renewal", () => {
  beforeEach(() => {
    firestoreMock.reset();
    firestoreMock.seed("organizations", "org-1", {
      organizationId: "org-1",
      name: "Moonstar Academy",
      contactEmail: "admin@moonstar.test",
      status: "EXPIRED",
      currentSubscriptionId: "sub-old",
      activatedSeats: 1,
      purchasedSeats: 3,
    });
    seedSubscription("sub-old", LAPSED);
    seedSubscription("sub-live", FUTURE);

    // Two lapsed batches: alpha (1 redeemed + 1 unused), beta (1 unused).
    seedPair("alpha", "a1", "sub-old", "REDEEMED", "ACTIVE", "student-1", LAPSED);
    seedPair("alpha", "a2", "sub-old", "UNUSED", "UNUSED", null, LAPSED);
    seedPair("beta", "b1", "sub-old", "UNUSED", "UNUSED", null, LAPSED);
    // One still-active batch that the renewal will NOT touch.
    seedPair("live", "l1", "sub-live", "UNUSED", "UNUSED", null, FUTURE);
    seedPair("live", "l2", "sub-live", "UNUSED", "UNUSED", null, FUTURE);
  });

  it("derived total seats = renewed + new + untouched-active codes", async () => {
    const { renewBatches } = await import("../organizationService");
    const { getOrganizationSeatUsage } = await import("../../repositories/organizationRepository");

    const result = await renewBatches(
      "org-1",
      {
        batchNames: ["alpha", "beta"],
        newBatch: { batchName: "gamma", seatCount: 3 },
        ...window2027,
        idempotencyKey: "idem-signoff-1",
      },
      "super-admin"
    );

    expect(result.licensesRestored).toBe(3);
    expect(result.allocatedBatch).toMatchObject({ batchName: "gamma", seatCount: 3 });

    const usage = await getOrganizationSeatUsage("org-1");

    // Seats ALLOCATED: renewed(3) + untouched-active(2) + allocated(3) = 8.
    expect(result.seatLimit).toBe(8);
    expect(usage.seatLimit).toBe(8);

    // Seats ISSUED as licences: renewed(3) + untouched-active(2) = 5. The three
    // allocated seats have no licences yet — Create Codes generates them.
    expect(usage.totalSeats).toBe(5);
    expect(usage.activatedSeats).toBe(1);
    expect(usage.unusedCodes).toBe(4);
    expect(usage.totalSeats).toBe(usage.activatedSeats + usage.unusedCodes);

    // The gap is exactly the pending allocation, which is what Create Codes
    // will consume.
    expect(usage.remainingCapacity).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 2. A REDEEMED code that is past expiry
// ---------------------------------------------------------------------------
describe("[2] a redeemed code past its expiry", () => {
  beforeEach(() => {
    firestoreMock.reset();
    firestoreMock.seed("organizations", "org-1", {
      organizationId: "org-1",
      name: "Moonstar Academy",
      status: "ACTIVE",
      currentSubscriptionId: "sub-old",
      activatedSeats: 1,
      purchasedSeats: 1,
    });
    seedSubscription("sub-old", LAPSED);
    seedPair("alpha", "a1", "sub-old", "REDEEMED", "ACTIVE", "student-1", LAPSED);
  });

  it("displays as EXPIRED everywhere while the stored status stays REDEEMED", async () => {
    const { runExpirySweep } = await import("../expirySweepService");
    const { listOrganizationCodes, listOrganizationLicenses } = await import(
      "../../repositories/organizationRepository"
    );
    const { listCodeRows } = await import("../codeGenerationService");

    // Projection, before any sweep: both the code and its licence read EXPIRED.
    const [codeBefore] = await listOrganizationCodes("org-1");
    const [licenseBefore] = await listOrganizationLicenses("org-1");
    expect(codeBefore.status).toBe("EXPIRED");
    expect(licenseBefore.status).toBe("EXPIRED");

    // Super Admin code table (also backs the School Portal table and its CSV
    // export, which render this same `status` field).
    const rowsBefore = await listCodeRows({ organizationId: "org-1" });
    expect(rowsBefore.items[0].status).toBe("EXPIRED");

    await runExpirySweep({ now: new Date("2026-06-01T00:00:00.000Z") });

    // The licence is materialised as EXPIRED...
    expect(firestoreMock.getStore("organizationLicenses").get("lic-a1")?.status).toBe("EXPIRED");
    // ...but the code's STORED status is deliberately left REDEEMED, so a later
    // renewal cannot restore an already-used code as redeemable.
    expect(firestoreMock.getStore("organizationActivationCodes").get("code-a1")?.status).toBe("REDEEMED");

    // Display is unchanged by the sweep.
    const rowsAfter = await listCodeRows({ organizationId: "org-1" });
    expect(rowsAfter.items[0].status).toBe("EXPIRED");
  });
});

// ---------------------------------------------------------------------------
// 3. Entitlement refresh after a batch renewal restores a student
// ---------------------------------------------------------------------------
describe("[3] student access after a batch renewal", () => {
  beforeEach(() => {
    firestoreMock.reset();
    firestoreMock.seed("organizations", "org-1", {
      organizationId: "org-1",
      name: "Moonstar Academy",
      contactEmail: "admin@moonstar.test",
      status: "EXPIRED",
      currentSubscriptionId: "sub-old",
      activatedSeats: 1,
      purchasedSeats: 1,
    });
    seedSubscription("sub-old", LAPSED);
    seedPair("alpha", "a1", "sub-old", "REDEEMED", "ACTIVE", "student-1", LAPSED);
    firestoreMock.seed("userOrganizationEntitlements", "student-1", {
      uid: "student-1",
      organizationId: "org-1",
      licenseId: "lic-a1",
      subscriptionId: "sub-old",
      status: "ACTIVE",
      createdAt: ts("2025-07-01T00:00:00.000Z"),
    });
  });

  it("goes EXPIRED after the sweep, then ACTIVE again after renewal — verified via refreshEntitlement", async () => {
    const { runExpirySweep } = await import("../expirySweepService");
    const { refreshEntitlement } = await import("../redemptionService");
    const { renewBatches } = await import("../organizationService");

    // Sweep locks the student out.
    await runExpirySweep({ now: new Date("2026-06-01T00:00:00.000Z") });
    expect(firestoreMock.getStore("userOrganizationEntitlements").get("student-1")?.status).toBe("EXPIRED");

    const afterSweep = await refreshEntitlement("student-1");
    expect(afterSweep.status).toBe("EXPIRED");

    // Renew the batch the student's licence belongs to.
    const result = await renewBatches(
      "org-1",
      { batchNames: ["alpha"], ...window2027, idempotencyKey: "idem-signoff-3" },
      "super-admin"
    );
    expect(result.studentsReactivated).toBe(1);

    // Entitlement written by the renewal...
    const entitlement = firestoreMock.getStore("userOrganizationEntitlements").get("student-1");
    expect(entitlement?.status).toBe("ACTIVE");
    expect(entitlement?.subscriptionId).toBe(result.subscriptionId);

    // ...and independently re-derived by the endpoint the Android client calls.
    const refreshed = await refreshEntitlement("student-1");
    expect(refreshed.status).toBe("ACTIVE");

    // The licence itself is live again, on the same activation code.
    expect(firestoreMock.getStore("organizationLicenses").get("lic-a1")?.status).toBe("ACTIVE");
    expect(firestoreMock.getStore("organizationActivationCodes").get("code-a1")?.status).toBe("REDEEMED");
  });
});

// ---------------------------------------------------------------------------
// 4. Deleting a school whose only codes are long expired
// ---------------------------------------------------------------------------
describe("[4] deleteOrganization with only long-expired codes", () => {
  beforeEach(() => {
    firestoreMock.reset();
    firestoreMock.seed("organizations", "org-1", {
      organizationId: "org-1",
      name: "Moonstar Academy",
      status: "ACTIVE",
      currentSubscriptionId: "sub-old",
      activatedSeats: 0,
      purchasedSeats: 2,
    });
    seedSubscription("sub-old", LAPSED);
    // Stored status is still UNUSED — the raw-status guard used to block on this.
    seedPair("alpha", "a1", "sub-old", "UNUSED", "UNUSED", null, LAPSED);
    seedPair("alpha", "a2", "sub-old", "UNUSED", "UNUSED", null, LAPSED);
  });

  it("archives the school instead of refusing on stale UNUSED codes", async () => {
    const { deleteOrganization } = await import("../organizationService");

    await expect(deleteOrganization("org-1", "super-admin")).resolves.toBeUndefined();
    expect(firestoreMock.getStore("organizations").get("org-1")?.status).toBe("ARCHIVED");
  });

  it("still refuses when a code is genuinely live", async () => {
    const { deleteOrganization } = await import("../organizationService");

    seedSubscription("sub-live", FUTURE);
    seedPair("live", "l1", "sub-live", "UNUSED", "UNUSED", null, FUTURE);

    await expect(deleteOrganization("org-1", "super-admin")).rejects.toMatchObject({
      code: "ACTIVE_CODES_REMAIN",
    });
  });
});
