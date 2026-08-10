import { z } from "zod";

export const planDurationEnum = z.enum(["MONTHLY", "THREE_MONTHS", "SIX_MONTHS", "YEARLY", "CUSTOM"]);
export const activationCodeStatusEnum = z.enum(["UNUSED", "REDEEMED", "REVOKED", "REPLACED", "EXPIRED", "DELETED"]);
export const licenseListStatusEnum = z.enum(["ACTIVE", "UNUSED", "REVOKED", "REPLACED", "EXPIRED", "DELETED"]);

export const createOrganizationSchema = z.object({
  name: z.string().min(2).max(200),
  contactName: z.string().min(2).max(120),
  contactEmail: z.string().email(),
  contactPhone: z.string().min(6).max(20),
});

export const orgIdParamSchema = z.object({ organizationId: z.string().min(1) });
export const licenseIdParamSchema = z.object({ licenseId: z.string().min(1) });
export const batchParamSchema = z.object({
  organizationId: z.string().min(1),
  batchName: z.string().min(1).max(120),
});

export const renewSubscriptionSchema = z.object({
  planDuration: planDurationEnum,
  startAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  seatLimit: z.number().int().positive().optional(),
  billingReference: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});

export const extendSubscriptionSchema = z.object({
  newExpiresAt: z.string().datetime(),
});

/**
 * Batch-wise renewal: renew any combination of existing batches in place,
 * and/or allocate one brand-new batch. At least one of the two must be present.
 *
 * Seats and time only. There is deliberately no code-generation input here —
 * a new batch reserves named, sized seats and inherits this renewal's own
 * start/expiry; its codes are generated separately from Create Codes.
 */
export const renewBatchesSchema = z
  .object({
    batchNames: z.array(z.string().min(1).max(120)).max(500).default([]),
    newBatch: z
      .object({
        batchName: z.string().trim().min(1).max(120),
        seatCount: z.number().int().positive().max(100_000),
      })
      .optional(),
    planDuration: planDurationEnum,
    startAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    seatLimit: z.number().int().positive().optional(),
    billingReference: z.string().max(200).optional(),
    notes: z.string().max(2000).optional(),
    idempotencyKey: z.string().min(8).max(200),
  })
  .superRefine((value, ctx) => {
    if (value.batchNames.length === 0 && !value.newBatch) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["batchNames"],
        message: "Select at least one batch to renew, or allocate a new batch.",
      });
    }
  });

export const increaseSeatsSchema = z.object({
  additionalSeats: z.number().int().positive().max(1_000_000),
});

export const generateCodesSchema = z.object({
  subscriptionId: z.string().min(1).optional(),
  numberOfCodes: z.number().int().positive().max(100_000),
  planDuration: planDurationEnum.optional(),
  startAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  batchName: z.string().max(120).optional(),
  studentIdentifierPrefix: z.string().max(40).optional(),
  studentIdentifiers: z.array(z.string().min(1).max(120)).optional(),
  codeGenerationMode: z.enum(["RANDOM", "STUDENT_IDS"]).default("RANDOM"),
  codes: z.array(z.string().min(1).max(200)).optional(),
  notes: z.string().max(2000).optional(),
  idempotencyKey: z.string().min(8).max(200),
}).superRefine((value, ctx) => {
  if (!value.subscriptionId && !value.planDuration) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["planDuration"],
      message: "Plan duration is required when no subscriptionId is provided.",
    });
  }
  if (value.planDuration === "CUSTOM" && (!value.startAt || !value.expiresAt)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expiresAt"],
      message: "Custom plans require startAt and expiresAt.",
    });
  }
  if (value.codeGenerationMode === "STUDENT_IDS" && !value.studentIdentifiers?.length && !value.codes?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["studentIdentifiers"],
      message: "Student ID mode requires student identifiers.",
    });
  }
});

export const replaceLicenseSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const revokeLicenseSchema = z.object({
  reason: z.string().min(2).max(500),
});

export const codeListQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  status: activationCodeStatusEnum.optional(),
  batchName: z.string().max(120).optional(),
  search: z.string().max(120).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10),
});

export const studentListQuerySchema = z.object({
  status: z.enum(["ACTIVE", "REVOKED", "EXPIRED"]).optional(),
  search: z.string().max(120).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10),
});

export const licenseListQuerySchema = z.object({
  status: licenseListStatusEnum.optional(),
  search: z.string().max(120).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10),
});

export const organizationListQuerySchema = z.object({
  search: z.string().max(120).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "EXPIRED", "ARCHIVED"]).optional(),
  includeArchived: z.coerce.boolean().default(false),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10),
});

export const deleteBatchSchema = z.object({
  confirmSchoolName: z.string().min(1).max(200),
});
