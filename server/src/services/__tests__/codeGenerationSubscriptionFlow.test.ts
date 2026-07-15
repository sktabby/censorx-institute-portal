import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.ORG_CODE_PEPPER = "a-very-long-test-pepper-value-1234567890";
process.env.CLIENT_ORIGINS = "http://localhost:5173";
process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/fake-service-account.json";

type StoredDoc = Record<string, unknown>;
type CollectionStore = Map<string, StoredDoc>;

interface MockDocRef {
  id: string;
  collectionName: string;
  get: () => Promise<MockDocSnap>;
  set: (data: StoredDoc) => Promise<void>;
  update: (data: StoredDoc) => Promise<void>;
  delete: () => Promise<void>;
}

interface MockDocSnap {
  id: string;
  exists: boolean;
  ref: MockDocRef;
  data: () => StoredDoc | undefined;
}

const firestoreMock = vi.hoisted(() => {
  const stores = new Map<string, CollectionStore>();
  const counters = new Map<string, number>();
  const transactionOperationSets: string[][] = [];

  function getStore(collectionName: string) {
    let store = stores.get(collectionName);
    if (!store) {
      store = new Map<string, StoredDoc>();
      stores.set(collectionName, store);
    }
    return store;
  }

  function cloneData(data: StoredDoc) {
    return { ...data };
  }

  function makeDocSnap(ref: MockDocRef): MockDocSnap {
    const data = getStore(ref.collectionName).get(ref.id);
    return {
      id: ref.id,
      exists: !!data,
      ref,
      data: () => (data ? cloneData(data) : undefined),
    };
  }

  function applySet(ref: MockDocRef, data: StoredDoc, merge = false) {
    const store = getStore(ref.collectionName);
    const existing = store.get(ref.id) ?? {};
    store.set(ref.id, merge ? { ...existing, ...cloneData(data) } : cloneData(data));
  }

  function applyUpdate(ref: MockDocRef, data: StoredDoc) {
    const store = getStore(ref.collectionName);
    const existing = store.get(ref.id);
    if (!existing) throw new Error(`Document does not exist: ${ref.collectionName}/${ref.id}`);
    store.set(ref.id, { ...existing, ...cloneData(data) });
  }

  function makeDocRef(collectionName: string, id: string): MockDocRef {
    return {
      id,
      collectionName,
      get: async () => makeDocSnap(makeDocRef(collectionName, id)),
      set: async (data) => applySet(makeDocRef(collectionName, id), data),
      update: async (data) => applyUpdate(makeDocRef(collectionName, id), data),
      delete: async () => {
        getStore(collectionName).delete(id);
      },
    };
  }

  function makeQuery(collectionName: string, filters: Array<[string, unknown]> = [], maxDocs?: number) {
    return {
      where: (field: string, operator: string, value: unknown) => {
        if (operator !== "==") throw new Error(`Unsupported operator: ${operator}`);
        return makeQuery(collectionName, [...filters, [field, value]], maxDocs);
      },
      limit: (limit: number) => makeQuery(collectionName, filters, limit),
      get: async () => {
        const docs = Array.from(getStore(collectionName).entries())
          .filter(([, data]) => filters.every(([field, value]) => data[field] === value))
          .slice(0, maxDocs)
          .map(([id]) => makeDocSnap(makeDocRef(collectionName, id)));

        return {
          docs,
          size: docs.length,
          empty: docs.length === 0,
          forEach: (fn: (doc: MockDocSnap) => void) => docs.forEach(fn),
        };
      },
    };
  }

  function makeCollection(collectionName: string) {
    return {
      doc: (id: string) => makeDocRef(collectionName, id),
      where: (field: string, operator: string, value: unknown) => makeQuery(collectionName).where(field, operator, value),
      limit: (limit: number) => makeQuery(collectionName).limit(limit),
      get: () => makeQuery(collectionName).get(),
    };
  }

  const db = {
    collection: vi.fn(makeCollection),
    runTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const operations: Array<() => void> = [];
      const operationNames: string[] = [];
      const tx = {
        get: (ref: MockDocRef) => ref.get(),
        set: (ref: MockDocRef, data: StoredDoc, options?: { merge?: boolean }) => {
          operationNames.push(`set:${ref.collectionName}/${ref.id}`);
          operations.push(() => applySet(ref, data, options?.merge));
        },
        update: (ref: MockDocRef, data: StoredDoc) => {
          operationNames.push(`update:${ref.collectionName}/${ref.id}`);
          operations.push(() => applyUpdate(ref, data));
        },
        create: (ref: MockDocRef, data: StoredDoc) => {
          operationNames.push(`create:${ref.collectionName}/${ref.id}`);
          operations.push(() => {
            if (getStore(ref.collectionName).has(ref.id)) {
              throw new Error(`Document already exists: ${ref.collectionName}/${ref.id}`);
            }
            applySet(ref, data);
          });
        },
      };
      const result = await fn(tx);
      operations.forEach((operation) => operation());
      transactionOperationSets.push(operationNames);
      return result;
    }),
  };

  return {
    stores,
    transactionOperationSets,
    db,
    collection: vi.fn(makeCollection),
    newDocId: vi.fn((collectionName: string) => {
      const next = (counters.get(collectionName) ?? 0) + 1;
      counters.set(collectionName, next);
      if (collectionName === "organizations") return `org-${next}`;
      if (collectionName === "organizationSubscriptions") return `sub-${next}`;
      if (collectionName === "organizationLicenses") return `lic-${next}`;
      return `${collectionName}-${next}`;
    }),
    serverTimestamp: vi.fn(() => ({ toDate: () => new Date("2026-01-01T00:00:00.000Z"), toMillis: () => 1767225600000 })),
    reset: () => {
      stores.clear();
      counters.clear();
      transactionOperationSets.length = 0;
      db.collection.mockClear();
      db.runTransaction.mockClear();
    },
  };
});

