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
      update: async (data: StoredDoc) => {
        const store = getStore(collectionName);
        store.set(id, { ...(store.get(id) ?? {}), ...data });
      },
      set: async (data: StoredDoc, options?: { merge?: boolean }) => {
        const store = getStore(collectionName);
        const existing = options?.merge ? store.get(id) ?? {} : {};
        store.set(id, { ...existing, ...data });
      },
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
      where: (field: string, _op: string, value: unknown) => makeQuery(collectionName, [...filters, [field, value]], max),
      limit: (n: number) => makeQuery(collectionName, filters, n),
      get: async () => {
        const docs = Array.from(getStore(collectionName).entries())
          .filter(([, data]) => filters.every(([field, value]) => data[field] === value))
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
        set: (ref: any, data: StoredDoc, options?: { merge?: boolean }) =>
          ops.push(() => applyWrite(ref, data, options?.merge)),
        commit: async () => ops.forEach((op) => op()),
      };
    }),
    runTransaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => {
      const ops: Array<() => void> = [];
      const tx = {
        get: (ref: any) => ref.get(),
        set: (ref: any, data: StoredDoc, options?: { merge?: boolean }) =>
          ops.push(() => applyWrite(ref, data, options?.merge)),
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
vi.mock("../../config/firebaseAdmin", () => ({ adminAuth: {}, db: firestoreMock.db }));
vi.mock("../../repositories/auditLogRepository", () => ({ writeAuditLog: vi.fn() }));

const emailMocks = vi.hoisted(() => ({
  sendBatchRenewalEmail: vi.fn(),
  sendActivationCodesEmail: vi.fn(),
  sendSchoolAdminWelcomeEmail: vi.fn(),
}));
vi.mock("../emailService", () => emailMocks);

const ts = (iso: string) => ({ toMillis: () => new Date(iso).getTime(), toDate: () => new Date(iso) });
const LAPSED = "2026-01-01T00:00:00.000Z";

function seedLapsedSchool() {
  firestoreMock.seed("organizations", "org-1", {
    organizationId: "org-1",
    name: "Moonstar Academy",
    contactEmail: "admin@moonstar.test",
    status: "EXPIRED",
    currentSubscriptionId: "sub-old",
    activatedSeats: 1,
    purchasedSeats: 2,
  });
  firestoreMock.seed("organizationSubscriptions", "sub-old", {
    subscriptionId: "sub-old",
    organizationId: "org-1",
    status: "ACTIVE",
    planDuration: "YEARLY",
    expiresAt: ts(LAPSED),
    seatLimit: 2,
  });

  // Sheet "alpha": one redeemed student. Sheet "beta": one unused code.
  for (const [batch, codeId, licenseId, codeStatus, licenseStatus, studentUid] of [
    ["alpha", "code-a", "lic-a", "REDEEMED", "ACTIVE", "student-1"],
    ["beta", "code-b", "lic-b", "UNUSED", "UNUSED", null],
  ] as const) {
    firestoreMock.seed("organizationActivationCodes", codeId, {
      codeHash: codeId,
      codeLast4: "1234",
      licenseId,
      organizationId: "org-1",
      subscriptionId: "sub-old",
      batchName: batch,
      status: codeStatus,
      createdAt: ts("2025-06-01T00:00:00.000Z"),
    });
    firestoreMock.seed("organizationLicenses", licenseId, {
      licenseId,
      organizationId: "org-1",
      subscriptionId: "sub-old",
      batchName: batch,
      status: licenseStatus,
      studentUid,
      expiresAt: ts(LAPSED),
    });
  }

  firestoreMock.seed("userOrganizationEntitlements", "student-1", {
    uid: "student-1",
    status: "EXPIRED",
    subscriptionId: "sub-old",
  });
}

const futureWindow = {
  planDuration: "YEARLY" as const,
  startAt: "2026-07-01T00:00:00.000Z",
  expiresAt: "2027-07-01T00:00:00.000Z",
};

describe("renewBatches", () => {
  beforeEach(() => {
    firestoreMock.reset();
    emailMocks.sendBatchRenewalEmail.mockClear();
    emailMocks.sendActivationCodesEmail.mockClear();
    seedLapsedSchool();
  });

  it("renews only the selected sheet in place, reusing the same codes", async () => {
    const { renewBatches } = await import("../organizationService");

    const result = await renewBatches(
      "org-1",
      { batchNames: ["alpha"], ...futureWindow, idempotencyKey: "idem-renew-alpha" },
      "super-admin"
    );

    expect(result.renewedBatches).toEqual(["alpha"]);
    expect(result.licensesRestored).toBe(1);
    expect(result.studentsReactivated).toBe(1);
    expect(result.allocatedBatch).toBeNull();

    // Same license document, now ACTIVE on the new subscription.
    const restored = firestoreMock.getStore("organizationLicenses").get("lic-a");
    expect(restored?.status).toBe("ACTIVE");
    expect(restored?.subscriptionId).toBe(result.subscriptionId);
    expect(firestoreMock.getStore("userOrganizationEntitlements").get("student-1")?.status).toBe("ACTIVE");

    // The unselected sheet is untouched.
    const untouched = firestoreMock.getStore("organizationLicenses").get("lic-b");
    expect(untouched?.subscriptionId).toBe("sub-old");

    // No new codes were generated for a pure renewal.
    expect(firestoreMock.getStore("organizationActivationCodes").size).toBe(2);
    expect(emailMocks.sendBatchRenewalEmail).toHaveBeenCalledTimes(1);
    expect(emailMocks.sendActivationCodesEmail).not.toHaveBeenCalled();
  });

  it("renews existing sheets and allocates seats for a new batch, generating no codes", async () => {
    const { renewBatches } = await import("../organizationService");

    const result = await renewBatches(
      "org-1",
      {
        batchNames: ["alpha", "beta"],
        newBatch: { batchName: "gamma", seatCount: 3 },
        ...futureWindow,
        idempotencyKey: "idem-renew-combo",
      },
      "super-admin"
    );

    expect(result.renewedBatches).toEqual(["alpha", "beta"]);
    expect(result.licensesRestored).toBe(2);
    expect(result.allocatedBatch?.batchName).toBe("gamma");
    expect(result.allocatedBatch?.seatCount).toBe(3);
    // 2 renewed seats + 3 allocated.
    expect(result.seatLimit).toBe(5);

    // Seats were reserved, but NOT a single code was generated.
    expect(firestoreMock.getStore("organizationActivationCodes").size).toBe(2);
    const allocation = Array.from(firestoreMock.getStore("organizationBatches").values())[0];
    expect(allocation).toMatchObject({ batchName: "gamma", seatCount: 3, status: "PENDING", generatedAt: null });
    expect(allocation?.subscriptionId).toBe(result.subscriptionId);

    // Renewal notice only — Renew School never mails codes.
    expect(emailMocks.sendBatchRenewalEmail).toHaveBeenCalledTimes(1);
    expect(emailMocks.sendActivationCodesEmail).not.toHaveBeenCalled();
  });

  it("allocates seats without renewing anything", async () => {
    const { renewBatches } = await import("../organizationService");

    const result = await renewBatches(
      "org-1",
      {
        batchNames: [],
        newBatch: { batchName: "solo", seatCount: 2 },
        ...futureWindow,
        idempotencyKey: "idem-new-only",
      },
      "super-admin"
    );

    expect(result.renewedBatches).toEqual([]);
    expect(result.licensesRestored).toBe(0);
    expect(result.allocatedBatch?.seatCount).toBe(2);
    // Neither email fires: nothing was renewed and nothing was generated.
    expect(emailMocks.sendBatchRenewalEmail).not.toHaveBeenCalled();
    expect(emailMocks.sendActivationCodesEmail).not.toHaveBeenCalled();
    // Still only the two seeded codes.
    expect(firestoreMock.getStore("organizationActivationCodes").size).toBe(2);

    // The lapsed sheets stay lapsed.
    expect(firestoreMock.getStore("organizationLicenses").get("lic-a")?.subscriptionId).toBe("sub-old");
  });

  it("hands the pending allocation to Create Codes, which generates and closes it out", async () => {
    const { renewBatches } = await import("../organizationService");
    const { generateCodesForOrganization } = await import("../codeGenerationService");
    const { listOrganizationBatches } = await import("../batchService");

    const renewal = await renewBatches(
      "org-1",
      {
        batchNames: [],
        newBatch: { batchName: "gamma", seatCount: 3 },
        ...futureWindow,
        idempotencyKey: "idem-handoff",
      },
      "super-admin"
    );

    // Renew School left it pending, with the window it allocated.
    const pending = (await listOrganizationBatches("org-1")).find((b) => b.batchName === "gamma");
    expect(pending).toMatchObject({ status: "PENDING", isPending: true, seatCount: 3, pendingSeats: 3, codeCount: 0 });
    expect(pending?.expiresAt).toBe(futureWindow.expiresAt);
    expect(pending?.startAt).toBe(futureWindow.startAt);

    // Create Codes fulfils it.
    const generated = await generateCodesForOrganization(
      {
        organizationId: "org-1",
        subscriptionId: renewal.subscriptionId,
        numberOfCodes: 3,
        batchName: "gamma",
        idempotencyKey: "idem-handoff-generate",
      },
      "super-admin"
    );

    expect(generated.codes).toHaveLength(3);
    expect(emailMocks.sendActivationCodesEmail).toHaveBeenCalledTimes(1);

    // The allocation is fulfilled and no longer offered as pending.
    const after = (await listOrganizationBatches("org-1")).find((b) => b.batchName === "gamma");
    expect(after?.isPending).toBe(false);
    expect(after?.status).not.toBe("PENDING");
    expect(after?.codeCount).toBe(3);
    expect(after?.pendingSeats).toBe(0);
  });

  it("refuses to generate more codes than the batch reserved", async () => {
    const { renewBatches } = await import("../organizationService");
    const { generateCodesForOrganization } = await import("../codeGenerationService");

    const renewal = await renewBatches(
      "org-1",
      {
        batchNames: [],
        newBatch: { batchName: "gamma", seatCount: 2 },
        ...futureWindow,
        idempotencyKey: "idem-overflow",
      },
      "super-admin"
    );

    await expect(
      generateCodesForOrganization(
        {
          organizationId: "org-1",
          subscriptionId: renewal.subscriptionId,
          numberOfCodes: 5,
          batchName: "gamma",
          idempotencyKey: "idem-overflow-generate",
        },
        "super-admin"
      )
    ).rejects.toMatchObject({ code: "BATCH_ALLOCATION_EXCEEDED" });
  });

  it("requires a name for the new batch", async () => {
    const { renewBatches } = await import("../organizationService");

    await expect(
      renewBatches(
        "org-1",
        {
          batchNames: [],
          newBatch: { batchName: "   ", seatCount: 2 },
          ...futureWindow,
          idempotencyKey: "idem-no-name",
        },
        "super-admin"
      )
    ).rejects.toMatchObject({ code: "BATCH_NAME_REQUIRED" });
  });

  it("moves a still-pending allocation onto the newer window when renewed again", async () => {
    const { renewBatches } = await import("../organizationService");

    const first = await renewBatches(
      "org-1",
      { batchNames: [], newBatch: { batchName: "pending-1", seatCount: 4 }, ...futureWindow, idempotencyKey: "idem-p1" },
      "super-admin"
    );

    const second = await renewBatches(
      "org-1",
      {
        batchNames: [],
        newBatch: { batchName: "pending-2", seatCount: 1 },
        planDuration: "YEARLY",
        startAt: "2027-07-01T00:00:00.000Z",
        expiresAt: "2028-07-01T00:00:00.000Z",
        idempotencyKey: "idem-p2",
      },
      "super-admin"
    );

    // The first allocation follows the newer subscription rather than being
    // stranded on a window that would generate already-expired codes.
    const stillPending = Array.from(firestoreMock.getStore("organizationBatches").values()).find(
      (batch) => batch.batchName === "pending-1"
    );
    expect(stillPending?.subscriptionId).not.toBe(first.subscriptionId);
    expect(stillPending?.subscriptionId).toBe(second.subscriptionId);
    expect(stillPending?.status).toBe("PENDING");

    // The move is reported, not silent.
    expect(second.repointedBatches).toEqual(["pending-1"]);
    expect(stillPending?.windowUpdatedAt).toBeTruthy();

    // The batch allocated by this same renewal did not move, so it is not
    // reported and carries no "dates changed" marker.
    expect(first.repointedBatches).toEqual([]);
    const freshlyAllocated = Array.from(firestoreMock.getStore("organizationBatches").values()).find(
      (batch) => batch.batchName === "pending-2"
    );
    expect(freshlyAllocated?.windowUpdatedAt).toBeNull();
  });

  it("rejects an empty renewal and an unknown batch", async () => {
    const { renewBatches } = await import("../organizationService");

    await expect(
      renewBatches("org-1", { batchNames: [], ...futureWindow, idempotencyKey: "idem-empty" }, "super-admin")
    ).rejects.toMatchObject({ code: "NOTHING_TO_RENEW" });

    await expect(
      renewBatches("org-1", { batchNames: ["ghost"], ...futureWindow, idempotencyKey: "idem-ghost" }, "super-admin")
    ).rejects.toMatchObject({ code: "BATCH_NOT_FOUND" });
  });

  it("refuses to reuse an existing sheet name for the new batch", async () => {
    const { renewBatches } = await import("../organizationService");

    await expect(
      renewBatches(
        "org-1",
        {
          batchNames: [],
          newBatch: { batchName: "alpha", seatCount: 1 },
          ...futureWindow,
          idempotencyKey: "idem-dupe",
        },
        "super-admin"
      )
    ).rejects.toMatchObject({ code: "BATCH_NAME_TAKEN" });
  });

  it("allocates several new classes in one renewal and counts all of their seats", async () => {
    const { renewBatches } = await import("../organizationService");

    const result = await renewBatches(
      "org-1",
      {
        batchNames: ["alpha", "beta"],
        newBatches: [
          { batchName: "gamma", seatCount: 3 },
          { batchName: "delta", seatCount: 4 },
        ],
        ...futureWindow,
        idempotencyKey: "idem-many",
      },
      "super-admin"
    );

    expect(result.allocatedBatches.map((item) => item.batchName)).toEqual(["gamma", "delta"]);
    expect(result.allocatedBatch?.batchName).toBe("gamma");
    // 2 renewed seats + 3 + 4 allocated, all on a single new plan.
    expect(result.seatLimit).toBe(9);

    const allocations = Array.from(firestoreMock.getStore("organizationBatches").values());
    expect(allocations).toHaveLength(2);
    expect(allocations.every((item) => item.status === "PENDING")).toBe(true);
    expect(allocations.every((item) => item.subscriptionId === result.subscriptionId)).toBe(true);

    // Seats were reserved, but no codes were generated.
    expect(firestoreMock.getStore("organizationActivationCodes").size).toBe(2);
    expect(emailMocks.sendActivationCodesEmail).not.toHaveBeenCalled();
  });

  it("keeps the seats of a class that is still waiting for codes when another class is added", async () => {
    const { renewBatches } = await import("../organizationService");

    const first = await renewBatches(
      "org-1",
      {
        batchNames: ["alpha", "beta"],
        newBatch: { batchName: "gamma", seatCount: 3 },
        ...futureWindow,
        idempotencyKey: "idem-wait-1",
      },
      "super-admin"
    );

    const second = await renewBatches(
      "org-1",
      {
        batchNames: [],
        newBatches: [{ batchName: "delta", seatCount: 2 }],
        planDuration: "YEARLY",
        startAt: "2027-07-01T00:00:00.000Z",
        expiresAt: "2028-07-01T00:00:00.000Z",
        idempotencyKey: "idem-wait-2",
      },
      "super-admin"
    );

    // The waiting class (3 seats) still counts: previous limit + the 2 new seats.
    expect(second.seatLimit).toBe(first.seatLimit + 2);
  });

  it("refuses two new classes with the same name", async () => {
    const { renewBatches } = await import("../organizationService");

    await expect(
      renewBatches(
        "org-1",
        {
          batchNames: [],
          newBatches: [
            { batchName: "Class 5A", seatCount: 2 },
            { batchName: "class 5a", seatCount: 3 },
          ],
          ...futureWindow,
          idempotencyKey: "idem-dup-new",
        },
        "super-admin"
      )
    ).rejects.toMatchObject({ code: "BATCH_NAME_TAKEN" });
  });
});
