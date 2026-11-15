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
          .filter(([, data]) => filters.every(([field, value]) => (data[field] ?? null) === value))
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
        delete: (ref: any) => ops.push(() => getStore(ref.collectionName).delete(ref.id)),
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
  sendBatchCreatedEmail: vi.fn(),
  sendBatchEndingSoonEmail: vi.fn(),
  sendBatchEndedEmail: vi.fn(),
  sendRenewalOfferEmail: vi.fn(),
  sendActivationCodesEmail: vi.fn(),
  sendSchoolAdminWelcomeEmail: vi.fn(),
  sendBillEmail: vi.fn(),
  sendPaymentReminderEmail: vi.fn(),
  sendBatchAccessEmail: vi.fn(),
}));
vi.mock("../emailService", () => emailMocks);

const ts = (iso: string) => ({ toMillis: () => new Date(iso).getTime(), toDate: () => new Date(iso) });
const LAPSED = "2026-01-01T00:00:00.000Z";

/** Batch 1 has ended: class alpha (one redeemed student) and class beta (one unused code). */
function seedSchoolWithEndedBatch() {
  firestoreMock.seed("organizations", "org-1", {
    organizationId: "org-1",
    name: "Moonstar Academy",
    contactName: "Head",
    contactEmail: "admin@moonstar.test",
    contactPhone: "9999999999",
    status: "EXPIRED",
    currentSubscriptionId: "sub-old",
    activatedSeats: 0,
    purchasedSeats: 0,
  });
  firestoreMock.seed("organizationSubscriptions", "sub-old", {
    subscriptionId: "sub-old",
    organizationId: "org-1",
    status: "ACTIVE",
    planDuration: "YEARLY",
    startAt: ts("2025-01-01T00:00:00.000Z"),
    expiresAt: ts(LAPSED),
    createdAt: ts("2025-01-01T00:00:00.000Z"),
    seatLimit: 2,
    batchNumber: 1,
    batchLabel: "Batch 1",
    renewedFromSubscriptionId: null,
  });

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
    organizationId: "org-1",
    licenseId: "lic-a",
    status: "EXPIRED",
    subscriptionId: "sub-old",
  });
}

const window2027 = {
  planDuration: "YEARLY" as const,
  startAt: "2026-07-01T00:00:00.000Z",
  expiresAt: "2027-07-01T00:00:00.000Z",
};

const payment = { totalAmount: 12000, paidAmount: 5000, installments: 2, method: "UPI" as const, methodDetails: { transactionId: "TXN1" } };

describe("createBatch", () => {
  beforeEach(() => {
    firestoreMock.reset();
    Object.values(emailMocks).forEach((mock) => mock.mockClear());
    seedSchoolWithEndedBatch();
  });

  it("adds an independent batch with its classes, leaving the ended batch untouched", async () => {
    const { createBatch } = await import("../batchSubscriptionService");

    const result = await createBatch(
      "org-1",
      { ...window2027, classes: [{ batchName: "gamma", seatCount: 3 }, { batchName: "delta", seatCount: 2 }], idempotencyKey: "idem-create-1" },
      "super-admin"
    );

    expect(result.batchNumber).toBe(2);
    expect(result.batchLabel).toBe("Batch 2");
    expect(result.seatLimit).toBe(5);
    expect(result.classes.map((item) => item.batchName)).toEqual(["gamma", "delta"]);

    const created = firestoreMock.getStore("organizationSubscriptions").get(result.subscriptionId);
    expect(created).toMatchObject({ status: "ACTIVE", seatLimit: 5, batchNumber: 2, batchLabel: "Batch 2", renewedFromSubscriptionId: null });

    // Classes exist with seats only — no codes, no codes email.
    const records = Array.from(firestoreMock.getStore("organizationBatches").values());
    expect(records).toHaveLength(2);
    expect(records.every((record) => record.status === "PENDING" && record.subscriptionId === result.subscriptionId)).toBe(true);
    expect(firestoreMock.getStore("organizationActivationCodes").size).toBe(2);
    expect(emailMocks.sendActivationCodesEmail).not.toHaveBeenCalled();

    // The school is told about the batch, and gets an in-app notice.
    expect(emailMocks.sendBatchCreatedEmail).toHaveBeenCalledTimes(1);
    expect(emailMocks.sendBatchCreatedEmail.mock.calls[0][0]).toMatchObject({ batchLabel: "Batch 2", totalSeats: 5 });
    expect(firestoreMock.getStore("organizationNotifications").size).toBe(1);

    // Batch 1 is exactly as it was: still ended, its licences still on it.
    expect(firestoreMock.getStore("organizationSubscriptions").get("sub-old")?.status).toBe("ACTIVE");
    expect(firestoreMock.getStore("organizationLicenses").get("lic-a")?.subscriptionId).toBe("sub-old");

    // The school counts only the live batch's seats and is ACTIVE again.
    const org = firestoreMock.getStore("organizations").get("org-1");
    expect(org?.purchasedSeats).toBe(5);
    expect(org?.status).toBe("ACTIVE");
    expect(org?.currentSubscriptionId).toBe(result.subscriptionId);
  });

  it("stores the batch's own payment and emails its bill", async () => {
    const { createBatch } = await import("../batchSubscriptionService");

    const result = await createBatch(
      "org-1",
      { ...window2027, classes: [{ batchName: "gamma", seatCount: 3 }], payment, idempotencyKey: "idem-create-pay" },
      "super-admin"
    );

    const stored = firestoreMock.getStore("organizationSubscriptions").get(result.subscriptionId)?.payment as any;
    expect(stored).toMatchObject({ totalAmount: 12000, paidAmount: 5000, pendingAmount: 7000, status: "INSTALLMENTS", method: "UPI" });
    expect(stored.description).toContain("Batch 2");
    expect(stored.description).toContain("gamma (3 codes)");
    expect(result.billNumber).toBe(stored.billNumber);
    expect(emailMocks.sendBillEmail).toHaveBeenCalledTimes(1);
    expect(result.billEmail?.sent).toBe(true);
  });

  it("bills codes × price per code per month × months, less the discount, and refuses totals that do not add up", async () => {
    const { createBatch } = await import("../batchSubscriptionService");
    const { renderBillText, renderBillHtml } = await import("../billService");
    const classes = [{ batchName: "gamma", seatCount: 3 }, { batchName: "delta", seatCount: 2 }];
    // A yearly batch is 12 months: 5 codes × ₹100 × 12 = ₹6,000; 10% off = ₹600; payable ₹5,400.

    await expect(
      createBatch(
        "org-1",
        { ...window2027, classes, payment: { amountPerCode: 100, totalAmount: 500, paidAmount: 0, installments: 1 }, idempotencyKey: "idem-pc-bad" },
        "super-admin"
      )
    ).rejects.toMatchObject({ code: "PAYMENT_TOTAL_MISMATCH" });

    await expect(
      createBatch(
        "org-1",
        {
          ...window2027,
          classes,
          payment: { amountPerCode: 100, discountPercent: 10, totalAmount: 6000, paidAmount: 0, installments: 1 },
          idempotencyKey: "idem-pc-nodisc",
        },
        "super-admin"
      )
    ).rejects.toMatchObject({ code: "PAYMENT_TOTAL_MISMATCH" });

    const result = await createBatch(
      "org-1",
      {
        ...window2027,
        classes,
        payment: { amountPerCode: 100, discountPercent: 10, totalAmount: 5400, paidAmount: 0, installments: 1 },
        idempotencyKey: "idem-pc-ok",
      },
      "super-admin"
    );
    const stored = firestoreMock.getStore("organizationSubscriptions").get(result.subscriptionId)?.payment as any;
    expect(stored).toMatchObject({
      amountPerCode: 100,
      codeCount: 5,
      months: 12,
      grossAmount: 6000,
      discountPercent: 10,
      discountAmount: 600,
      totalAmount: 5400,
      pendingAmount: 5400,
    });

    const recipient = { organizationId: "org-1", name: "Moonstar", contactName: "", contactEmail: "", contactPhone: "" };
    const text = renderBillText(recipient, stored);
    expect(text).toContain("gamma (Batch 2 · student activation codes) — 3 codes × ");
    expect(text).toContain("delta (Batch 2 · student activation codes) — 2 codes × ");
    expect(text).toContain("per code per month × 12 months");
    expect(text).toContain("Discount (10%)");
    expect(renderBillHtml(recipient, stored)).toContain("Discount (10%)");
  });

  it("builds a proper invoice: one line per class, amount in words, PDF attached to the email", async () => {
    const { createBatch } = await import("../batchSubscriptionService");
    const { renderBillHtml, renderBillPdf } = await import("../billService");
    const { amountInWords } = await import("../invoiceModel");

    const result = await createBatch(
      "org-1",
      {
        ...window2027,
        classes: [{ batchName: "Class 5A", seatCount: 3 }, { batchName: "Class 5B", seatCount: 2 }],
        payment: { amountPerCode: 100, discountPercent: 10, totalAmount: 5400, paidAmount: 1000, installments: 2, method: "CASH" },
        idempotencyKey: "idem-invoice",
      },
      "super-admin"
    );
    const stored = firestoreMock.getStore("organizationSubscriptions").get(result.subscriptionId)?.payment as any;

    // One line per class: codes × ₹100 × 12 months.
    expect(stored.lineItems).toEqual([
      expect.objectContaining({ item: "Class 5A", quantity: 3, rate: 100, months: 12, amount: 3600 }),
      expect.objectContaining({ item: "Class 5B", quantity: 2, rate: 100, months: 12, amount: 2400 }),
    ]);
    expect(stored).toMatchObject({ batchLabel: "Batch 2", billKind: "NEW" });

    const recipient = { organizationId: "org-1", name: "Moonstar", contactName: "Head", contactEmail: "a@b.c", contactPhone: "99" };
    const html = renderBillHtml(recipient, stored, { logoSrc: null });
    expect(html).toContain("Class 5A");
    expect(html).toContain("Indian Rupees Five Thousand Four Hundred Only");
    expect(html).not.toContain("Authorised Signatory");
    // The free-text description is no longer printed as the item.
    expect(html).not.toContain(stored.description);

    expect(amountInWords(125050.5)).toBe("Indian Rupees One Lakh Twenty Five Thousand Fifty and Fifty Paise Only");

    const pdf = await renderBillPdf(recipient, stored);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    // The emailed bill carries the PDF.
    const sent = emailMocks.sendBillEmail.mock.calls.at(-1)?.[0];
    expect(sent.attachments.some((file: any) => file.contentType === "application/pdf" && file.content.subarray(0, 5).toString("latin1") === "%PDF-")).toBe(true);
  });

  it("applies a discount to a typed amount too", async () => {
    const { createBatch } = await import("../batchSubscriptionService");
    const result = await createBatch(
      "org-1",
      {
        ...window2027,
        classes: [{ batchName: "gamma", seatCount: 3 }],
        payment: { grossAmount: 10000, discountPercent: 15, totalAmount: 8500, paidAmount: 8500, installments: 1, method: "CASH" },
        idempotencyKey: "idem-disc-manual",
      },
      "super-admin"
    );
    const stored = firestoreMock.getStore("organizationSubscriptions").get(result.subscriptionId)?.payment as any;
    expect(stored).toMatchObject({ grossAmount: 10000, discountAmount: 1500, totalAmount: 8500, status: "PREPAID", amountPerCode: null });
  });

  it("rejects a class name already used by the school, bad dates and an empty batch", async () => {
    const { createBatch } = await import("../batchSubscriptionService");

    await expect(
      createBatch("org-1", { ...window2027, classes: [{ batchName: "Alpha", seatCount: 1 }], idempotencyKey: "idem-dupe-1" }, "super-admin")
    ).rejects.toMatchObject({ code: "BATCH_NAME_TAKEN" });

    await expect(
      createBatch(
        "org-1",
        { planDuration: "YEARLY", startAt: "2027-01-01T00:00:00.000Z", expiresAt: "2026-01-01T00:00:00.000Z", classes: [{ batchName: "gamma", seatCount: 1 }], idempotencyKey: "idem-dates-1" },
        "super-admin"
      )
    ).rejects.toMatchObject({ code: "INVALID_PLAN_DATES" });

    await expect(
      createBatch("org-1", { ...window2027, classes: [], idempotencyKey: "idem-empty-1" }, "super-admin")
    ).rejects.toMatchObject({ code: "CLASSES_REQUIRED" });

    await expect(
      createBatch(
        "org-1",
        { ...window2027, classes: [{ batchName: "Class 5A", seatCount: 2 }, { batchName: "class 5a", seatCount: 3 }], idempotencyKey: "idem-twice-1" },
        "super-admin"
      )
    ).rejects.toMatchObject({ code: "BATCH_NAME_TAKEN" });

    expect(firestoreMock.getStore("organizationSubscriptions").size).toBe(1);
  });

  it("refuses the same request twice", async () => {
    const { createBatch } = await import("../batchSubscriptionService");
    const input = { ...window2027, classes: [{ batchName: "gamma", seatCount: 3 }], idempotencyKey: "idem-same" };
    await createBatch("org-1", input, "super-admin");
    await expect(createBatch("org-1", { ...input, classes: [{ batchName: "omega", seatCount: 1 }] }, "super-admin")).rejects.toMatchObject({
      code: "DUPLICATE_REQUEST",
    });
  });
});

