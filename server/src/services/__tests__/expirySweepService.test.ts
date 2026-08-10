import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.ORG_CODE_PEPPER = "a-very-long-test-pepper-value-1234567890";
process.env.CLIENT_ORIGINS = "http://localhost:5173";
process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/fake-service-account.json";

type StoredDoc = Record<string, unknown>;

const firestoreMock = vi.hoisted(() => {
  const stores = new Map<string, Map<string, StoredDoc>>();

  function getStore(collectionName: string) {
    let store = stores.get(collectionName);
    if (!store) {
      store = new Map<string, StoredDoc>();
      stores.set(collectionName, store);
    }
    return store;
  }

  function makeDocRef(collectionName: string, id: string): any {
    return {
      id,
      collectionName,
      get: async () => makeDocSnap(collectionName, id),
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

  function makeQuery(collectionName: string, filters: Array<[string, unknown]> = []): any {
    return {
      where: (field: string, _op: string, value: unknown) =>
        makeQuery(collectionName, [...filters, [field, value]]),
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
        update: (ref: any, data: StoredDoc) => {
          ops.push(() => {
            const store = getStore(ref.collectionName);
            store.set(ref.id, { ...(store.get(ref.id) ?? {}), ...data });
          });
        },
        set: (ref: any, data: StoredDoc, options?: { merge?: boolean }) => {
          ops.push(() => {
            const store = getStore(ref.collectionName);
            const existing = options?.merge ? store.get(ref.id) ?? {} : {};
            store.set(ref.id, { ...existing, ...data });
          });
        },
        commit: async () => ops.forEach((op) => op()),
      };
    }),
  };

  return {
    stores,
    db,
    getStore,
    seed: (collectionName: string, id: string, data: StoredDoc) => getStore(collectionName).set(id, data),
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
  newDocId: vi.fn(() => "audit-1"),
  serverTimestamp: vi.fn(() => "SERVER_TS"),
}));

vi.mock("../../config/firebaseAdmin", () => ({ adminAuth: {}, db: firestoreMock.db }));
vi.mock("../../repositories/auditLogRepository", () => ({ writeAuditLog: vi.fn() }));

const NOW = new Date("2026-06-01T00:00:00.000Z");
const PAST = { toMillis: () => new Date("2026-01-01T00:00:00.000Z").getTime() };
const FUTURE = { toMillis: () => new Date("2027-01-01T00:00:00.000Z").getTime() };

