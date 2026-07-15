import { Router } from "express";
import { health, createInstituteEnquiry } from "../controllers/publicController";
import { validateBody } from "../middleware/validate";
import { instituteEnquirySchema } from "../schemas/enquirySchema";
import { publicRateLimiter } from "../middleware/rateLimiters";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();

router.get("/health", asyncHandler(health));
router.post("/public/institute-enquiries", publicRateLimiter, validateBody(instituteEnquirySchema), asyncHandler(createInstituteEnquiry));

export default router;