describe("renewBatch", () => {
  beforeEach(() => {
    firestoreMock.reset();
    Object.values(emailMocks).forEach((mock) => mock.mockClear());
    seedSchoolWithEndedBatch();
  });

  it("renews one batch in place: same codes, new period, students back", async () => {
    const { renewBatch } = await import("../batchSubscriptionService");

    const result = await renewBatch("org-1", "sub-old", { ...window2027, payment, idempotencyKey: "idem-renew-1" }, "super-admin");

    expect(result.batchLabel).toBe("Batch 1");
    expect(result.classes).toEqual(["alpha", "beta"]);
    expect(result.licensesRestored).toBe(2);
    expect(result.studentsReactivated).toBe(1);
    expect(result.seatLimit).toBe(2);

    const renewed = firestoreMock.getStore("organizationSubscriptions").get(result.subscriptionId);
    expect(renewed).toMatchObject({ status: "ACTIVE", batchNumber: 1, batchLabel: "Batch 1", renewedFromSubscriptionId: "sub-old", seatLimit: 2 });
    expect((renewed?.payment as any).description).toContain("Batch 1 renewal");
    expect(firestoreMock.getStore("organizationSubscriptions").get("sub-old")?.status).toBe("RENEWED");

    // Same licence and code documents, now on the new period.
    expect(firestoreMock.getStore("organizationLicenses").get("lic-a")).toMatchObject({ status: "ACTIVE", subscriptionId: result.subscriptionId });
    expect(firestoreMock.getStore("organizationLicenses").get("lic-b")).toMatchObject({ status: "UNUSED", subscriptionId: result.subscriptionId });
    expect(firestoreMock.getStore("organizationActivationCodes").get("code-a")?.status).toBe("REDEEMED");
    expect(firestoreMock.getStore("organizationActivationCodes").get("code-b")?.status).toBe("UNUSED");
    expect(firestoreMock.getStore("userOrganizationEntitlements").get("student-1")).toMatchObject({ status: "ACTIVE", subscriptionId: result.subscriptionId });
    expect(firestoreMock.getStore("organizationActivationCodes").size).toBe(2);

    const org = firestoreMock.getStore("organizations").get("org-1");
    expect(org).toMatchObject({ purchasedSeats: 2, activatedSeats: 1, status: "ACTIVE", currentSubscriptionId: result.subscriptionId });

    expect(emailMocks.sendBatchRenewalEmail).toHaveBeenCalledTimes(1);
    expect(emailMocks.sendBatchRenewalEmail.mock.calls[0][0]).toMatchObject({ batchLabel: "Batch 1", batchNames: ["alpha", "beta"] });
    expect(emailMocks.sendBillEmail).toHaveBeenCalledTimes(1);
    expect(emailMocks.sendActivationCodesEmail).not.toHaveBeenCalled();
  });

  it("leaves other batches alone when one batch is renewed", async () => {
    const { createBatch, renewBatch } = await import("../batchSubscriptionService");

    const second = await createBatch(
      "org-1",
      { ...window2027, classes: [{ batchName: "gamma", seatCount: 3 }], idempotencyKey: "idem-second" },
      "super-admin"
    );
    const renewal = await renewBatch(
      "org-1",
      "sub-old",
      { planDuration: "YEARLY", startAt: "2026-07-01T00:00:00.000Z", expiresAt: "2027-12-31T00:00:00.000Z", idempotencyKey: "idem-renew-2" },
      "super-admin"
    );

    // Batch 2 and its waiting class did not move.
    expect(firestoreMock.getStore("organizationSubscriptions").get(second.subscriptionId)?.status).toBe("ACTIVE");
    const gamma = Array.from(firestoreMock.getStore("organizationBatches").values()).find((record) => record.batchName === "gamma");
    expect(gamma?.subscriptionId).toBe(second.subscriptionId);
    expect(renewal.pendingClassesMoved).toEqual([]);

    // Both batches count: 3 (Batch 2) + 2 (renewed Batch 1).
    expect(firestoreMock.getStore("organizations").get("org-1")?.purchasedSeats).toBe(5);
  });

  it("moves a class that was still waiting for codes onto the renewed period", async () => {
    const { createBatch, renewBatch } = await import("../batchSubscriptionService");

    const batch = await createBatch(
      "org-1",
      { ...window2027, classes: [{ batchName: "gamma", seatCount: 3 }], idempotencyKey: "idem-wait" },
      "super-admin"
    );
    const renewal = await renewBatch(
      "org-1",
      batch.subscriptionId,
      { planDuration: "YEARLY", startAt: "2027-07-01T00:00:00.000Z", expiresAt: "2028-07-01T00:00:00.000Z", idempotencyKey: "idem-wait-renew" },
      "super-admin"
    );

    expect(renewal.pendingClassesMoved).toEqual(["gamma"]);
    const gamma = Array.from(firestoreMock.getStore("organizationBatches").values()).find((record) => record.batchName === "gamma");
    expect(gamma?.subscriptionId).toBe(renewal.subscriptionId);
    expect(gamma?.windowUpdatedAt).toBeTruthy();
  });

  it("refuses to renew a period that was already renewed, a cancelled batch, or to a shorter end date", async () => {
    const { renewBatch, cancelBatch } = await import("../batchSubscriptionService");

    const first = await renewBatch("org-1", "sub-old", { ...window2027, idempotencyKey: "idem-r1" }, "super-admin");
    await expect(renewBatch("org-1", "sub-old", { ...window2027, idempotencyKey: "idem-r2" }, "super-admin")).rejects.toMatchObject({
      code: "BATCH_ALREADY_RENEWED",
    });
    await expect(
      renewBatch("org-1", first.subscriptionId, { ...window2027, idempotencyKey: "idem-r3" }, "super-admin")
    ).rejects.toMatchObject({ code: "INVALID_PLAN_DATES" });

    await cancelBatch("org-1", first.subscriptionId, "super-admin");
    await expect(
      renewBatch(
        "org-1",
        first.subscriptionId,
        { planDuration: "YEARLY", startAt: "2027-07-01T00:00:00.000Z", expiresAt: "2028-07-01T00:00:00.000Z", idempotencyKey: "idem-r4" },
        "super-admin"
      )
    ).rejects.toMatchObject({ code: "BATCH_CANCELLED" });
  });
});

