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

  function makeQuery(collectionName: string, filters: Array<[string, unknown]> = []): any {
    return {
      where: (field: string, _op: string, value: unknown) => makeQuery(collectionName, [...filters, [field, value]]),
      get: async () => {
        const docs = Array.from(getStore(collectionName).entries())
          .filter(([, data]) => filters.every(([field, value]) => (data[field] ?? null) === value))
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
        update: (ref: any, data: StoredDoc) => ops.push(() => applyWrite(ref, data, true)),
        set: (ref: any, data: StoredDoc, o?: { merge?: boolean }) => ops.push(() => applyWrite(ref, data, o?.merge)),
        commit: async () => ops.forEach((op) => op()),
      };
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

const emailMocks = vi.hoisted(() => ({
  sendBatchEndingSoonEmail: vi.fn(),
  sendBatchEndedEmail: vi.fn(),
  sendRenewalOfferEmail: vi.fn(),
}));
vi.mock("../emailService", () => emailMocks);

const ts = (iso: string) => ({ toMillis: () => new Date(iso).getTime(), toDate: () => new Date(iso) });
const NOW = new Date("2026-06-10T03:15:00.000Z");

function seedSubscription(id: string, expiresAt: string, extra: StoredDoc = {}) {
  firestoreMock.seed("organizationSubscriptions", id, {
    subscriptionId: id,
    organizationId: "org-1",
    status: "ACTIVE",
    planDuration: "YEARLY",
    startAt: ts("2025-06-01T00:00:00.000Z"),
    expiresAt: ts(expiresAt),
    createdAt: ts("2025-06-01T00:00:00.000Z"),
    seatLimit: 5,
    batchNumber: 1,
    batchLabel: "Batch 1",
    ...extra,
  });
}

describe("runBatchNotifications", () => {
  beforeEach(() => {
    firestoreMock.reset();
    emailMocks.sendBatchEndingSoonEmail.mockReset();
    emailMocks.sendBatchEndedEmail.mockReset();
    firestoreMock.seed("organizations", "org-1", {
      organizationId: "org-1",
      name: "Moonstar Academy",
      contactEmail: "admin@moonstar.test",
      status: "ACTIVE",
    });
    firestoreMock.seed("organizationBatches", "rec-a", {
      batchId: "rec-a",
      organizationId: "org-1",
      batchName: "Class 5A",
      subscriptionId: "sub-soon",
      seatCount: 5,
      status: "GENERATED",
    });
  });

  it("warns once, 3 days before a batch ends, by email and in the portal", async () => {
    const { runBatchNotifications } = await import("../notificationService");
    seedSubscription("sub-soon", "2026-06-12T00:00:00.000Z");
    seedSubscription("sub-later", "2026-09-01T00:00:00.000Z");

    const first = await runBatchNotifications({ now: NOW, reminderDays: 3 });
    expect(first.remindersCreated).toBe(1);
    expect(first.reminderEmailsSent).toBe(1);
    expect(first.endedNoticesCreated).toBe(0);

    expect(emailMocks.sendBatchEndingSoonEmail).toHaveBeenCalledTimes(1);
    expect(emailMocks.sendBatchEndingSoonEmail.mock.calls[0][0]).toMatchObject({
      to: "admin@moonstar.test",
      batchLabel: "Batch 1",
      classNames: ["Class 5A"],
      daysLeft: 2,
    });
    const notices = Array.from(firestoreMock.getStore("organizationNotifications").values());
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ organizationId: "org-1", type: "BATCH_ENDING_SOON", subscriptionId: "sub-soon", readAt: null });

    const marked = firestoreMock.getStore("organizationSubscriptions").get("sub-soon");
    expect(marked?.renewalReminderSentAt).toBeTruthy();
    expect(marked?.renewalReminderEmailedAt).toBeTruthy();

    // The next day: nothing is repeated.
    const second = await runBatchNotifications({ now: new Date("2026-06-11T03:15:00.000Z"), reminderDays: 3 });
    expect(second.remindersCreated).toBe(0);
    expect(second.reminderEmailsSent).toBe(0);
    expect(emailMocks.sendBatchEndingSoonEmail).toHaveBeenCalledTimes(1);
  });

  it("retries only the email when the mail server was down", async () => {
    const { runBatchNotifications } = await import("../notificationService");
    seedSubscription("sub-soon", "2026-06-12T00:00:00.000Z");
    emailMocks.sendBatchEndingSoonEmail.mockRejectedValueOnce(new Error("smtp down"));

    const first = await runBatchNotifications({ now: NOW, reminderDays: 3 });
    expect(first.remindersCreated).toBe(1);
    expect(first.emailFailures).toBe(1);
    expect(firestoreMock.getStore("organizationSubscriptions").get("sub-soon")?.renewalReminderEmailedAt).toBeUndefined();

    const second = await runBatchNotifications({ now: new Date("2026-06-11T03:15:00.000Z"), reminderDays: 3 });
    expect(second.remindersCreated).toBe(0);
    expect(second.reminderEmailsSent).toBe(1);
    expect(firestoreMock.getStore("organizationNotifications").size).toBe(1);
  });

  it("tells the school once when a batch has ended, with our contact details, and skips old history", async () => {
    const { runBatchNotifications } = await import("../notificationService");
    seedSubscription("sub-soon", "2026-06-09T00:00:00.000Z"); // ended yesterday
    seedSubscription("sub-ancient", "2025-01-01T00:00:00.000Z"); // ended long ago: no retro notice
    seedSubscription("sub-renewed", "2026-06-09T00:00:00.000Z", { status: "RENEWED" }); // superseded: nothing

    const result = await runBatchNotifications({ now: NOW, reminderDays: 3 });
    expect(result.endedNoticesCreated).toBe(1);
    expect(result.endedEmailsSent).toBe(1);
    expect(result.remindersCreated).toBe(0);
    expect(emailMocks.sendBatchEndedEmail).toHaveBeenCalledTimes(1);
    expect(emailMocks.sendBatchEndedEmail.mock.calls[0][0]).toMatchObject({ batchLabel: "Batch 1", classNames: ["Class 5A"] });

    const notices = Array.from(firestoreMock.getStore("organizationNotifications").values());
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ type: "BATCH_ENDED", subscriptionId: "sub-soon" });

    const again = await runBatchNotifications({ now: new Date("2026-06-11T03:15:00.000Z"), reminderDays: 3 });
    expect(again.endedNoticesCreated).toBe(0);
    expect(again.endedEmailsSent).toBe(0);
  });

  it("after the ended email, sends a renewal email every 4 days until renewed or stopped", async () => {
    const { runBatchNotifications } = await import("../notificationService");
    emailMocks.sendRenewalOfferEmail.mockReset();
    seedSubscription("sub-soon", "2026-06-09T00:00:00.000Z");
    const day = (iso: string) => runBatchNotifications({ now: new Date(iso), reminderDays: 3 });
    const offers = () => emailMocks.sendRenewalOfferEmail.mock.calls.length;

    await day("2026-06-10T03:15:00.000Z"); // ended email
    expect(offers()).toBe(0);
    await day("2026-06-13T03:15:00.000Z"); // 3 days: not yet
    expect(offers()).toBe(0);
    await day("2026-06-14T03:15:00.000Z"); // 4 days: renewal email 1
    expect(offers()).toBe(1);
    expect(emailMocks.sendRenewalOfferEmail.mock.calls[0][0]).toMatchObject({ batchLabel: "Batch 1", offerNumber: 1, classNames: ["Class 5A"] });
    await day("2026-06-16T03:15:00.000Z"); // 2 days later: nothing
    expect(offers()).toBe(1);
    await day("2026-06-18T03:15:00.000Z"); // 4 days later: email 2
    expect(offers()).toBe(2);

    // Stopped by the admin: nothing more.
    const sub = firestoreMock.getStore("organizationSubscriptions").get("sub-soon")!;
    firestoreMock.seed("organizationSubscriptions", "sub-soon", { ...sub, renewalEmailsStoppedAt: ts("2026-06-19T00:00:00.000Z") });
    await day("2026-06-26T03:15:00.000Z");
    expect(offers()).toBe(2);
    // Renewed (period is RENEWED): nothing either, even if restarted.
    firestoreMock.seed("organizationSubscriptions", "sub-soon", { ...sub, renewalEmailsStoppedAt: null, status: "RENEWED" });
    await day("2026-07-04T03:15:00.000Z");
    expect(offers()).toBe(2);
  });

  it("sends nothing for suspended or archived schools", async () => {
    const { runBatchNotifications } = await import("../notificationService");
    firestoreMock.seed("organizations", "org-1", { organizationId: "org-1", name: "Moonstar", contactEmail: "a@b.c", status: "SUSPENDED" });
    seedSubscription("sub-soon", "2026-06-12T00:00:00.000Z");

    const result = await runBatchNotifications({ now: NOW, reminderDays: 3 });
    expect(result.remindersCreated).toBe(0);
    expect(emailMocks.sendBatchEndingSoonEmail).not.toHaveBeenCalled();
  });

  it("lists, counts and marks notices read for the school portal", async () => {
    const { createNotification, listNotifications, markNotificationsRead, countUnreadNotifications } = await import("../notificationService");
    await createNotification({ organizationId: "org-1", type: "BATCH_CREATED", title: "Batch 2 set up", message: "..." });
    await createNotification({ organizationId: "org-1", type: "CODES_READY", title: "Codes ready", message: "..." });
    await createNotification({ organizationId: "org-2", type: "CODES_READY", title: "Other school", message: "..." });

    const list = await listNotifications("org-1");
    expect(list.total).toBe(2);
    expect(list.unreadCount).toBe(2);
    expect(await countUnreadNotifications("org-1")).toBe(2);

    expect(await markNotificationsRead("org-1", [list.items[0].notificationId])).toBe(1);
    expect(await countUnreadNotifications("org-1")).toBe(1);
    expect(await markNotificationsRead("org-1")).toBe(1);
    expect(await countUnreadNotifications("org-1")).toBe(0);
    expect(await countUnreadNotifications("org-2")).toBe(1);
  });
});
