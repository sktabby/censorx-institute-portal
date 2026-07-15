import { Router } from "express";
import { requireFirebaseAuth } from "../middleware/requireFirebaseAuth";
import { requirePortalUser, requireSchoolAdmin } from "../middleware/requirePortalUser";
import { adminRateLimiter } from "../middleware/rateLimiters";
import { asyncHandler } from "../middleware/asyncHandler";
import { validateQuery } from "../middleware/validate";
import { codeListQuerySchema, studentListQuerySchema } from "../schemas/organizationSchemas";
import * as schoolController from "../controllers/schoolController";

const router = Router();

router.use("/school", requireFirebaseAuth, requirePortalUser, requireSchoolAdmin, adminRateLimiter);

router.get("/school/dashboard", asyncHandler(schoolController.getDashboard));
router.get(
  "/school/codes",
  validateQuery(codeListQuerySchema.omit({ organizationId: true, batchName: true })),
  asyncHandler(schoolController.getCodes)
);
router.get("/school/students", validateQuery(studentListQuerySchema), asyncHandler(schoolController.getStudents));
router.get("/school/subscription", asyncHandler(schoolController.getSubscription));

export default router;
