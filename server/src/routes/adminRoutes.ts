import { Router } from "express";
import { requireFirebaseAuth } from "../middleware/requireFirebaseAuth";
import { requirePortalUser, requireSuperAdmin } from "../middleware/requirePortalUser";
import { adminRateLimiter } from "../middleware/rateLimiters";
import { asyncHandler } from "../middleware/asyncHandler";
import { validateBody, validateParams, validateQuery } from "../middleware/validate";
import {
  batchParamSchema,
  codeListQuerySchema,
  createOrganizationSchema,
  deleteBatchSchema,
  orgIdParamSchema,
  licenseIdParamSchema,
  organizationListQuerySchema,
  renewSubscriptionSchema,
  extendSubscriptionSchema,
  increaseSeatsSchema,
  generateCodesSchema,
  licenseListQuerySchema,
  revokeLicenseSchema,
  replaceLicenseSchema,
} from "../schemas/organizationSchemas";
import * as adminController from "../controllers/adminController";

const router = Router();

router.use("/admin", requireFirebaseAuth, requirePortalUser, requireSuperAdmin, adminRateLimiter);

router.get("/admin/dashboard", asyncHandler(adminController.getDashboard));
router.get("/admin/organizations", validateQuery(organizationListQuerySchema), asyncHandler(adminController.listOrganizations));
router.post("/admin/organizations", validateBody(createOrganizationSchema), asyncHandler(adminController.createOrganization));
router.get("/admin/organizations/:organizationId", validateParams(orgIdParamSchema), asyncHandler(adminController.getOrganizationDetail));
router.patch("/admin/organizations/:organizationId", validateParams(orgIdParamSchema), asyncHandler(adminController.getOrganizationDetail));
router.delete("/admin/organizations/:organizationId", validateParams(orgIdParamSchema), asyncHandler(adminController.deleteOrganization));

router.post("/admin/organizations/:organizationId/suspend", validateParams(orgIdParamSchema), asyncHandler(adminController.suspendOrganization));
router.post("/admin/organizations/:organizationId/reactivate", validateParams(orgIdParamSchema), asyncHandler(adminController.reactivateOrganization));
router.post("/admin/organizations/:organizationId/cancel", validateParams(orgIdParamSchema), asyncHandler(adminController.cancelOrganization));

router.post(
  "/admin/organizations/:organizationId/renew",
  validateParams(orgIdParamSchema),
  validateBody(renewSubscriptionSchema),
  asyncHandler(adminController.renewOrganization)
);
router.post(
  "/admin/organizations/:organizationId/extend",
  validateParams(orgIdParamSchema),
  validateBody(extendSubscriptionSchema),
  asyncHandler(adminController.extendOrganization)
);
router.post(
  "/admin/organizations/:organizationId/seats/increase",
  validateParams(orgIdParamSchema),
  validateBody(increaseSeatsSchema),
  asyncHandler(adminController.increaseSeats)
);

router.get(
  "/admin/organizations/:organizationId/licenses",
  validateParams(orgIdParamSchema),
  validateQuery(licenseListQuerySchema),
  asyncHandler(adminController.listLicenses)
);
router.get("/admin/licenses", validateQuery(codeListQuerySchema), asyncHandler(adminController.listAllCodes));
router.post(
  "/admin/organizations/:organizationId/licenses/generate",
  validateParams(orgIdParamSchema),
  validateBody(generateCodesSchema),
  asyncHandler(adminController.generateLicenses)
);
router.delete("/admin/licenses/:licenseId", validateParams(licenseIdParamSchema), asyncHandler(adminController.deleteLicense));
router.post(
  "/admin/licenses/:licenseId/revoke",
  validateParams(licenseIdParamSchema),
  validateBody(revokeLicenseSchema),
  asyncHandler(adminController.revokeLicense)
);
router.post(
  "/admin/licenses/:licenseId/replace",
  validateParams(licenseIdParamSchema),
  validateBody(replaceLicenseSchema),
  asyncHandler(adminController.replaceLicense)
);
router.post(
  "/admin/organizations/:organizationId/codes/batches/:batchName/delete",
  validateParams(batchParamSchema),
  validateBody(deleteBatchSchema),
  asyncHandler(adminController.deleteBatch)
);

router.get("/admin/organizations/:organizationId/students", validateParams(orgIdParamSchema), asyncHandler(adminController.listStudents));

export default router;