describe("school status follows its batches", () => {
  beforeEach(() => {
    firestoreMock.reset();
    Object.values(emailMocks).forEach((mock) => mock.mockClear());
    seedSchoolWithEndedBatch();
  });

  it("is ACTIVE while any batch is live and EXPIRED only when all have ended", async () => {
    const { getEffectiveOrganizationStatus } = await import("../../repositories/organizationRepository");
    const now = new Date("2026-06-01T00:00:00.000Z");
    const ended = { status: "ACTIVE" as const, expiresAt: ts(LAPSED) as any };
    const live = { status: "ACTIVE" as const, expiresAt: ts("2027-01-01T00:00:00.000Z") as any };
    const cancelled = { status: "CANCELLED" as const, expiresAt: ts("2027-01-01T00:00:00.000Z") as any };
    const renewed = { status: "RENEWED" as const, expiresAt: ts("2027-01-01T00:00:00.000Z") as any };

    expect(getEffectiveOrganizationStatus({ status: "ACTIVE" }, [ended, live], now)).toBe("ACTIVE");
    expect(getEffectiveOrganizationStatus({ status: "ACTIVE" }, [ended, ended], now)).toBe("EXPIRED");
    expect(getEffectiveOrganizationStatus({ status: "EXPIRED" }, [ended, live], now)).toBe("ACTIVE");
    expect(getEffectiveOrganizationStatus({ status: "ACTIVE" }, [cancelled, renewed], now)).toBe("EXPIRED");
    expect(getEffectiveOrganizationStatus({ status: "SUSPENDED" }, [live], now)).toBe("SUSPENDED");
    expect(getEffectiveOrganizationStatus({ status: "ACTIVE" }, [], now)).toBe("ACTIVE");
  });

  it("cancelling the only live batch makes the school EXPIRED; its other batch is unaffected", async () => {
    const { createBatch, cancelBatch } = await import("../batchSubscriptionService");

    const batch = await createBatch(
      "org-1",
      { ...window2027, classes: [{ batchName: "gamma", seatCount: 3 }], idempotencyKey: "idem-cancel" },
      "super-admin"
    );
    expect(firestoreMock.getStore("organizations").get("org-1")?.status).toBe("ACTIVE");

    await cancelBatch("org-1", batch.subscriptionId, "super-admin");

    expect(firestoreMock.getStore("organizationSubscriptions").get(batch.subscriptionId)?.status).toBe("CANCELLED");
    expect(firestoreMock.getStore("organizationSubscriptions").get("sub-old")?.status).toBe("ACTIVE");
    const org = firestoreMock.getStore("organizations").get("org-1");
    expect(org?.status).toBe("EXPIRED");
    expect(org?.purchasedSeats).toBe(0);
  });
});

