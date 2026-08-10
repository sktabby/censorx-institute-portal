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

  function makeDocSnap(collectionName: string, id: string): any {
    const data = getStore(collectionName).get(id);
    return {
      id,
      exists: !!data,
      ref: { id, collectionName },
      data: () => (data ? { ...data } : undefined),
    };
  }

  function makeQuery(collectionName: string, filters: Array<[string, unknown]> = []): any {
    return {
      where: (field: string, _op: string, value: unknown) => makeQuery(collectionName, [...filters, [field, value]]),
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
      doc: (id: string) => ({ id, collectionName: name, get: async () => makeDocSnap(name, id) }),
      where: (f: string, o: string, v: unknown) => makeQuery(name).where(f, o, v),
      get: () => makeQuery(name).get(),
    })),
  };

  return {
    db,
    seed: (name: string, id: string, data: StoredDoc) => getStore(name).set(id, data),
    reset: () => {
      stores.clear();
      db.collection.mockClear();
    },
  };
});

vi.mock("../../repositories/firestoreRepository", () => ({
  db: firestoreMock.db,
  collection: vi.fn((name: string) => firestoreMock.db.collection(name)),
  newDocId: vi.fn(() => "x"),
  serverTimestamp: vi.fn(() => "SERVER_TS"),
}));
vi.mock("../../config/firebaseAdmin", () => ({ adminAuth: {}, db: firestoreMock.db }));

const ts = (iso: string) => ({
  toMillis: () => new Date(iso).getTime(),
  toDate: () => new Date(iso),
});

function seedCode(id: string, batchName: string, subscriptionId: string, status: string, createdAt: string) {
  firestoreMock.seed("organizationActivationCodes", id, {
    codeHash: id,
    licenseId: `lic-${id}`,
    organizationId: "org-1",
    subscriptionId,
    batchName,
    status,
    createdAt: ts(createdAt),
  });
  firestoreMock.seed("organizationLicenses", `lic-${id}`, {
    licenseId: `lic-${id}`,
    organizationId: "org-1",
    subscriptionId,
    batchName,
    status: status === "REDEEMED" ? "ACTIVE" : status,
    expiresAt: subscriptionId === "sub-expired" ? ts("2026-01-01T00:00:00.000Z") : ts("2099-01-01T00:00:00.000Z"),
  });
}

describe("listOrganizationBatches", () => {
  beforeEach(() => {
    firestoreMock.reset();
    firestoreMock.seed("organizationSubscriptions", "sub-expired", {
      subscriptionId: "sub-expired",
      organizationId: "org-1",
      status: "ACTIVE",
      expiresAt: ts("2026-01-01T00:00:00.000Z"),
      seatLimit: 10,
    });
    firestoreMock.seed("organizationSubscriptions", "sub-live", {
      subscriptionId: "sub-live",
      organizationId: "org-1",
      status: "ACTIVE",
      expiresAt: ts("2099-01-01T00:00:00.000Z"),
      seatLimit: 10,
    });
  });

  it("groups codes by batch and reports counts, status and dates", async () => {
    const { listOrganizationBatches } = await import("../batchService");

    seedCode("c1", "spring", "sub-expired", "UNUSED", "2025-09-01T00:00:00.000Z");
    seedCode("c2", "spring", "sub-expired", "REDEEMED", "2025-09-01T00:00:00.000Z");
    seedCode("c3", "autumn", "sub-live", "UNUSED", "2026-02-01T00:00:00.000Z");

    const batches = await listOrganizationBatches("org-1");

    expect(batches).toHaveLength(2);
    // Newest batch first.
    expect(batches[0].batchName).toBe("autumn");
    expect(batches[0].status).toBe("ACTIVE");
    expect(batches[0].unusedCount).toBe(1);

    const spring = batches[1];
    expect(spring.batchName).toBe("spring");
    expect(spring.codeCount).toBe(2);
    // Both codes sit on a lapsed subscription, so both project as EXPIRED —
    // including the redeemed one, which no longer reads as REDEEMED once its
    // coverage has run out.
    expect(spring.expiredCount).toBe(2);
    expect(spring.redeemedCount).toBe(0);
    expect(spring.status).toBe("EXPIRED");
    // Still renewable: EXPIRED is a recoverable state, unlike REVOKED/DELETED.
    expect(spring.renewableCount).toBe(2);
    expect(spring.createdAt).toBe("2025-09-01T00:00:00.000Z");
  });

  it("marks a batch RETIRED when every code is revoked or deleted", async () => {
    const { listOrganizationBatches } = await import("../batchService");

    seedCode("c1", "dead", "sub-live", "REVOKED", "2026-01-01T00:00:00.000Z");
    seedCode("c2", "dead", "sub-live", "DELETED", "2026-01-01T00:00:00.000Z");

    const [batch] = await listOrganizationBatches("org-1");

    expect(batch.status).toBe("RETIRED");
    expect(batch.renewableCount).toBe(0);
    expect(batch.revokedCount).toBe(1);
    expect(batch.deletedCount).toBe(1);
  });

  it("reports a fully lapsed unredeemed batch as EXPIRED", async () => {
    const { listOrganizationBatches } = await import("../batchService");

    seedCode("c1", "old", "sub-expired", "UNUSED", "2025-01-01T00:00:00.000Z");
    seedCode("c2", "old", "sub-expired", "UNUSED", "2025-01-01T00:00:00.000Z");

    const [batch] = await listOrganizationBatches("org-1");

    expect(batch.status).toBe("EXPIRED");
    expect(batch.expiredCount).toBe(2);
    expect(batch.renewableCount).toBe(2);
  });

  it("returns an empty list for a school with no codes", async () => {
    const { listOrganizationBatches } = await import("../batchService");
    expect(await listOrganizationBatches("org-1")).toEqual([]);
  });
});

