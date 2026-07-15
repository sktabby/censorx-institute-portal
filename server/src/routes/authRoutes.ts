import { Router } from "express";
import { requireFirebaseAuth } from "../middleware/requireFirebaseAuth";
import { requirePortalUser } from "../middleware/requirePortalUser";
import { asyncHandler } from "../middleware/asyncHandler";
import { clearMustChangePassword, getMe } from "../controllers/authController";

const router = Router();

router.get("/auth/me", requireFirebaseAuth, requirePortalUser, asyncHandler(getMe));
router.post("/auth/clear-must-change-password", requireFirebaseAuth, requirePortalUser, asyncHandler(clearMustChangePassword));

export default router;
