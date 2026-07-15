import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "./requireFirebaseAuth";
import { ApiError } from "./errorHandler";
import { getPortalUser } from "../repositories/portalUserRepository";
import type { PortalUser } from "../models/types";

export interface PortalRequest extends AuthenticatedRequest {
  portalUser?: PortalUser;
}

/**
 * Loads portalUsers/{uid} and enforces that the account exists and is
 * ACTIVE. Firestore portalUsers is the authoritative source of portal
 * access — custom claims are only ever a coarse, secondary check.
 */
export async function requirePortalUser(req: PortalRequest, _res: Response, next: NextFunction) {
  try {
    if (!req.firebaseUid) {
      throw new ApiError(401, "UNAUTHENTICATED", "Missing authentication context.");
    }

    const portalUser = await getPortalUser(req.firebaseUid);

    if (!portalUser) {
      throw new ApiError(403, "NOT_A_PORTAL_USER", "You do not have access to the CensorX Institute Portal.");
    }

    if (portalUser.status === "DISABLED") {
      throw new ApiError(403, "ACCOUNT_DISABLED", "Your portal access is currently disabled.");
    }

    req.portalUser = portalUser;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireSuperAdmin(req: PortalRequest, _res: Response, next: NextFunction) {
  if (req.portalUser?.role !== "SUPER_ADMIN") {
    return next(new ApiError(403, "FORBIDDEN", "This action requires Super Admin access."));
  }
  next();
}

export function requireSchoolAdmin(req: PortalRequest, _res: Response, next: NextFunction) {
  if (req.portalUser?.role !== "SCHOOL_ADMIN" || !req.portalUser.organizationId) {
    return next(new ApiError(403, "FORBIDDEN", "This action requires School Admin access."));
  }
  next();
}

/**
 * Ensures a School Admin can only access resources scoped to their own
 * organization. organizationId ALWAYS comes from portalUser, never from
 * the request body/params/query.
 */
export function requireSchoolScope(resourceOrgId: string, req: PortalRequest) {
  if (req.portalUser?.role === "SUPER_ADMIN") return; // Super Admin bypasses scoping
  if (req.portalUser?.organizationId !== resourceOrgId) {
    throw new ApiError(403, "FORBIDDEN", "You do not have access to this organization's data.");
  }
}
