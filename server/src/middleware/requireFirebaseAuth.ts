import type { NextFunction, Request, Response } from "express";
import { adminAuth } from "../config/firebaseAdmin";
import { ApiError } from "./errorHandler";

export interface AuthenticatedRequest extends Request {
  firebaseUid?: string;
  firebaseEmail?: string;
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
    next();
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    next(new ApiError(401, "INVALID_TOKEN", "Your session is invalid or expired. Please sign in again."));
  }
}
