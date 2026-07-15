import { z } from "zod";

export const redeemLicenseSchema = z.object({
  code: z.string().min(6).max(64),
  deviceId: z.string().min(1).max(200),
  deviceFingerprint: z.string().min(1).max(500),
  deviceModel: z.string().min(1).max(200),
  studentIdentifier: z.string().min(1).max(200),
  studentName: z.string().min(1).max(200),
  studentEmail: z.string().email().optional(),
});
