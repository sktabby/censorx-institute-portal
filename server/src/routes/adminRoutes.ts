import { Router } from "express";
import { requireFirebaseAuth } from "../middleware/requireFirebaseAuth";
import { requirePortalUser, requireSuperAdmin } from "../middleware/requirePortalUser";
import { adminRateLimiter } from "../middleware/rateLimiters";
import { asyncHandler } from "../middleware/asyncHandler";
import { validateBody, validateParams, validateQuery } from "../middleware/validate";
import {
  addClassSeatsSchema,
  billQuerySchema,
  installmentDatesSchema,
  pauseBatchSchema,
  renewalEmailsSchema,
  recordPaymentSchema,
  batchParamSchema,
  classParamSchema,
  codeExportQuerySchema,
  createdCodesWorkbookSchema,
  studentIdFileSchema,
  studentIdCheckSchema,
  codeListQuerySchema,
  createBatchSchema,
  createOrganizationSchema,
  deleteBatchSchema,
  orgIdParamSchema,
  licenseIdParamSchema,
  organizationListQuerySchema,
  renewBatchSchema,
  renewSubscriptionSchema,
  subscriptionIdParamSchema,
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
// Legacy school-level bill (schools billed before batches existed).
router.get("/admin/organizations/:organizationId/bill", validateParams(orgIdParamSchema), asyncHandler(adminController.getOrganizationBill));
router.get("/admin/organizations/:organizationId/bill/pdf", validateParams(orgIdParamSchema), asyncHandler(adminController.getOrganizationBillPdf));
router.post("/admin/organizations/:organizationId/bill/send", validateParams(orgIdParamSchema), asyncHandler(adminController.sendOrganizationBill));

// ---------------------------------------------------------------------------
// Batches: each one an independent subscription with its own dates, seats,
// payment and classes. Codes are never generated here — see Create Codes.
// ---------------------------------------------------------------------------
router.get(
  "/admin/organizations/:organizationId/subscription-batches",
  validateParams(orgIdParamSchema),
  asyncHandler(adminController.listBatchSubscriptions)
);
router.post(
  "/admin/organizations/:organizationId/subscription-batches",
  validateParams(orgIdParamSchema),
  validateBody(createBatchSchema),
  asyncHandler(adminController.createBatch)
);
router.post(
  "/admin/organizations/:organizationId/subscription-batches/:subscriptionId/renew",
  validateParams(subscriptionIdParamSchema),
  validateBody(renewBatchSchema),
  asyncHandler(adminController.renewBatch)
);
router.post(
  "/admin/organizations/:organizationId/subscription-batches/:subscriptionId/cancel",
  validateParams(subscriptionIdParamSchema),
  asyncHandler(adminController.cancelBatch)
);
router.post(
  "/admin/organizations/:organizationId/subscription-batches/:subscriptionId/extend",
  validateParams(subscriptionIdParamSchema),
  validateBody(extendSubscriptionSchema),
  asyncHandler(adminController.extendBatch)
);
router.post(
  "/admin/organizations/:organizationId/subscription-batches/:subscriptionId/classes/:batchName/add-seats",
  validateParams(classParamSchema),
  validateBody(addClassSeatsSchema),
  asyncHandler(adminController.addClassSeats)
);
router.get(
  "/admin/organizations/:organizationId/subscription-batches/:subscriptionId/bill",
  validateParams(subscriptionIdParamSchema),
  validateQuery(billQuerySchema),
  asyncHandler(adminController.getBatchBill)
);
router.get(
  "/admin/organizations/:organizationId/subscription-batches/:subscriptionId/bill/pdf",
  validateParams(subscriptionIdParamSchema),
  validateQuery(billQuerySchema),
  asyncHandler(adminController.getBatchBillPdf)
);
router.post(
  "/admin/organizations/:organizationId/subscription-batches/:subscriptionId/bill/send",
  validateParams(subscriptionIdParamSchema),
  validateQuery(billQuerySchema),
  asyncHandler(adminController.sendBatchBill)
);
router.post(
  "/admin/organizations/:organizationId/subscription-batches/:subscriptionId/payments",
  validateParams(subscriptionIdParamSchema),
  validateBody(recordPaymentSchema),
  asyncHandler(adminController.recordBatchPayment)
);
router.put(
  "/admin/organizations/:organizationId/subscription-batches/:subscriptionId/installments",
  validateParams(subscriptionIdParamSchema),
  validateBody(installmentDatesSchema),
  asyncHandler(adminController.updateInstallmentDates)
);
router.post(
  "/admin/organizations/:organizationId/subscription-batches/:subscriptionId/pause",
  validateParams(subscriptionIdParamSchema),
  validateBody(pauseBatchSchema),
  asyncHandler(adminController.pauseBatch)
);
router.post(
  "/admin/organizations/:organizationId/subscription-batches/:subscriptionId/resume",
  validateParams(subscriptionIdParamSchema),
  asyncHandler(adminController.resumeBatch)
);
router.post(
  "/admin/organizations/:organizationId/subscription-batches/:subscriptionId/renewal-emails",
  validateParams(subscriptionIdParamSchema),
  validateBody(renewalEmailsSchema),
  asyncHandler(adminController.setRenewalEmails)
);
// Create Codes: the codes just made as an Excel file, and reading a file of student IDs.
router.post("/admin/codes/workbook", validateBody(createdCodesWorkbookSchema), asyncHandler(adminController.createdCodesWorkbook));
router.post("/admin/student-ids/parse", validateBody(studentIdFileSchema), asyncHandler(adminController.parseStudentIdFile));
router.post(
  "/admin/organizations/:organizationId/student-ids/check",
  validateParams(orgIdParamSchema),
  validateBody(studentIdCheckSchema),
  asyncHandler(adminController.checkStudentIds)
);

router.get(
  "/admin/organizations/:organizationId/codes/export",
  validateParams(orgIdParamSchema),
  validateQuery(codeExportQuerySchema),
  asyncHandler(adminController.exportOrganizationCodes)
);

// Legacy school-level actions: each applies to the school's primary batch.
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
  "/admin/organizations/:organizationId/subscriptions",
  validateParams(orgIdParamSchema),
  asyncHandler(adminController.listSubscriptionHistory)
);
router.get(
  "/admin/organizations/:organizationId/batches",
  validateParams(orgIdParamSchema),
  asyncHandler(adminController.listOrganizationBatches)
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
