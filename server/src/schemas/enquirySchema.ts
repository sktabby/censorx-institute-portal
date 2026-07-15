import { z } from "zod";
import { planDurationEnum } from "./organizationSchemas";

export const instituteEnquirySchema = z.object({
  fullName: z.string().min(2).max(120),
  instituteName: z.string().min(2).max(200),
  email: z.string().email(),
  phone: z.string().min(6).max(20),
  studentCount: z.number().int().positive().max(1_000_000),
  preferredPlan: planDurationEnum,
  message: z.string().min(2).max(3000),
  // Honeypot field: must always be empty. Real users never see/fill it.
  website: z.string().max(0).optional().default(""),
});
