import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/requireFirebaseAuth";
import * as redemptionService from "../services/redemptionService";
import { ok } from "../utils/apiResponse";
import { ApiError } from "../middleware/errorHandler";

export async function redeem(req: AuthenticatedRequest, res: Response) {
  if (!req.firebaseUid) throw new ApiError(401, "UNAUTHENTICATED", "Missing authentication context.");
  const result = await redemptionService.redeemActivationCode(req.body, req.firebaseUid);
  return ok(res, result);
}

export async function getEntitlement(req: AuthenticatedRequest, res: Response) {
  if (!req.firebaseUid) throw new ApiError(401, "UNAUTHENTICATED", "Missing authentication context.");
  const entitlement = await redemptionService.getEntitlement(req.firebaseUid);
  return ok(res, entitlement);
}

export async function refreshEntitlement(req: AuthenticatedRequest, res: Response) {
  if (!req.firebaseUid) throw new ApiError(401, "UNAUTHENTICATED", "Missing authentication context.");
  const entitlement = await redemptionService.refreshEntitlement(req.firebaseUid);
  return ok(res, entitlement);
}
