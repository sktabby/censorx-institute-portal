import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.ORG_CODE_PEPPER = "a-very-long-test-pepper-value-1234567890";
process.env.CLIENT_ORIGINS = "http://localhost:5173";
process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/fake-service-account.json";

type StoredDoc = Record<string, unknown>;

const firestoreMock = vi.hoisted(() => {
  const stores = new Map<string, Map<string, StoredDoc>>();

  function getStore(name: string) {
    let store = stores.get(name);
    if (!store) {
      store = new Map<string, StoredDoc>();
      stores.set(name, store);
    }
    return store;
  }

  function makeDocRef(collectionName: string, id: string): any {
    return { id, collectionName, get: async () => makeDocSnap(collectionName, id) };
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

  function makeQuery(collectionName: string, filters: Array<[string, unknown]> = []): any {
    return {
      where: (field: string, _op: string, value: unknown) => makeQuery(collectionName, [...filters, [field, value]]),
      limit: () => makeQuery(collectionName, filters),
      get: async () => {
        const docs = Array.from(getStore(collectionName).entries())
          .filter(([, data]) => filters.every(([field, value]) => data[field] === value))
          .map(([id]) => makeDocSnap(collectionName, id));
        return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn: any) => docs.forEach(fn) };
      },
    };
  }

  const db: any = {
    collection: vi.fn((name: string) => ({
      doc: (id: string) => makeDocRef(name, id),
      where: (f: string, o: string, v: unknown) => makeQuery(name).where(f, o, v),
      get: () => makeQuery(name).get(),
    })),
    batch: vi.fn(() => {
      const ops: Array<() => void> = [];
      return {
        update: (ref: any, data: StoredDoc) =>
          ops.push(() => {
            const store = getStore(ref.collectionName);
            store.set(ref.id, { ...(store.get(ref.id) ?? {}), ...data });
          }),
        set: (ref: any, data: StoredDoc, options?: { merge?: boolean }) =>
          ops.push(() => {
            const store = getStore(ref.collectionName);
            const existing = options?.merge ? store.get(ref.id) ?? {} : {};
            store.set(ref.id, { ...existing, ...data });
          }),
        commit: async () => ops.forEach((op) => op()),
      };
    }),
  };

  return {
    db,
    getStore,
    seed: (name: string, id: string, data: StoredDoc) => getStore(name).set(id, data),
    reset: () => {
      stores.clear();
      db.collection.mockClear();
      db.batch.mockClear();
    },
  };
});

vi.mock("../../repositories/firestoreRepository", () => ({
  db: firestoreMock.db,
  collection: vi.fn((name: string) => firestoreMock.db.collection(name)),
  newDocId: vi.fn(() => "generated-1"),
  serverTimestamp: vi.fn(() => "SERVER_TS"),
}));

vi.mock("../../config/firebaseAdmin", () => ({ adminAuth: {}, db: firestoreMock.db }));

const PAST_MS = new Date("2026-01-01T00:00:00.000Z").getTime();
const past = () => ({ toMillis: () => PAST_MS });

function seedExpiredSchool() {
  firestoreMock.seed("organizations", "org-1", {
    organizationId: "org-1",
    status: "EXPIRED",
    currentSubscriptionId: "sub-old",
    activatedSeats: 0,
    purchasedSeats: 3,
  });
  // A redeemed student, an unredeemed code, and a revoked license — all lapsed.
  firestoreMock.seed("organizationLicenses", "lic-student", {
    licenseId: "lic-student",
    organizationId: "org-1",
    subscriptionId: "sub-old",
    status: "EXPIRED",
    studentUid: "student-1",
    expiresAt: past(),
  });
  firestoreMock.seed("organizationLicenses", "lic-unused", {
    licenseId: "lic-unused",
    organizationId: "org-1",
    subscriptionId: "sub-old",
    status: "EXPIRED",
    studentUid: null,
    expiresAt: past(),
  });
  firestoreMock.seed("organizationLicenses", "lic-revoked", {
    licenseId: "lic-revoked",
    organizationId: "org-1",
    subscriptionId: "sub-old",
    status: "REVOKED",
    studentUid: null,
    expiresAt: past(),
  });
  firestoreMock.seed("organizationActivationCodes", "code-student", {
    codeHash: "code-student",
    licenseId: "lic-student",
    organizationId: "org-1",
    subscriptionId: "sub-old",
    batchName: "batch-a",
    status: "REDEEMED",
  });
  firestoreMock.seed("organizationActivationCodes", "code-unused", {
    codeHash: "code-unused",
    licenseId: "lic-unused",
    organizationId: "org-1",
    subscriptionId: "sub-old",
    batchName: "batch-b",
    status: "EXPIRED",
  });
  firestoreMock.seed("organizationActivationCodes", "code-revoked", {
    codeHash: "code-revoked",
    licenseId: "lic-revoked",
    organizationId: "org-1",
    subscriptionId: "sub-old",
    batchName: "batch-b",
    status: "REVOKED",
  });
  firestoreMock.seed("userOrganizationEntitlements", "student-1", {
    uid: "student-1",
    status: "EXPIRED",
    subscriptionId: "sub-old",
  });
}