vi.mock("../../repositories/firestoreRepository", () => ({
  db: firestoreMock.db,
  collection: firestoreMock.collection,
  newDocId: firestoreMock.newDocId,
  serverTimestamp: firestoreMock.serverTimestamp,
}));

vi.mock("../../config/firebaseAdmin", () => ({
  adminAuth: {
    createUser: vi.fn(async () => ({ uid: "school-admin-1" })),
    deleteUser: vi.fn(),
  },
}));

vi.mock("../emailService", () => ({
  sendSchoolAdminWelcomeEmail: vi.fn(),
}));

vi.mock("../../repositories/auditLogRepository", () => ({
  writeAuditLog: vi.fn(),
}));

describe("createSubscriptionAndGenerateCodes", () => {
  beforeEach(() => {
    firestoreMock.reset();
  });

  it("creates and links a subscription for a newly-created school before generating codes", async () => {
    const { createOrganization } = await import("../organizationService");
    const { createSubscriptionAndGenerateCodes } = await import("../codeGenerationService");
    const { getActiveSubscription, getOrganization } = await import("../../repositories/organizationRepository");

    const createdSchool = await createOrganization(
      {
        name: "Moonstar Academy",
        contactName: "School Admin",
        contactEmail: "admin@moonstar.test",
        contactPhone: "9999999999",
      },
      "super-admin"
    );

    const initialOrg = await getOrganization(createdSchool.organizationId);
    expect(initialOrg?.currentSubscriptionId).toBeNull();

    const result = await createSubscriptionAndGenerateCodes(
      {
        organizationId: createdSchool.organizationId,
        numberOfCodes: 2,
        planDuration: "THREE_MONTHS",
        codeGenerationMode: "STUDENT_IDS",
        studentIdentifiers: ["01", "02"],
        batchName: "A",
        idempotencyKey: "idem-create-codes",
      },
      "super-admin"
    );

    const orgAfterGeneration = await getOrganization(createdSchool.organizationId);
    expect(orgAfterGeneration?.currentSubscriptionId).toBe(result.subscriptionId);
    expect(orgAfterGeneration?.purchasedSeats).toBe(2);

    const subscription = await getActiveSubscription(createdSchool.organizationId);
    expect(subscription).not.toBeNull();
    expect(subscription).toMatchObject({
      subscriptionId: result.subscriptionId,
      organizationId: createdSchool.organizationId,
      planDuration: "THREE_MONTHS",
      status: "ACTIVE",
      seatLimit: 2,
    });
    expect(subscription?.startAt).toBeTruthy();
    expect(subscription?.expiresAt).toBeTruthy();

    expect(result.codes).toHaveLength(2);

    const subscriptionTransaction = firestoreMock.transactionOperationSets.find(
      (operations) =>
        operations.some((operation) => operation.startsWith("set:organizationSubscriptions/")) &&
        operations.includes(`update:organizations/${createdSchool.organizationId}`)
    );
    expect(subscriptionTransaction).toBeTruthy();
  });
});