describe("listSubscriptionHistory", () => {
  beforeEach(() => {
    firestoreMock.reset();
    firestoreMock.seed("organizations", "org-1", {
      organizationId: "org-1",
      currentSubscriptionId: "sub-3",
    });
  });

  function seedSubscription(id: string, renewedFrom: string | null, createdAt: string, expiresAt: string) {
    firestoreMock.seed("organizationSubscriptions", id, {
      subscriptionId: id,
      organizationId: "org-1",
      planDuration: "YEARLY",
      seatLimit: 10,
      status: "ACTIVE",
      startAt: ts(createdAt),
      expiresAt: ts(expiresAt),
      createdAt: ts(createdAt),
      renewedFromSubscriptionId: renewedFrom,
    });
  }

  it("orders the history by walking the renewal chain and flags the current record", async () => {
    const { listSubscriptionHistory } = await import("../batchService");

    // Seeded out of order on purpose — the chain, not insertion order, decides.
    seedSubscription("sub-3", "sub-2", "2027-01-01T00:00:00.000Z", "2099-01-01T00:00:00.000Z");
    seedSubscription("sub-1", null, "2025-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    seedSubscription("sub-2", "sub-1", "2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z");

    const history = await listSubscriptionHistory("org-1");

    expect(history.map((row) => row.subscriptionId)).toEqual(["sub-1", "sub-2", "sub-3"]);
    expect(history.map((row) => row.sequence)).toEqual([1, 2, 3]);
    expect(history[0].renewedFromSubscriptionId).toBeNull();
    expect(history[2].isCurrent).toBe(true);
    expect(history[0].isCurrent).toBe(false);

    // Lapsed periods project as EXPIRED while retaining their stored value.
    expect(history[0].status).toBe("EXPIRED");
    expect(history[0].storedStatus).toBe("ACTIVE");
    expect(history[2].status).toBe("ACTIVE");
  });

  it("still returns records whose parent link is broken", async () => {
    const { listSubscriptionHistory } = await import("../batchService");

    seedSubscription("sub-1", null, "2025-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    // Points at a subscription that no longer exists.
    seedSubscription("sub-orphan", "sub-missing", "2026-06-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z");

    const history = await listSubscriptionHistory("org-1");

    expect(history).toHaveLength(2);
    expect(history.map((row) => row.subscriptionId)).toEqual(["sub-1", "sub-orphan"]);
  });

  it("counts licences attached to each subscription", async () => {
    const { listSubscriptionHistory } = await import("../batchService");

    seedSubscription("sub-1", null, "2025-01-01T00:00:00.000Z", "2099-01-01T00:00:00.000Z");
    firestoreMock.seed("organizationLicenses", "lic-1", {
      licenseId: "lic-1",
      organizationId: "org-1",
      subscriptionId: "sub-1",
      status: "ACTIVE",
      expiresAt: ts("2099-01-01T00:00:00.000Z"),
    });
    firestoreMock.seed("organizationLicenses", "lic-2", {
      licenseId: "lic-2",
      organizationId: "org-1",
      subscriptionId: "sub-1",
      status: "UNUSED",
      expiresAt: ts("2099-01-01T00:00:00.000Z"),
    });

    const [row] = await listSubscriptionHistory("org-1");

    expect(row.licenseCount).toBe(2);
    expect(row.activeLicenseCount).toBe(1);
  });

  it("returns an empty history for a school with no subscriptions", async () => {
    const { listSubscriptionHistory } = await import("../batchService");
    expect(await listSubscriptionHistory("org-1")).toEqual([]);
  });
});