describe("restoreCoverage", () => {
  beforeEach(() => {
    firestoreMock.reset();
    seedExpiredSchool();
  });

  it("moves lapsed licenses and codes onto the new window with the same codes", async () => {
    const { restoreCoverage } = await import("../coverageRenewalService");
    const { Timestamp } = await import("firebase-admin/firestore");
    const newExpiry = Timestamp.fromDate(new Date("2027-06-01T00:00:00.000Z"));

    const result = await restoreCoverage({
      organizationId: "org-1",
      targetSubscriptionId: "sub-new",
      expiresAt: newExpiry,
      actorUid: "super-admin",
    });

    expect(result.licensesRestored).toBe(2);
    expect(result.studentsReactivated).toBe(1);
    expect(result.activatedSeats).toBe(1);
    expect(result.entitlementsRestored).toBe(1);

    // The redeemed student is ACTIVE again on the new subscription.
    const studentLicense = firestoreMock.getStore("organizationLicenses").get("lic-student");
    expect(studentLicense?.status).toBe("ACTIVE");
    expect(studentLicense?.subscriptionId).toBe("sub-new");
    expect(studentLicense?.expiresAt).toBe(newExpiry);

    // The unredeemed code is usable again, and is the SAME code document.
    expect(firestoreMock.getStore("organizationLicenses").get("lic-unused")?.status).toBe("UNUSED");
    expect(firestoreMock.getStore("organizationActivationCodes").get("code-unused")?.status).toBe("UNUSED");

    // A redeemed code stays redeemed so it cannot be used a second time.
    expect(firestoreMock.getStore("organizationActivationCodes").get("code-student")?.status).toBe("REDEEMED");

    expect(firestoreMock.getStore("userOrganizationEntitlements").get("student-1")?.status).toBe("ACTIVE");
  });

  it("refuses to un-expire an already-used code even though it displays as EXPIRED", async () => {
    const { restoreCoverage } = await import("../coverageRenewalService");
    const { getEffectiveActivationCodeStatus } = await import("../../repositories/organizationRepository");
    const { Timestamp } = await import("firebase-admin/firestore");

    const lapsedSubscription = { status: "ACTIVE" as const, expiresAt: past() as any };
    const lapsedLicense = { status: "ACTIVE" as const, expiresAt: past() as any };

    // Display projection says EXPIRED...
    expect(
      getEffectiveActivationCodeStatus({ status: "REDEEMED" }, lapsedSubscription, lapsedLicense, new Date())
    ).toBe("EXPIRED");
    // ...but the stored document still says REDEEMED.
    expect(firestoreMock.getStore("organizationActivationCodes").get("code-student")?.status).toBe("REDEEMED");

    await restoreCoverage({
      organizationId: "org-1",
      targetSubscriptionId: "sub-new",
      expiresAt: Timestamp.fromDate(new Date("2027-06-01T00:00:00.000Z")),
      actorUid: "super-admin",
    });

    // Restoring must NOT hand the used code back as redeemable.
    const restoredCode = firestoreMock.getStore("organizationActivationCodes").get("code-student");
    expect(restoredCode?.status).toBe("REDEEMED");
    expect(restoredCode?.status).not.toBe("UNUSED");

    // The unredeemed code in the same school does come back as UNUSED.
    expect(firestoreMock.getStore("organizationActivationCodes").get("code-unused")?.status).toBe("UNUSED");
  });

  it("never resurrects revoked licenses or revoked codes", async () => {
    const { restoreCoverage } = await import("../coverageRenewalService");
    const { Timestamp } = await import("firebase-admin/firestore");

    await restoreCoverage({
      organizationId: "org-1",
      targetSubscriptionId: "sub-new",
      expiresAt: Timestamp.fromDate(new Date("2027-06-01T00:00:00.000Z")),
      actorUid: "super-admin",
    });

    expect(firestoreMock.getStore("organizationLicenses").get("lic-revoked")?.status).toBe("REVOKED");
    expect(firestoreMock.getStore("organizationActivationCodes").get("code-revoked")?.status).toBe("REVOKED");
  });

  it("restores only the selected batches when batchNames is supplied", async () => {
    const { restoreCoverage } = await import("../coverageRenewalService");
    const { Timestamp } = await import("firebase-admin/firestore");

    const result = await restoreCoverage({
      organizationId: "org-1",
      targetSubscriptionId: "sub-new",
      expiresAt: Timestamp.fromDate(new Date("2027-06-01T00:00:00.000Z")),
      batchNames: ["batch-a"],
      actorUid: "super-admin",
    });

    expect(result.licensesRestored).toBe(1);
    expect(result.batchNames).toEqual(["batch-a"]);

    expect(firestoreMock.getStore("organizationLicenses").get("lic-student")?.status).toBe("ACTIVE");
    // batch-b was not selected, so it stays expired.
    expect(firestoreMock.getStore("organizationLicenses").get("lic-unused")?.status).toBe("EXPIRED");
    expect(firestoreMock.getStore("organizationActivationCodes").get("code-unused")?.status).toBe("EXPIRED");
  });
});
