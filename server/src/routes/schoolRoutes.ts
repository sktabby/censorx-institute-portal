import { Router } from "express";
import { requireFirebaseAuth, requireRecentLogin } from "../middleware/requireFirebaseAuth";
import { requirePortalUser, requireSchoolAdmin } from "../middleware/requirePortalUser";
import { adminRateLimiter } from "../middleware/rateLimiters";
import { asyncHandler } from "../middleware/asyncHandler";
import { validateBody, validateParams, validateQuery } from "../middleware/validate";
import {
  billQuerySchema,
  codeExportQuerySchema,
  codeListQuerySchema,
  markNotificationsReadSchema,
  notificationListQuerySchema,
  studentListQuerySchema,
} from "../schemas/organizationSchemas";
import { z } from "zod";
import * as schoolController from "../controllers/schoolController";

const router = Router();

router.use("/school", requireFirebaseAuth, requirePortalUser, requireSchoolAdmin, adminRateLimiter);

router.get("/school/dashboard", asyncHandler(schoolController.getDashboard));
router.get(
  "/school/codes",
  validateQuery(codeListQuerySchema.omit({ organizationId: true })),
  asyncHandler(schoolController.getCodes)
);
// Declared before /school/codes/:anything would be, and requires a fresh password entry.
router.get(
  "/school/codes/export",
  requireRecentLogin(15),
  validateQuery(codeExportQuerySchema),
  asyncHandler(schoolController.exportCodes)
);
router.get("/school/students", validateQuery(studentListQuerySchema), asyncHandler(schoolController.getStudents));
router.get("/school/subscription", asyncHandler(schoolController.getSubscription));
router.get("/school/batches", asyncHandler(schoolController.getBatches));
router.get(
  "/school/batches/:subscriptionId/bill",
  validateParams(z.object({ subscriptionId: z.string().min(1) })),
  validateQuery(billQuerySchema),
  asyncHandler(schoolController.getBatchBill)
);
router.get(
  "/school/batches/:subscriptionId/bill/pdf",
  validateParams(z.object({ subscriptionId: z.string().min(1) })),
  validateQuery(billQuerySchema),
  asyncHandler(schoolController.getBatchBillPdf)
);
router.get("/school/notifications", validateQuery(notificationListQuerySchema), asyncHandler(schoolController.getNotifications));
router.post(
  "/school/notifications/read",
  validateBody(markNotificationsReadSchema),
  asyncHandler(schoolController.readNotifications)
);

export default router;
