import { describe, expect, it, vi } from "vitest";

process.env.ORG_CODE_PEPPER = "a-very-long-test-pepper-value-1234567890";
process.env.CLIENT_ORIGINS = "http://localhost:5173";
process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/fake-service-account.json";

const createUser = vi.fn();
const deleteDoc = vi.fn().mockResolvedValue(undefined);

vi.mock("../../config/firebaseAdmin", () => ({
  adminAuth: {
    createUser,
    deleteUser: vi.fn(),
  },
}));

vi.mock("../../repositories/firestoreRepository", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        delete: deleteDoc,
      })),
    })),
  },
  newDocId: vi.fn(() => "org-repro"),
  serverTimestamp: vi.fn(() => "SERVER_TIMESTAMP"),
}));

vi.mock("../../repositories/organizationRepository", () => ({
  getOrganization: vi.fn(),
  getActiveSubscription: vi.fn(),
}));

vi.mock("../../repositories/auditLogRepository", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("../emailService", () => ({
  sendSchoolAdminWelcomeEmail: vi.fn(),
}));

vi.mock("../../config/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

describe("organizationService.createOrganization", () => {
  it("rejects duplicate Firebase Auth emails as an ApiError", async () => {
    const duplicateEmailError = Object.assign(new Error("email already exists"), {
      code: "auth/email-already-exists",
    });
    createUser.mockRejectedValueOnce(duplicateEmailError);

    const { ApiError } = await import("../../middleware/errorHandler");
    const { createOrganization } = await import("../organizationService");

    let caught: unknown;
    try {
      await createOrganization(
        {
          name: "Duplicate Email Repro School",
          contactName: "Manual Repro",
          contactEmail: "existing@example.com",
          contactPhone: "9999999999",
        },
        "actor-uid"
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({
      status: 409,
      code: "SCHOOL_ADMIN_EMAIL_EXISTS",
    });
  });
});
