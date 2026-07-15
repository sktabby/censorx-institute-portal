import { Router } from "express";
import { requireFirebaseAuth } from "../middleware/requireFirebaseAuth";
import { redemptionRateLimiter } from "../middleware/rateLimiters";
import { asyncHandler } from "../middleware/asyncHandler";
import { validateBody } from "../middleware/validate";
import { redeemLicenseSchema } from "../schemas/redemptionSchema";
import * as redemptionController from "../controllers/organizationRedemptionController";

/**
 * Android-compatible routes. These are the endpoints the CensorX Android
 * app will call directly (or via the equivalent Firebase Functions URL
 * if this logic is later moved). Firebase App Check support is wired
 * via the appCheck middleware hook — see middleware note in app.ts.
 */
const router = Router();

router.post(
  "/organization/licenses/redeem",
  redemptionRateLimiter,
  requireFirebaseAuth,
  validateBody(redeemLicenseSchema),
  asyncHandler(redemptionController.redeem)
);

router.get("/organization/entitlement", requireFirebaseAuth, asyncHandler(redemptionController.getEntitlement));
router.post("/organization/entitlement/refresh", requireFirebaseAuth, asyncHandler(redemptionController.refreshEntitlement));

export default router;
