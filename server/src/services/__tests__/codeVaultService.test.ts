import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.ORG_CODE_PEPPER = "a-very-long-test-pepper-value-1234567890";
process.env.CODE_VAULT_KEY = "a-very-long-test-vault-key-value-0987654321";
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
      update: async (data: StoredDoc) => applyWrite({ collectionName, id }, data, true),
      set: async (data: StoredDoc, options?: { merge?: boolean }) => applyWrite({ collectionName, id }, data, options?.merge),
    };
  }

  function makeDocSnap(collectionName: string, id: string): any {
    const data = getStore(collectionName).get(id);
    return { id, exists: !!data, ref: makeDocRef(collectionName, id), data: () => (data ? { ...data } : undefined) };
  }

  function makeQuery(collectionName: string, filters: Array<[string, unknown]> = [], max?: number): any {
    return {
      where: (field: string, _op: string, value: unknown) => makeQuery(collectionName, [...filters, [field, value]], max),
      limit: (n: number) => makeQuery(collectionName, filters, n),
      get: async () => {
        const docs = Array.from(getStore(collectionName).entries())
          .filter(([, data]) => filters.every(([field, value]) => (data[field] ?? null) === value))
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
vi.mock("../emailService", () => ({
  sendActivationCodesEmail: vi.fn(),
  sendBatchCreatedEmail: vi.fn(),
  sendBatchRenewalEmail: vi.fn(),
  sendBillEmail: vi.fn(),
}));

const ts = (iso: string) => ({ toMillis: () => new Date(iso).getTime(), toDate: () => new Date(iso) });
const FUTURE = "2099-01-01T00:00:00.000Z";

function seedSchool() {
  firestoreMock.seed("organizations", "org-1", {
    organizationId: "org-1",
    name: "Moonstar Academy",
    contactEmail: "admin@moonstar.test",
    status: "ACTIVE",
    currentSubscriptionId: "sub-2",
    activatedSeats: 0,
    purchasedSeats: 4,
  });
  firestoreMock.seed("organizationSubscriptions", "sub-2", {
    subscriptionId: "sub-2",
    organizationId: "org-1",
    status: "ACTIVE",
    planDuration: "YEARLY",
    startAt: ts("2026-01-01T00:00:00.000Z"),
    expiresAt: ts(FUTURE),
    createdAt: ts("2026-01-01T00:00:00.000Z"),
    seatLimit: 4,
    batchNumber: 2,
    batchLabel: "Batch 2",
  });
  firestoreMock.seed("organizationBatches", "rec-gamma", {
    batchId: "rec-gamma",
    organizationId: "org-1",
    batchName: "gamma",
    subscriptionId: "sub-2",
    seatCount: 2,
    status: "PENDING",
    startAt: ts("2026-01-01T00:00:00.000Z"),
    expiresAt: ts(FUTURE),
  });
  // A code generated before the vault existed, plus a revoked one that must never be offered.
  for (const [id, status] of [
    ["code-legacy", "UNUSED"],
    ["code-revoked", "REVOKED"],
  ] as const) {
    firestoreMock.seed("organizationActivationCodes", id, {
      codeHash: id,
      codeLast4: "OLD1",
      licenseId: `lic-${id}`,
      organizationId: "org-1",
      subscriptionId: "sub-2",
      batchName: "legacy",
      status,
      createdAt: ts("2026-01-02T00:00:00.000Z"),
    });
    firestoreMock.seed("organizationLicenses", `lic-${id}`, {
      licenseId: `lic-${id}`,
      organizationId: "org-1",
      subscriptionId: "sub-2",
      batchName: "legacy",
      status: status === "REVOKED" ? "REVOKED" : "UNUSED",
      studentUid: null,
      expiresAt: ts(FUTURE),
    });
  }
}

describe("code vault", () => {
  beforeEach(() => {
    firestoreMock.reset();
    seedSchool();
  });

  it("encrypts and decrypts a code with a fresh IV each time", async () => {
    const { encryptCode, decryptCode, isCodeVaultEnabled } = await import("../codeVaultService");
    expect(isCodeVaultEnabled()).toBe(true);

    const first = encryptCode("CX-7K3M-Q9TD-4PWA-R8F2");
    const second = encryptCode("CX-7K3M-Q9TD-4PWA-R8F2");
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.iv).not.toBe(second.iv);
    expect(decryptCode(first)).toBe("CX-7K3M-Q9TD-4PWA-R8F2");
    expect(decryptCode(second)).toBe("CX-7K3M-Q9TD-4PWA-R8F2");
    expect(() => decryptCode({ ...first, authTag: second.authTag })).toThrow();
  });

  it("stores an encrypted copy at generation and exports the full code; legacy codes read as unavailable", async () => {
    const { generateCodesForOrganization } = await import("../codeGenerationService");
    const { collectCodeExportRows, buildCodesWorkbook } = await import("../codeVaultService");

    const generated = await generateCodesForOrganization(
      { organizationId: "org-1", numberOfCodes: 2, batchName: "gamma", idempotencyKey: "idem-vault-1" },
      "super-admin"
    );

    const vault = firestoreMock.getStore("organizationCodeVault");
    expect(vault.size).toBe(2);
    for (const code of generated.codes) {
      const entry = vault.get(code.licenseId);
      expect(entry).toMatchObject({ organizationId: "org-1", subscriptionId: "sub-2", batchName: "gamma", keyVersion: 1 });
      expect(entry?.ciphertext).not.toContain(code.plaintextCode);
    }
    // The redemption-side documents are exactly as before: hash as id, no plaintext anywhere.
    const codes = firestoreMock.getStore("organizationActivationCodes");
    for (const code of generated.codes) {
      const doc = Array.from(codes.values()).find((item) => item.licenseId === code.licenseId);
      expect(doc).toBeTruthy();
      expect(JSON.stringify(doc)).not.toContain(code.plaintextCode);
    }

    const rows = await collectCodeExportRows({ organizationId: "org-1" });
    // 2 new + 1 legacy; the revoked one is left out.
    expect(rows).toHaveLength(3);
    const gammaRows = rows.filter((row) => row.batchName === "gamma");
    expect(gammaRows.map((row) => row.code).sort()).toEqual(generated.codes.map((code) => code.plaintextCode).sort());
    expect(gammaRows.map((row) => row.serial)).toEqual([1, 2]);
    expect(gammaRows.every((row) => row.codeAvailable && row.batchLabel === "Batch 2" && row.expiresAt === "2099-01-01")).toBe(true);
    const legacy = rows.find((row) => row.batchName === "legacy");
    expect(legacy?.codeAvailable).toBe(false);
    expect(legacy?.code).toContain("Not available");

    const onlyGamma = await collectCodeExportRows({ organizationId: "org-1", batchNames: ["gamma"] });
    expect(onlyGamma).toHaveLength(2);

    const workbook = await buildCodesWorkbook({ filters: { organizationId: "org-1" }, schoolName: "Moonstar Academy" });
    expect(workbook.rowCount).toBe(3);
    expect(workbook.unavailableCount).toBe(1);
    expect(workbook.filename).toMatch(/^Moonstar-Academy-activation-codes-\d{4}-\d{2}-\d{2}\.xlsx$/);
    // XLSX files are zip archives.
    expect(workbook.buffer.subarray(0, 2).toString("latin1")).toBe("PK");
  });
});
