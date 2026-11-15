import type { NextFunction, Request, Response } from "express";
import { adminAuth } from "../config/firebaseAdmin";
import { ApiError } from "./errorHandler";

export interface AuthenticatedRequest extends Request {
  firebaseUid?: string;
  firebaseEmail?: string;
  /** Seconds since epoch at which the user last entered their password (token `auth_time`). */
  firebaseAuthTime?: number;
}

/**
 * Verifies the Firebase ID token sent as: Authorization: Bearer <token>
 * Does NOT check portal authorization — see requirePortalUser for that.
 */
export async function requireFirebaseAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization ?? "";
    const [scheme, token] = header.split(" ");

    if (scheme !== "Bearer" || !token) {
      throw new ApiError(401, "UNAUTHENTICATED", "Missing or malformed Authorization header.");
    }

    const decoded = await adminAuth.verifyIdToken(token, true);
    req.firebaseUid = decoded.uid;
    req.firebaseEmail = decoded.email;
    req.firebaseAuthTime = typeof decoded.auth_time === "number" ? decoded.auth_time : undefined;
    next();
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    next(new ApiError(401, "INVALID_TOKEN", "Your session is invalid or expired. Please sign in again."));
  }
}

/**
 * Sensitive downloads (full activation codes) require the password to have been entered
 * recently. The portal re-authenticates the user just before calling, which refreshes
 * `auth_time`; an old session is turned away with REAUTH_REQUIRED.
 */
export function requireRecentLogin(maxAgeMinutes = 15) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    const authTime = req.firebaseAuthTime;
    const ageSeconds = authTime ? Date.now() / 1000 - authTime : Number.POSITIVE_INFINITY;
    if (ageSeconds > maxAgeMinutes * 60) {
      return next(new ApiError(403, "REAUTH_REQUIRED", "Please confirm your password to continue."));
    }
    next();
  };
}