describe("code generation against the class's own batch", () => {
  beforeEach(() => {
    firestoreMock.reset();
    Object.values(emailMocks).forEach((mock) => mock.mockClear());
    seedSchoolWithEndedBatch();
  });

  async function addBatch2(seatCount = 3) {
    const { createBatch } = await import("../batchSubscriptionService");
    return createBatch(
      "org-1",
      { ...window2027, classes: [{ batchName: "gamma", seatCount }], idempotencyKey: `idem-b2-${seatCount}-${Date.now()}` },
      "super-admin"
    );
  }

  it("saves a big class in chunks, and removes everything if a chunk fails", async () => {
    const { generateCodesForOrganization } = await import("../codeGenerationService");
    const codesOf = (name: string) =>
      Array.from(firestoreMock.getStore("organizationActivationCodes").values()).filter((code) => code.batchName === name);

    // 450 codes: saved as 200 + 200 + 50, plus the lock.
    await addBatch2(450);
    const calls = firestoreMock.db.runTransaction.mock.calls.length;
    const made = await generateCodesForOrganization(
      { organizationId: "org-1", numberOfCodes: 450, batchName: "gamma", idempotencyKey: "idem-big" },
      "super-admin"
    );
    expect(made.codes).toHaveLength(450);
    expect(codesOf("gamma")).toHaveLength(450);
    expect(firestoreMock.db.runTransaction.mock.calls.length - calls).toBeGreaterThanOrEqual(4);

    // A 3rd chunk that fails: nothing of the run is kept and the class is still waiting.
    const { createBatch } = await import("../batchSubscriptionService");
    await createBatch("org-1", { ...window2027, classes: [{ batchName: "delta", seatCount: 450 }], idempotencyKey: "idem-b-delta" }, "super-admin");
    const licencesBefore = firestoreMock.getStore("organizationLicenses").size;
    const real = firestoreMock.db.runTransaction.getMockImplementation()!;
    let n = 0;
    firestoreMock.db.runTransaction.mockImplementation(async (fn: any) => {
      n++;
      if (n === 4) throw Object.assign(new Error("deadline exceeded"), { code: 4 }); // lock, chunk 1, chunk 2, chunk 3 fails
      return real(fn);
    });
    await expect(
      generateCodesForOrganization({ organizationId: "org-1", numberOfCodes: 450, batchName: "delta", idempotencyKey: "idem-fail" }, "super-admin")
    ).rejects.toMatchObject({ code: "CODE_SAVE_FAILED" });
    firestoreMock.db.runTransaction.mockImplementation(real);

    expect(codesOf("delta")).toHaveLength(0);
    expect(firestoreMock.getStore("organizationLicenses").size).toBe(licencesBefore);
    expect(firestoreMock.getStore("organizationAuditLogs").has("idem_idem-fail")).toBe(false);
    const delta = Array.from(firestoreMock.getStore("organizationBatches").values()).find((item) => item.batchName === "delta");
    expect(delta?.status).toBe("PENDING");

    // Retrying works.
    const retry = await generateCodesForOrganization(
      { organizationId: "org-1", numberOfCodes: 450, batchName: "delta", idempotencyKey: "idem-retry" },
      "super-admin"
    );
    expect(retry.codes).toHaveLength(450);
  });

  it("never accepts a student ID the school has already used", async () => {
    const { createBatch } = await import("../batchSubscriptionService");
    const { generateCodesForOrganization, findUsedStudentIds } = await import("../codeGenerationService");
    await createBatch(
      "org-1",
      { ...window2027, classes: [{ batchName: "ids-a", seatCount: 2 }, { batchName: "ids-b", seatCount: 2 }], idempotencyKey: "idem-ids" },
      "super-admin"
    );
    await generateCodesForOrganization(
      { organizationId: "org-1", numberOfCodes: 2, batchName: "ids-a", codeGenerationMode: "STUDENT_IDS", studentIdentifiers: ["S1", "S2"], idempotencyKey: "idem-ids-1" },
      "super-admin"
    );
    // "s2" is S2 in any case, in another class of the same school: refused, nothing saved.
    await expect(
      generateCodesForOrganization(
        { organizationId: "org-1", numberOfCodes: 2, batchName: "ids-b", codeGenerationMode: "STUDENT_IDS", studentIdentifiers: ["s2", "S3"], idempotencyKey: "idem-ids-2" },
        "super-admin"
      )
    ).rejects.toMatchObject({ code: "STUDENT_ID_ALREADY_USED" });
    expect(Array.from(firestoreMock.getStore("organizationActivationCodes").values()).filter((code) => code.batchName === "ids-b")).toHaveLength(0);
    expect(await findUsedStudentIds("org-1", ["s1", "S9"])).toEqual(["s1"]);
  });

  it("refuses a class bigger than the per-class limit", async () => {
    const { createBatch } = await import("../batchSubscriptionService");
    await expect(
      createBatch("org-1", { ...window2027, classes: [{ batchName: "huge", seatCount: 2001 }], idempotencyKey: "idem-huge" }, "super-admin")
    ).rejects.toMatchObject({ code: "CLASS_TOO_LARGE" });
  });

  it("the class decides its batch; codes land on that batch with its end date", async () => {
    const { generateCodesForOrganization } = await import("../codeGenerationService");
    const batch = await addBatch2(3);

    const generated = await generateCodesForOrganization(
      { organizationId: "org-1", numberOfCodes: 3, batchName: "gamma", idempotencyKey: "idem-gen-1" },
      "super-admin"
    );

    expect(generated.codes).toHaveLength(3);
    const codes = Array.from(firestoreMock.getStore("organizationActivationCodes").values()).filter((code) => code.batchName === "gamma");
    expect(codes).toHaveLength(3);
    expect(codes.every((code) => code.subscriptionId === batch.subscriptionId)).toBe(true);
    const licence = firestoreMock.getStore("organizationLicenses").get(generated.codes[0].licenseId);
    expect((licence?.expiresAt as any).toDate().toISOString()).toBe(window2027.expiresAt);
    expect(emailMocks.sendActivationCodesEmail).toHaveBeenCalledTimes(1);

    // The class is fulfilled; a second run for it is refused.
    await expect(
      generateCodesForOrganization(
        { organizationId: "org-1", numberOfCodes: 1, batchName: "gamma", idempotencyKey: "idem-gen-2" },
        "super-admin"
      )
    ).rejects.toMatchObject({ code: "SHEET_ALREADY_HAS_CODES" });
  });

  it("refuses more codes than the class is waiting for, and a class pointed at the wrong batch", async () => {
    const { generateCodesForOrganization } = await import("../codeGenerationService");
    await addBatch2(2);

    await expect(
      generateCodesForOrganization(
        { organizationId: "org-1", numberOfCodes: 5, batchName: "gamma", idempotencyKey: "idem-over" },
        "super-admin"
      )
    ).rejects.toMatchObject({ code: "BATCH_ALLOCATION_EXCEEDED" });

    await expect(
      generateCodesForOrganization(
        { organizationId: "org-1", subscriptionId: "sub-old", numberOfCodes: 1, batchName: "gamma", idempotencyKey: "idem-wrong" },
        "super-admin"
      )
    ).rejects.toMatchObject({ code: "CLASS_BATCH_MISMATCH" });
  });

  it("refuses codes for a batch that has ended, even though another batch is live", async () => {
    const { generateCodesForOrganization } = await import("../codeGenerationService");
    await addBatch2(3);

    await expect(
      generateCodesForOrganization(
        { organizationId: "org-1", subscriptionId: "sub-old", numberOfCodes: 1, batchName: "zeta", idempotencyKey: "idem-ended" },
        "super-admin"
      )
    ).rejects.toMatchObject({ code: "SUBSCRIPTION_EXPIRED" });
  });

  it("adds a few codes to an existing class inside the same batch", async () => {
    const { generateCodesForOrganization } = await import("../codeGenerationService");
    const { addSeatsToClass } = await import("../batchSubscriptionService");
    const batch = await addBatch2(3);
    await generateCodesForOrganization(
      { organizationId: "org-1", numberOfCodes: 3, batchName: "gamma", idempotencyKey: "idem-top-1" },
      "super-admin"
    );

    const added = await addSeatsToClass("org-1", batch.subscriptionId, "gamma", 2, "super-admin");
    expect(added).toMatchObject({ seatCount: 5, pendingSeats: 2, seatLimit: 5 });
    expect(firestoreMock.getStore("organizationSubscriptions").get(batch.subscriptionId)?.seatLimit).toBe(5);
    expect(firestoreMock.getStore("organizations").get("org-1")?.purchasedSeats).toBe(5);

    // The class shows up in Create Codes' list with its two extra seats, and keeps its status.
    const { listOrganizationBatches } = await import("../batchService");
    const listed = (await listOrganizationBatches("org-1")).find((item) => item.batchName === "gamma");
    expect(listed).toMatchObject({ isPending: true, pendingSeats: 2, codeCount: 3 });
    expect(listed?.status).not.toBe("PENDING");

    // Create Codes now sees exactly two seats waiting, and nothing more.
    await expect(
      generateCodesForOrganization(
        { organizationId: "org-1", numberOfCodes: 3, batchName: "gamma", idempotencyKey: "idem-top-2" },
        "super-admin"
      )
    ).rejects.toMatchObject({ code: "BATCH_ALLOCATION_EXCEEDED" });
    const generated = await generateCodesForOrganization(
      { organizationId: "org-1", numberOfCodes: 2, batchName: "gamma", idempotencyKey: "idem-top-3" },
      "super-admin"
    );
    expect(generated.codes).toHaveLength(2);
    const gammaCodes = Array.from(firestoreMock.getStore("organizationActivationCodes").values()).filter((code) => code.batchName === "gamma");
    expect(gammaCodes).toHaveLength(5);
    // Made: it leaves the Create Codes list again.
    const after = (await listOrganizationBatches("org-1")).find((item) => item.batchName === "gamma");
    expect(after).toMatchObject({ isPending: false, pendingSeats: 0, codeCount: 5 });
  });

  it("replaces a lost code inside its own batch, and refuses once that batch has ended", async () => {
    const { replaceLicense } = await import("../codeGenerationService");
    const { renewBatch } = await import("../batchSubscriptionService");

    await expect(replaceLicense("lic-b", "lost", "super-admin")).rejects.toMatchObject({ code: "BATCH_NOT_LIVE" });

    const renewal = await renewBatch("org-1", "sub-old", { ...window2027, idempotencyKey: "idem-replace-renew" }, "super-admin");
    const replaced = await replaceLicense("lic-b", "lost", "super-admin");

    expect(replaced.batchName).toBe("beta");
    const newCode = Array.from(firestoreMock.getStore("organizationActivationCodes").values()).find(
      (code) => code.licenseId === replaced.codes[0].licenseId
    );
    expect(newCode).toMatchObject({ batchName: "beta", subscriptionId: renewal.subscriptionId, status: "UNUSED" });
    expect(firestoreMock.getStore("organizationActivationCodes").get("code-b")?.status).toBe("REPLACED");
    expect(firestoreMock.getStore("organizationLicenses").get("lic-b")?.status).toBe("REVOKED");
    expect(emailMocks.sendActivationCodesEmail).not.toHaveBeenCalled();
  });
});

