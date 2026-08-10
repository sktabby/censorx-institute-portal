import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

process.env.ORG_CODE_PEPPER = "a-very-long-test-pepper-value-1234567890";
process.env.CLIENT_ORIGINS = "http://localhost:5173";
process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/fake-service-account.json";

const middlewareCalls = vi.hoisted(() => ({
  superAdmin: vi.fn(),
  schoolAdmin: vi.fn(),
}));

vi.mock("../../middleware/requireFirebaseAuth", () => ({
  requireFirebaseAuth: (req: any, _res: any, next: any) => {
    req.firebaseUid = "school-admin-uid";
    next();
  },
}));

vi.mock("../../middleware/requirePortalUser", () => ({
  requirePortalUser: (req: any, _res: any, next: any) => {
    req.portalUser = {
      uid: "school-admin-uid",
      role: "SCHOOL_ADMIN",
      organizationId: "org-1",
      status: "ACTIVE",
    };
    next();
  },
  requireSchoolAdmin: (_req: any, _res: any, next: any) => {
    middlewareCalls.schoolAdmin();
    next();
  },
  requireSuperAdmin: (_req: any, res: any) => {
    middlewareCalls.superAdmin();
    res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Super admin required" } });
  },
  requireSchoolScope: vi.fn(),
}));

vi.mock("../../controllers/schoolController", () => ({
  getDashboard: (_req: any, res: any) => res.json({ success: true, data: { schoolName: "Moonstar" }, meta: {} }),
  getCodes: (_req: any, res: any) => res.json({ success: true, data: { items: [] }, meta: {} }),
  getStudents: (_req: any, res: any) => res.json({ success: true, data: [], meta: {} }),
  getSubscription: (_req: any, res: any) => res.json({ success: true, data: {}, meta: {} }),
}));

/**
 * This test only exercises the school routes, but building the app also wires
 * the admin router. Every admin handler is stubbed explicitly — importing the
 * real controller would pull in config/firebaseAdmin, which initialises the
 * Admin SDK at module load and would couple this route-access test to Firebase.
 * Adding an admin endpoint means adding it here too.
 */
vi.mock("../../controllers/adminController", () => ({
  getDashboard: vi.fn(),
  listOrganizations: vi.fn(),
  createOrganization: vi.fn(),
  getOrganizationDetail: vi.fn(),
  deleteOrganization: vi.fn(),
  suspendOrganization: vi.fn(),
  reactivateOrganization: vi.fn(),
  cancelOrganization: vi.fn(),
  renewOrganization: vi.fn(),
  extendOrganization: vi.fn(),
  increaseSeats: vi.fn(),
  listLicenses: vi.fn(),
  listAllCodes: vi.fn(),
  generateLicenses: vi.fn(),
  deleteLicense: vi.fn(),
  revokeLicense: vi.fn(),
  replaceLicense: vi.fn(),
  deleteBatch: vi.fn(),
  listStudents: vi.fn(),
  listOrganizationBatches: vi.fn(),
  renewOrganizationBatches: vi.fn(),
  listSubscriptionHistory: vi.fn(),
}));

vi.mock("../../controllers/publicController", () => ({
  health: (_req: any, res: any) => res.json({ success: true, data: { status: "healthy" }, meta: {} }),
  createInstituteEnquiry: vi.fn(),
}));

vi.mock("../../controllers/authController", () => ({
  getMe: vi.fn(),
  clearMustChangePassword: vi.fn(),
}));

vi.mock("../../controllers/organizationRedemptionController", () => ({
  redeem: vi.fn(),
  getEntitlement: vi.fn(),
  refreshEntitlement: vi.fn(),
}));

describe("school route access", () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
    middlewareCalls.superAdmin.mockClear();
    middlewareCalls.schoolAdmin.mockClear();
  });

  it("does not run requireSuperAdmin for school portal routes", async () => {
    const { createApp } = await import("../../app");
    server = createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP server address.");

    const dashboardResponse = await fetch(`http://127.0.0.1:${address.port}/api/v1/school/dashboard`, {
      headers: { Authorization: "Bearer test-token" },
    });
    const dashboardBody = (await dashboardResponse.json()) as { success: boolean };
    const codesResponse = await fetch(`http://127.0.0.1:${address.port}/api/v1/school/codes`, {
      headers: { Authorization: "Bearer test-token" },
    });
    const codesBody = (await codesResponse.json()) as { success: boolean };

    expect(dashboardResponse.status).toBe(200);
    expect(dashboardBody.success).toBe(true);
    expect(codesResponse.status).toBe(200);
    expect(codesBody.success).toBe(true);
    expect(middlewareCalls.schoolAdmin).toHaveBeenCalledTimes(2);
    expect(middlewareCalls.superAdmin).not.toHaveBeenCalled();
  });
});
