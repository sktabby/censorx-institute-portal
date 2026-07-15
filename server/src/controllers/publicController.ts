import type { Request, Response } from "express";
import { Collections } from "../config/collections";
import { collection, newDocId, serverTimestamp } from "../repositories/firestoreRepository";
import { ok } from "../utils/apiResponse";

export async function health(_req: Request, res: Response) {
  return ok(res, { status: "healthy", service: "censorx-institute-portal-api" });
}

export async function createInstituteEnquiry(req: Request, res: Response) {
  const { website, ...body } = req.body; // honeypot field discarded
  if (website) {
    // Silently accept (do not reveal spam detection) but do not persist.
    return ok(res, { received: true }, {}, 201);
  }

  const enquiryId = newDocId(Collections.instituteEnquiries);
  await collection(Collections.instituteEnquiries)
    .doc(enquiryId)
    .set({
      enquiryId,
      ...body,
      status: "NEW",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

  return ok(res, { received: true }, {}, 201);
}
