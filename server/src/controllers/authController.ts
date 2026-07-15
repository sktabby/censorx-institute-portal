import type { Response } from "express";
import { Timestamp } from "firebase-admin/firestore";
import type { PortalRequest } from "../middleware/requirePortalUser";
import { setMustChangePassword, touchLastLogin } from "../repositories/portalUserRepository";
import { ok } from "../utils/apiResponse";

export async function getMe(req: PortalRequest, res: Response) {
  const user = req.portalUser!;
  await touchLastLogin(user.uid, Timestamp.now());
  return ok(res, {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    organizationId: user.organizationId,
    status: user.status,
    mustChangePassword: user.mustChangePassword ?? false,
  });
}

export async function clearMustChangePassword(req: PortalRequest, res: Response) {
  await setMustChangePassword(req.portalUser!.uid, false);
  return ok(res, { mustChangePassword: false });
}
