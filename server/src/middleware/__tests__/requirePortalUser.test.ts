import { describe, it, expect, vi } from "vitest";

process.env.ORG_CODE_PEPPER = "a-very-long-test-pepper-value-1234567890";
process.env.CLIENT_ORIGINS = "http://localhost:5173";
process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/fake-service-account.json";

vi.mock("../../repositories/portalUserRepository", () => ({
  getPortalUser: vi.fn(),
  touchLastLogin: vi.fn(),
}));

describe("requireSchoolScope", () => {
  it("allows SUPER_ADMIN to access any organization", async () => {
    const { requireSchoolScope } = await import("../requirePortalUser");
    const req: any = { portalUser: { role: "SUPER_ADMIN", organizationId: null } };
    expect(() => requireSchoolScope("some-other-org", req)).not.toThrow();
  });

  it("allows SCHOOL_ADMIN to access their own organization", async () => {
    const { requireSchoolScope } = await import("../requirePortalUser");
    const req: any = { portalUser: { role: "SCHOOL_ADMIN", organizationId: "org-1" } };
    expect(() => requireSchoolScope("org-1", req)).not.toThrow();
  });

  it("blocks SCHOOL_ADMIN from accessing a different organization", async () => {
    const { requireSchoolScope } = await import("../requirePortalUser");
    const { ApiError } = await import("../errorHandler");
    const req: any = { portalUser: { role: "SCHOOL_ADMIN", organizationId: "org-1" } };
    expect(() => requireSchoolScope("org-2", req)).toThrow(ApiError);
  });
});