describe("batch views", () => {
  beforeEach(() => {
    firestoreMock.reset();
    Object.values(emailMocks).forEach((mock) => mock.mockClear());
    seedSchoolWithEndedBatch();
  });

  it("lists every batch with its classes, status and per-batch seats", async () => {
    const { createBatch } = await import("../batchSubscriptionService");
    const { listBatchSubscriptions } = await import("../batchService");
    const second = await createBatch(
      "org-1",
      { ...window2027, classes: [{ batchName: "gamma", seatCount: 3 }], payment, idempotencyKey: "idem-view" },
      "super-admin"
    );

    const views = await listBatchSubscriptions("org-1", { audience: "school", now: new Date("2026-08-01T00:00:00.000Z") });

    expect(views.map((view) => view.batchLabel)).toEqual(["Batch 1", "Batch 2"]);
    const [first, next] = views;
    expect(first).toMatchObject({ status: "EXPIRED", isLive: false, isCurrentPeriod: true, seatLimit: 2 });
    expect(first.classes.map((item) => item.batchName)).toEqual(["alpha", "beta"]);
    expect(first.seatUsage.totalSeats).toBe(2);
    expect(first.daysRemaining).toBeLessThan(0);

    expect(next).toMatchObject({ subscriptionId: second.subscriptionId, status: "ACTIVE", isLive: true, seatLimit: 3 });
    expect(next.classes).toEqual([
      expect.objectContaining({ batchName: "gamma", seatCount: 3, codeCount: 0, pendingSeats: 3, isPending: true, status: "PENDING" }),
    ]);
    expect(next.seatUsage.remainingCapacity).toBe(3);
    // The school sees the payment summary but never the method details.
    expect(next.payment).toMatchObject({ totalAmount: 12000, status: "INSTALLMENTS", method: "UPI" });
    expect((next.payment as any).methodDetails).toBeUndefined();
  });
});