describe("runExpirySweep", () => {
  beforeEach(() => {
    firestoreMock.reset();
  });

  it("writes EXPIRED onto past-due subscriptions, licenses and codes, and releases seats", async () => {
    const { runExpirySweep } = await import("../expirySweepService");

    firestoreMock.seed("organizations", "org-1", {
      organizationId: "org-1",
      status: "ACTIVE",
      currentSubscriptionId: "sub-1",
      activatedSeats: 2,
      purchasedSeats: 5,
    });
    firestoreMock.seed("organizationSubscriptions", "sub-1", {
      subscriptionId: "sub-1",
      organizationId: "org-1",
      status: "ACTIVE",
      expiresAt: PAST,
      seatLimit: 5,
    });
    firestoreMock.seed("organizationLicenses", "lic-1", {
      licenseId: "lic-1",
      organizationId: "org-1",
      subscriptionId: "sub-1",
      status: "ACTIVE",
      studentUid: "student-1",
      expiresAt: PAST,
    });
    firestoreMock.seed("organizationLicenses", "lic-2", {
      licenseId: "lic-2",
      organizationId: "org-1",
      subscriptionId: "sub-1",
      status: "UNUSED",
      studentUid: null,
      expiresAt: PAST,
    });
    firestoreMock.seed("organizationActivationCodes", "code-1", {
      codeHash: "code-1",
      licenseId: "lic-2",
      organizationId: "org-1",
      subscriptionId: "sub-1",
      status: "UNUSED",
    });
    // The sweep now only expires an entitlement that actually exists and points
    // at the licence going away, so the fixture must carry a real one.
    firestoreMock.seed("userOrganizationEntitlements", "student-1", {
      uid: "student-1",
      organizationId: "org-1",
      licenseId: "lic-1",
      subscriptionId: "sub-1",
      status: "ACTIVE",
    });

    const result = await runExpirySweep({ now: NOW });

    expect(result.subscriptionsExpired).toBe(1);
    expect(result.licensesExpired).toBe(2);
    expect(result.codesExpired).toBe(1);
    expect(result.entitlementsExpired).toBe(1);
    expect(result.organizationsExpired).toBe(1);
    expect(result.seatsReleased).toBe(1);

    expect(firestoreMock.getStore("organizationSubscriptions").get("sub-1")?.status).toBe("EXPIRED");
    expect(firestoreMock.getStore("organizationLicenses").get("lic-1")?.status).toBe("EXPIRED");
    expect(firestoreMock.getStore("organizationLicenses").get("lic-2")?.status).toBe("EXPIRED");
    expect(firestoreMock.getStore("organizationActivationCodes").get("code-1")?.status).toBe("EXPIRED");
    expect(firestoreMock.getStore("userOrganizationEntitlements").get("student-1")?.status).toBe("EXPIRED");

    const org = firestoreMock.getStore("organizations").get("org-1");
    // The one ACTIVE license that expired gave its seat back.
    expect(org?.activatedSeats).toBe(1);
    expect(org?.status).toBe("EXPIRED");
  });

  it("leaves subscriptions and licenses that are still in their window untouched", async () => {
    const { runExpirySweep } = await import("../expirySweepService");

    firestoreMock.seed("organizations", "org-1", {
      organizationId: "org-1",
      status: "ACTIVE",
      currentSubscriptionId: "sub-1",
      activatedSeats: 1,
      purchasedSeats: 5,
    });
    firestoreMock.seed("organizationSubscriptions", "sub-1", {
      subscriptionId: "sub-1",
      status: "ACTIVE",
      expiresAt: FUTURE,
      seatLimit: 5,
    });
    firestoreMock.seed("organizationLicenses", "lic-1", {
      licenseId: "lic-1",
      organizationId: "org-1",
      subscriptionId: "sub-1",
      status: "ACTIVE",
      studentUid: "student-1",
      expiresAt: FUTURE,
    });

    const result = await runExpirySweep({ now: NOW });

    expect(result.writes).toBe(0);
    expect(firestoreMock.getStore("organizationSubscriptions").get("sub-1")?.status).toBe("ACTIVE");
    expect(firestoreMock.getStore("organizationLicenses").get("lic-1")?.status).toBe("ACTIVE");
    expect(firestoreMock.getStore("organizations").get("org-1")?.activatedSeats).toBe(1);
  });

  it("does not touch REVOKED or DELETED records, and is idempotent on a second run", async () => {
    const { runExpirySweep } = await import("../expirySweepService");

    firestoreMock.seed("organizations", "org-1", {
      organizationId: "org-1",
      status: "ACTIVE",
      currentSubscriptionId: "sub-1",
      activatedSeats: 1,
      purchasedSeats: 5,
    });
    firestoreMock.seed("organizationSubscriptions", "sub-1", {
      subscriptionId: "sub-1",
      status: "ACTIVE",
      expiresAt: PAST,
      seatLimit: 5,
    });
    firestoreMock.seed("organizationLicenses", "lic-revoked", {
      licenseId: "lic-revoked",
      organizationId: "org-1",
      subscriptionId: "sub-1",
      status: "REVOKED",
      studentUid: null,
      expiresAt: PAST,
    });
    firestoreMock.seed("organizationLicenses", "lic-deleted", {
      licenseId: "lic-deleted",
      organizationId: "org-1",
      subscriptionId: "sub-1",
      status: "DELETED",
      studentUid: null,
      expiresAt: PAST,
    });
    firestoreMock.seed("organizationLicenses", "lic-active", {
      licenseId: "lic-active",
      organizationId: "org-1",
      subscriptionId: "sub-1",
      status: "ACTIVE",
      studentUid: null,
      expiresAt: PAST,
    });

    const first = await runExpirySweep({ now: NOW });
    expect(first.licensesExpired).toBe(1);
    expect(firestoreMock.getStore("organizationLicenses").get("lic-revoked")?.status).toBe("REVOKED");
    expect(firestoreMock.getStore("organizationLicenses").get("lic-deleted")?.status).toBe("DELETED");
    expect(firestoreMock.getStore("organizations").get("org-1")?.activatedSeats).toBe(0);

    const second = await runExpirySweep({ now: NOW });
    expect(second.writes).toBe(0);
    expect(second.licensesExpired).toBe(0);
    expect(second.seatsReleased).toBe(0);
    // Seats are not double-decremented by a repeat run.
    expect(firestoreMock.getStore("organizations").get("org-1")?.activatedSeats).toBe(0);
  });
});