describe("installments, payments and new bills", () => {
  beforeEach(() => {
    firestoreMock.reset();
    Object.values(emailMocks).forEach((mock) => mock.mockClear());
    seedSchoolWithEndedBatch();
  });

  async function batchWithPlan() {
    const { createBatch } = await import("../batchSubscriptionService");
    return createBatch(
      "org-1",
      {
        ...window2027,
        classes: [{ batchName: "gamma", seatCount: 3 }],
        payment: {
          grossAmount: 9000,
          totalAmount: 9000,
          paidAmount: 3000,
          installments: 3,
          method: "CASH",
          installmentDueDates: ["2026-07-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"],
        },
        idempotencyKey: `idem-plan-${Date.now()}`,
      },
      "super-admin"
    );
  }

  it("keeps the admin's due dates and splits the amount into equal parts", async () => {
    const batch = await batchWithPlan();
    const stored = firestoreMock.getStore("organizationSubscriptions").get(batch.subscriptionId)?.payment as any;
    expect(stored.installmentPlan.map((item: any) => item.amount)).toEqual([3000, 3000, 3000]);
    expect(stored.installmentPlan.map((item: any) => item.dueDate.toDate().toISOString())).toEqual([
      "2026-07-01T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z",
      "2027-01-01T00:00:00.000Z",
    ]);
    expect(stored.bills).toHaveLength(1);
    expect(stored.transactions).toHaveLength(1);
  });

  it("works out each installment's state: paid, due, overdue", async () => {
    const { installmentViews, splitInstallments } = await import("../paymentSchedule");
    expect(splitInstallments(100, 3)).toEqual([33.33, 33.33, 33.34]);

    const batch = await batchWithPlan();
    const stored = firestoreMock.getStore("organizationSubscriptions").get(batch.subscriptionId)?.payment as any;
    // 3 Oct 2026: installment 2 due 2 days ago; 20 Oct: 19 days late → overdue.
    expect(installmentViews(stored, { asOf: new Date("2026-10-03T00:00:00Z") }).map((item) => item.status)).toEqual(["PAID", "DUE", "UPCOMING"]);
    expect(installmentViews(stored, { asOf: new Date("2026-10-20T00:00:00Z") }).map((item) => item.status)).toEqual([
      "PAID",
      "OVERDUE",
      "UPCOMING",
    ]);
  });

  it("records a later installment and issues a new bill by email and in the portal", async () => {
    const { recordPayment } = await import("../paymentService");
    const { renderBillHtml } = await import("../billService");
    const batch = await batchWithPlan();
    emailMocks.sendBillEmail.mockClear();

    const result = await recordPayment(
      "org-1",
      batch.subscriptionId,
      { amount: 3000, method: "UPI", methodDetails: { transactionId: "UPI-2" }, paidAt: "2026-10-02T00:00:00.000Z" },
      "super-admin"
    );

    const stored = firestoreMock.getStore("organizationSubscriptions").get(batch.subscriptionId)?.payment as any;
    expect(result.billNumber).toBe(`${stored.billNumber}-2`);
    expect(stored).toMatchObject({ paidAmount: 6000, pendingAmount: 3000, status: "INSTALLMENTS", method: "UPI" });
    expect(stored.transactions).toHaveLength(2);
    expect(stored.bills.map((bill: any) => [bill.kind, bill.paidToDate, bill.balance])).toEqual([
      ["INVOICE", 3000, 6000],
      ["PAYMENT", 6000, 3000],
    ]);

    // The new bill was emailed, with the PDF, and the school was told in the portal.
    expect(emailMocks.sendBillEmail).toHaveBeenCalledTimes(1);
    expect(emailMocks.sendBillEmail.mock.calls[0][0].billNumber).toBe(result.billNumber);
    const notices = Array.from(firestoreMock.getStore("organizationNotifications").values());
    expect(notices.some((notice) => notice.type === "PAYMENT_RECEIVED")).toBe(true);

    // The first invoice still reads as it was; the new bill shows the update.
    const recipient = { organizationId: "org-1", name: "Moonstar", contactName: "", contactEmail: "", contactPhone: "" };
    const first = renderBillHtml(recipient, stored, { logoSrc: null });
    const second = renderBillHtml(recipient, stored, { logoSrc: null, billNumber: result.billNumber });
    expect(first).not.toContain("Updated bill");
    expect(second).toContain("Updated bill after a payment of INR 3,000.00");
    expect(second).toContain("Installment schedule");
    expect(second).toContain("Payments received");

    // Paying the rest settles the bill; paying more than the balance is refused.
    await expect(
      recordPayment("org-1", batch.subscriptionId, { amount: 5000, method: "CASH" }, "super-admin")
    ).rejects.toMatchObject({ code: "PAYMENT_TOO_LARGE" });
    const last = await recordPayment("org-1", batch.subscriptionId, { amount: 3000, method: "CASH" }, "super-admin");
    expect(last).toMatchObject({ pendingAmount: 0, status: "PREPAID", billNumber: `${stored.billNumber}-3` });
    await expect(
      recordPayment("org-1", batch.subscriptionId, { amount: 1, method: "CASH" }, "super-admin")
    ).rejects.toMatchObject({ code: "BILL_ALREADY_PAID" });
  });

  it("lets the admin move due dates; reminders restart for a changed date", async () => {
    const { updateInstallmentDueDates } = await import("../paymentService");
    const batch = await batchWithPlan();
    await updateInstallmentDueDates(
      "org-1",
      batch.subscriptionId,
      ["2026-07-01T00:00:00.000Z", "2026-11-15T00:00:00.000Z", "2027-01-01T00:00:00.000Z"],
      "super-admin"
    );
    const stored = firestoreMock.getStore("organizationSubscriptions").get(batch.subscriptionId)?.payment as any;
    expect(stored.installmentPlan[1].dueDate.toDate().toISOString()).toBe("2026-11-15T00:00:00.000Z");
    await expect(updateInstallmentDueDates("org-1", batch.subscriptionId, ["2026-07-01T00:00:00.000Z"], "super-admin")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("reminds the school before, on and after the due date, once each", async () => {
    const { runBatchNotifications } = await import("../notificationService");
    const batch = await batchWithPlan();
    const types = () =>
      Array.from(firestoreMock.getStore("organizationNotifications").values())
        .filter((notice) => notice.subscriptionId === batch.subscriptionId && String(notice.type).startsWith("PAYMENT"))
        .map((notice) => notice.type);

    await runBatchNotifications({ now: new Date("2026-09-29T00:00:00Z") }); // 2 days before installment 2
    expect(emailMocks.sendPaymentReminderEmail.mock.calls.map((call) => call[0].stage)).toEqual(["UPCOMING"]);
    await runBatchNotifications({ now: new Date("2026-09-30T00:00:00Z") }); // nothing new
    await runBatchNotifications({ now: new Date("2026-10-01T06:00:00Z") }); // due
    await runBatchNotifications({ now: new Date("2026-10-09T00:00:00Z") }); // 8 days late
    await runBatchNotifications({ now: new Date("2026-10-10T00:00:00Z") }); // nothing new

    expect(emailMocks.sendPaymentReminderEmail.mock.calls.map((call) => call[0].stage)).toEqual(["UPCOMING", "DUE", "OVERDUE"]);
    expect(types()).toEqual(["PAYMENT_DUE", "PAYMENT_DUE", "PAYMENT_OVERDUE"]);
  });

  it("keeps the amount paid now separate: the installments split only what is left", async () => {
    const { createBatch } = await import("../batchSubscriptionService");
    const { recordPayment } = await import("../paymentService");
    const { amountDueNow, installmentViews } = await import("../paymentSchedule");
    const batch = await createBatch(
      "org-1",
      {
        ...window2027,
        classes: [{ batchName: "upfront", seatCount: 3 }],
        payment: {
          grossAmount: 9000,
          totalAmount: 9000,
          paidAmount: 3000,
          method: "CASH",
          installments: 2,
          splitBalance: true,
          installmentDueDates: ["2026-08-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z"],
        },
        idempotencyKey: "idem-upfront",
      },
      "super-admin"
    );
    const stored = () => firestoreMock.getStore("organizationSubscriptions").get(batch.subscriptionId)?.payment as any;
    expect(stored().upfrontAmount).toBe(3000);
    expect(stored().installmentPlan.map((item: any) => item.amount)).toEqual([3000, 3000]);
    // The 3000 paid now does not count towards installment 1.
    expect(installmentViews(stored(), { asOf: new Date("2026-08-05T00:00:00Z") }).map((v: any) => v.status)).toEqual(["DUE", "UPCOMING"]);
    expect(amountDueNow(stored(), new Date("2026-08-05T00:00:00Z"))).toBe(3000);

    await recordPayment("org-1", batch.subscriptionId, { amount: 3000, method: "CASH" }, "super-admin");
    expect(installmentViews(stored(), { asOf: new Date("2026-08-05T00:00:00Z") }).map((v: any) => v.status)).toEqual(["PAID", "UPCOMING"]);
  });

  it("paid in full now: no installments at all", async () => {
    const { createBatch } = await import("../batchSubscriptionService");
    const batch = await createBatch(
      "org-1",
      {
        ...window2027,
        classes: [{ batchName: "prepaid", seatCount: 3 }],
        payment: { grossAmount: 9000, totalAmount: 9000, paidAmount: 9000, method: "CASH", installments: 1, splitBalance: true },
        idempotencyKey: "idem-prepaid",
      },
      "super-admin"
    );
    const stored = firestoreMock.getStore("organizationSubscriptions").get(batch.subscriptionId)?.payment as any;
    expect(stored.installmentPlan).toBeNull();
    expect(stored.status).toBe("PREPAID");
  });

  it("after the overdue email, follows up every 3 days until the installment is paid", async () => {
    const { runBatchNotifications } = await import("../notificationService");
    const { recordPayment } = await import("../paymentService");
    const batch = await batchWithPlan(); // installment 2: 3000 due 1 Oct 2026
    const night = (iso: string) => runBatchNotifications({ now: new Date(iso) });
    const stages = () =>
      emailMocks.sendPaymentReminderEmail.mock.calls.filter((call) => call[0].installmentNumber === 2).map((call) => call[0].stage);

    await night("2026-10-09T00:00:00Z"); // 8 days late: overdue email
    expect(stages().at(-1)).toBe("OVERDUE");
    await night("2026-10-11T00:00:00Z"); // 2 days after: nothing
    await night("2026-10-12T00:00:00Z"); // 3 days after: follow-up 1
    await night("2026-10-14T00:00:00Z"); // nothing
    await night("2026-10-15T00:00:00Z"); // follow-up 2
    expect(stages().filter((stage) => stage === "FOLLOW_UP")).toHaveLength(2);
    const followUps = emailMocks.sendPaymentReminderEmail.mock.calls.filter((call) => call[0].stage === "FOLLOW_UP");
    expect(followUps.map((call) => call[0].followUpNumber)).toEqual([1, 2]);
    // Email only: still just the 3 standard in-app notices for this batch.
    const notices = Array.from(firestoreMock.getStore("organizationNotifications").values()).filter(
      (notice) => notice.subscriptionId === batch.subscriptionId && String(notice.type).startsWith("PAYMENT")
    );
    expect(notices.length).toBeLessThanOrEqual(3);

    // Paid: no more follow-ups.
    await recordPayment("org-1", batch.subscriptionId, { amount: 3000, method: "CASH" }, "super-admin");
    await night("2026-10-18T00:00:00Z");
    await night("2026-10-21T00:00:00Z");
    expect(stages().filter((stage) => stage === "FOLLOW_UP")).toHaveLength(2);
  });

  it("retries a reminder email that failed, the next night, without a second in-app notice", async () => {
    const { runBatchNotifications } = await import("../notificationService");
    const batch = await batchWithPlan();
    emailMocks.sendPaymentReminderEmail.mockRejectedValueOnce(new Error("smtp down"));

    await runBatchNotifications({ now: new Date("2026-09-28T00:00:00Z") }); // email fails
    const plan = () => (firestoreMock.getStore("organizationSubscriptions").get(batch.subscriptionId)?.payment as any).installmentPlan;
    expect(plan()[1].reminderEmailPending).toBe("UPCOMING");

    await runBatchNotifications({ now: new Date("2026-09-29T00:00:00Z") }); // retried
    expect(emailMocks.sendPaymentReminderEmail.mock.calls.map((call) => call[0].stage)).toEqual(["UPCOMING", "UPCOMING"]);
    expect(plan()[1].reminderEmailPending).toBeNull();
    const notices = Array.from(firestoreMock.getStore("organizationNotifications").values()).filter(
      (notice) => notice.subscriptionId === batch.subscriptionId && notice.type === "PAYMENT_DUE"
    );
    expect(notices).toHaveLength(1);
  });
});

describe("stopping and restarting access by hand", () => {
  beforeEach(() => {
    firestoreMock.reset();
    Object.values(emailMocks).forEach((mock) => mock.mockClear());
    seedSchoolWithEndedBatch();
  });

  it("stops a batch's students, keeps other batches, and restores the same codes on restart", async () => {
    const { renewBatch, createBatch, pauseBatch, resumeBatch } = await import("../batchSubscriptionService");
    const { refreshEntitlement } = await import("../redemptionService");
    const { generateCodesForOrganization } = await import("../codeGenerationService");

    // Batch 1 renewed (student-1 active), Batch 2 live with its own class.
    const renewal = await renewBatch("org-1", "sub-old", { ...window2027, idempotencyKey: "idem-p-renew" }, "super-admin");
    const other = await createBatch("org-1", { ...window2027, classes: [{ batchName: "gamma", seatCount: 2 }], idempotencyKey: "idem-p-b2" }, "super-admin");
    expect((await refreshEntitlement("student-1")).status).toBe("ACTIVE");

    const paused = await pauseBatch("org-1", renewal.subscriptionId, "Installment 2 overdue", "super-admin");
    expect(paused.studentsAffected).toBe(1);
    expect(firestoreMock.getStore("organizationSubscriptions").get(renewal.subscriptionId)).toMatchObject({
      status: "SUSPENDED",
      pauseReason: "Installment 2 overdue",
    });
    expect(firestoreMock.getStore("userOrganizationEntitlements").get("student-1")?.status).toBe("EXPIRED");
    // The app's own check agrees: no access.
    expect((await refreshEntitlement("student-1")).status).toBe("EXPIRED");
    // Renewing while paused would quietly undo the pause, so it is refused.
    await expect(
      renewBatch("org-1", renewal.subscriptionId, { ...window2027, idempotencyKey: "idem-p-renew-paused" }, "super-admin")
    ).rejects.toMatchObject({ code: "BATCH_PAUSED" });
    // Codes and licences are kept as they were.
    expect(firestoreMock.getStore("organizationActivationCodes").get("code-a")?.status).toBe("REDEEMED");
    // The other batch carries on, so the school stays ACTIVE.
    expect(firestoreMock.getStore("organizationSubscriptions").get(other.subscriptionId)?.status).toBe("ACTIVE");
    expect(firestoreMock.getStore("organizations").get("org-1")?.status).toBe("ACTIVE");
    // Nothing new can be made for a paused batch.
    await expect(
      generateCodesForOrganization(
        { organizationId: "org-1", subscriptionId: renewal.subscriptionId, numberOfCodes: 1, batchName: "zeta", idempotencyKey: "idem-p-gen" },
        "super-admin"
      )
    ).rejects.toMatchObject({ code: "SUBSCRIPTION_INACTIVE" });
    expect(emailMocks.sendBatchAccessEmail.mock.calls[0][0]).toMatchObject({ paused: true, reason: "Installment 2 overdue" });

    const resumed = await resumeBatch("org-1", renewal.subscriptionId, "super-admin");
    expect(resumed).toMatchObject({ resumed: true, ended: false, studentsReactivated: 1 });
    expect(firestoreMock.getStore("organizationSubscriptions").get(renewal.subscriptionId)?.status).toBe("ACTIVE");
    expect((await refreshEntitlement("student-1")).status).toBe("ACTIVE");
    expect(firestoreMock.getStore("organizationActivationCodes").get("code-b")?.status).toBe("UNUSED");
    expect(emailMocks.sendBatchAccessEmail.mock.calls[1][0]).toMatchObject({ paused: false });

    const notices = Array.from(firestoreMock.getStore("organizationNotifications").values()).map((notice) => notice.type);
    expect(notices).toEqual(expect.arrayContaining(["BATCH_PAUSED", "BATCH_RESUMED"]));
  });

  it("does not pause an ended batch, and refuses to resume one that is not paused", async () => {
    const { pauseBatch, resumeBatch } = await import("../batchSubscriptionService");
    await expect(pauseBatch("org-1", "sub-old", null, "super-admin")).rejects.toMatchObject({ code: "BATCH_NOT_LIVE" });
    await expect(resumeBatch("org-1", "sub-old", "super-admin")).rejects.toMatchObject({ code: "BATCH_NOT_PAUSED" });
  });
});

describe("extra codes added to a class are billed", () => {
  beforeEach(() => {
    firestoreMock.reset();
    Object.values(emailMocks).forEach((mock) => mock.mockClear());
    seedSchoolWithEndedBatch();
  });

  it("extra codes paid on the spot: payment recorded with the charge, no installment, balance unchanged", async () => {
    const { createBatch, addSeatsToClass } = await import("../batchSubscriptionService");
    const { generateCodesForOrganization } = await import("../codeGenerationService");
    const { installmentViews } = await import("../paymentSchedule");
    const batch = await createBatch(
      "org-1",
      {
        ...window2027,
        classes: [{ batchName: "gamma", seatCount: 3 }],
        payment: {
          grossAmount: 9000,
          totalAmount: 9000,
          paidAmount: 0,
          installments: 2,
          installmentDueDates: ["2026-07-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z"],
        },
        idempotencyKey: "idem-paidnow",
      },
      "super-admin"
    );
    await generateCodesForOrganization({ organizationId: "org-1", numberOfCodes: 3, batchName: "gamma", idempotencyKey: "idem-paidnow-gen" }, "super-admin");
    emailMocks.sendBillEmail.mockClear();

    const result = await addSeatsToClass("org-1", batch.subscriptionId, "gamma", 2, "super-admin", {
      amount: 1400,
      paidNow: { method: "UPI", methodDetails: { transactionId: "UPI-77" } },
    });
    const stored = firestoreMock.getStore("organizationSubscriptions").get(batch.subscriptionId)?.payment as any;
    // Total up, paid up by the same amount: the balance and the installments are as they were.
    expect(stored).toMatchObject({ totalAmount: 10400, paidAmount: 1400, pendingAmount: 9000, upfrontAmount: 1400, installments: 2 });
    expect(stored.installmentPlan.map((item: any) => item.amount)).toEqual([4500, 4500]);
    expect(installmentViews(stored, { asOf: new Date("2026-06-01T00:00:00Z") }).map((v: any) => v.status)).toEqual(["UPCOMING", "UPCOMING"]);
    expect(stored.transactions.at(-1)).toMatchObject({ amount: 1400, method: "UPI", billNumber: result.bill!.billNumber });
    expect(stored.bills.at(-1)).toMatchObject({ kind: "ADJUSTMENT", reason: "EXTRA_CODES", paidToDate: 1400, balance: 9000 });
    // One email: the updated bill, saying it was paid.
    expect(emailMocks.sendBillEmail).toHaveBeenCalledTimes(1);
    expect(emailMocks.sendBillEmail.mock.calls[0][0]).toMatchObject({ kind: "EXTRA_CODES", change: { amount: 1400, paid: { mode: "UPI", reference: "UPI-77" } } });
  });

  it("adds a bill line and installment, issues a new bill, and leaves the first invoice as it was", async () => {
    const { createBatch, addSeatsToClass } = await import("../batchSubscriptionService");
    const { generateCodesForOrganization } = await import("../codeGenerationService");
    const { renderBillHtml } = await import("../billService");

    const batch = await createBatch(
      "org-1",
      {
        ...window2027,
        classes: [{ batchName: "gamma", seatCount: 3 }],
        payment: {
          amountPerCode: 100,
          grossAmount: 3600,
          totalAmount: 3600,
          paidAmount: 3600,
          installments: 1,
          method: "CASH",
          installmentDueDates: ["2026-07-01T00:00:00.000Z"],
        },
        idempotencyKey: "idem-extra",
      },
      "super-admin"
    );
    await generateCodesForOrganization({ organizationId: "org-1", numberOfCodes: 3, batchName: "gamma", idempotencyKey: "idem-extra-gen" }, "super-admin");
    emailMocks.sendBillEmail.mockClear();

    const result = await addSeatsToClass("org-1", batch.subscriptionId, "gamma", 2, "super-admin", {
      amount: 1400,
      dueDate: "2027-03-01T00:00:00.000Z",
      ratePerCodePerMonth: 100,
      months: 7,
    });

    expect(result).toMatchObject({ seatCount: 5, pendingSeats: 2 });
    expect(result.bill).toMatchObject({ amount: 1400, totalAmount: 5000, pendingAmount: 1400 });

    const stored = firestoreMock.getStore("organizationSubscriptions").get(batch.subscriptionId)?.payment as any;
    expect(stored).toMatchObject({ totalAmount: 5000, paidAmount: 3600, pendingAmount: 1400, status: "INSTALLMENTS", installments: 2 });
    const added = stored.lineItems.at(-1);
    expect(added).toMatchObject({ item: "gamma — 2 extra codes", quantity: 2, rate: 100, months: 7, amount: 1400, addedOnBill: result.bill!.billNumber });
    expect(stored.installmentPlan.at(-1)).toMatchObject({ number: 2, amount: 1400, addedOnBill: result.bill!.billNumber });
    expect(stored.bills.at(-1)).toMatchObject({ kind: "ADJUSTMENT", totalAtBill: 5000, balance: 1400 });

    // The new bill is emailed and the school is told.
    expect(emailMocks.sendBillEmail).toHaveBeenCalledTimes(1);
    expect(emailMocks.sendBillEmail.mock.calls[0][0].billNumber).toBe(result.bill!.billNumber);

    const recipient = { organizationId: "org-1", name: "Moonstar", contactName: "", contactEmail: "", contactPhone: "" };
    const original = renderBillHtml(recipient, stored, { logoSrc: null });
    const updated = renderBillHtml(recipient, stored, { logoSrc: null, billNumber: result.bill!.billNumber });
    // The first invoice still shows its own line and total only.
    expect(original).not.toContain("extra codes");
    expect(original).toContain("₹3,600.00");
    expect(original).not.toContain("₹5,000.00");
    // The new bill shows the extra line, the new total and what changed.
    expect(updated).toContain("gamma — 2 extra codes");
    expect(updated).toContain("₹5,000.00");
    expect(updated).toContain("2 extra codes added to gamma");
  });

  it("adds free codes without touching the bill, and refuses a charge for a batch with no bill", async () => {
    const { createBatch, addSeatsToClass } = await import("../batchSubscriptionService");
    const batch = await createBatch("org-1", { ...window2027, classes: [{ batchName: "gamma", seatCount: 3 }], idempotencyKey: "idem-free" }, "super-admin");

    await expect(
      addSeatsToClass("org-1", batch.subscriptionId, "gamma", 1, "super-admin", { amount: 500, dueDate: "2027-03-01T00:00:00.000Z" })
    ).rejects.toMatchObject({ code: "BILL_NOT_FOUND" });
    // The refused charge changed nothing.
    expect(firestoreMock.getStore("organizationSubscriptions").get(batch.subscriptionId)?.seatLimit).toBe(3);

    const free = await addSeatsToClass("org-1", batch.subscriptionId, "gamma", 1, "super-admin", { amount: 0 });
    expect(free).toMatchObject({ seatCount: 4, bill: null });
    expect(emailMocks.sendBillEmail).not.toHaveBeenCalled();
  });
});

describe("installment amounts chosen by hand", () => {
  beforeEach(() => {
    firestoreMock.reset();
    Object.values(emailMocks).forEach((mock) => mock.mockClear());
    seedSchoolWithEndedBatch();
  });

  const dates = ["2026-07-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"];

  it("keeps the admin's amounts, and refuses amounts that do not add up to the total", async () => {
    const { createBatch } = await import("../batchSubscriptionService");
    const payment = { grossAmount: 9000, totalAmount: 9000, paidAmount: 0, installments: 3, installmentDueDates: dates };

    await expect(
      createBatch(
        "org-1",
        { ...window2027, classes: [{ batchName: "gamma", seatCount: 3 }], payment: { ...payment, installmentAmounts: [5000, 2000, 1000] }, idempotencyKey: "idem-amt-bad" },
        "super-admin"
      )
    ).rejects.toMatchObject({ code: "INSTALLMENT_SUM_MISMATCH" });

    const batch = await createBatch(
      "org-1",
      { ...window2027, classes: [{ batchName: "gamma", seatCount: 3 }], payment: { ...payment, installmentAmounts: [5000, 2500, 1500] }, idempotencyKey: "idem-amt-ok" },
      "super-admin"
    );
    const stored = firestoreMock.getStore("organizationSubscriptions").get(batch.subscriptionId)?.payment as any;
    expect(stored.installmentPlan.map((item: any) => item.amount)).toEqual([5000, 2500, 1500]);
  });

  it("lets the admin change amounts later, still adding up to the total", async () => {
    const { createBatch } = await import("../batchSubscriptionService");
    const { updateInstallmentDueDates } = await import("../paymentService");
    const batch = await createBatch(
      "org-1",
      {
        ...window2027,
        classes: [{ batchName: "gamma", seatCount: 3 }],
        payment: { grossAmount: 9000, totalAmount: 9000, paidAmount: 0, installments: 3, installmentDueDates: dates },
        idempotencyKey: "idem-amt-later",
      },
      "super-admin"
    );

    await expect(updateInstallmentDueDates("org-1", batch.subscriptionId, dates, "super-admin", [1000, 1000, 1000])).rejects.toMatchObject({
      code: "INSTALLMENT_SUM_MISMATCH",
    });
    emailMocks.sendBillEmail.mockClear();
    const changed = await updateInstallmentDueDates("org-1", batch.subscriptionId, dates, "super-admin", [2000, 3000, 4000]);
    const stored = firestoreMock.getStore("organizationSubscriptions").get(batch.subscriptionId)?.payment as any;
    expect(stored.installmentPlan.map((item: any) => item.amount)).toEqual([2000, 3000, 4000]);

    // A changed schedule issues a new bill that replaces the earlier ones, and emails it.
    expect(changed.billNumber).toBe(`${stored.billNumber}-2`);
    expect(stored.bills.at(-1)).toMatchObject({ kind: "ADJUSTMENT", reason: "SCHEDULE_CHANGE", totalAtBill: 9000, balance: 9000 });
    expect(emailMocks.sendBillEmail).toHaveBeenCalledTimes(1);
    expect(emailMocks.sendBillEmail.mock.calls[0][0]).toMatchObject({ kind: "SCHEDULE_CHANGE", billNumber: changed.billNumber });
    expect(emailMocks.sendBillEmail.mock.calls[0][0].schedule.map((item: any) => item.amount)).toEqual([2000, 3000, 4000]);

    // Dates only: amounts stay as they are, and nothing changed, so no new bill.
    const unchanged = await updateInstallmentDueDates("org-1", batch.subscriptionId, dates, "super-admin");
    const after = firestoreMock.getStore("organizationSubscriptions").get(batch.subscriptionId)?.payment as any;
    expect(after.installmentPlan.map((item: any) => item.amount)).toEqual([2000, 3000, 4000]);
    expect(unchanged.billNumber).toBeNull();
    expect(after.bills).toHaveLength(2);
    expect(emailMocks.sendBillEmail).toHaveBeenCalledTimes(1);
  });
});
