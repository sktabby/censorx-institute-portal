import { z } from "zod";

export const planDurationEnum = z.enum(["MONTHLY", "THREE_MONTHS", "SIX_MONTHS", "YEARLY", "CUSTOM"]);
export const activationCodeStatusEnum = z.enum(["UNUSED", "REDEEMED", "REVOKED", "REPLACED", "EXPIRED", "DELETED"]);
export const licenseListStatusEnum = z.enum(["ACTIVE", "UNUSED", "REVOKED", "REPLACED", "EXPIRED", "DELETED"]);

export const paymentMethodEnum = z.enum(["CASH", "CHEQUE", "UPI", "CARD"]);

const moneySchema = z.number().finite().min(0).max(100_000_000);
const detailText = z.string().trim().max(120);

/** Payment captured when a school is created. Pending and status are derived server-side. */
export const organizationPaymentSchema = z
  .object({
    totalAmount: moneySchema.refine((value) => value > 0, "Total amount must be more than 0."),
    paidAmount: moneySchema,
    installments: z.number().int().min(1).max(60),
    method: paymentMethodEnum.optional(),
    methodDetails: z
      .object({
        chequeNumber: detailText.optional(),
        bankName: detailText.optional(),
        chequeDate: detailText.optional(),
        transactionId: detailText.optional(),
        upiId: detailText.optional(),
        cardLast4: detailText.optional(),
        cardReference: detailText.optional(),
      })
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.paidAmount > value.totalAmount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paidAmount"],
        message: "Amount paid cannot be more than the total amount.",
      });
    }
    if (value.paidAmount > 0 && !value.method) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["method"], message: "Select a payment method." });
    }
    if (value.paidAmount > 0 && value.method) {
      const details = value.methodDetails ?? {};
      const missing = (...keys: Array<keyof typeof details>) => keys.some((key) => !details[key]?.trim());
      if (value.method === "CHEQUE" && missing("chequeNumber", "bankName", "chequeDate")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["methodDetails"],
          message: "Cheque number, bank name and cheque date are required.",
        });
      }
      if (value.method === "UPI" && missing("transactionId")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["methodDetails"],
          message: "UPI transaction ID is required.",
        });
      }
      if (value.method === "CARD" && !/^\d{4}$/.test(details.cardLast4?.trim() ?? "")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["methodDetails"],
          message: "Enter the last 4 digits of the card.",
        });
      }
    }
  });

export const createOrganizationSchema = z.object({
  name: z.string().min(2).max(200),
  contactName: z.string().min(2).max(120),
  contactEmail: z.string().email(),
  contactPhone: z.string().min(6).max(20),
  payment: organizationPaymentSchema.optional(),
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
const newBatchSchema = z.object({
  batchName: z.string().trim().min(1).max(120),
  seatCount: z.number().int().positive().max(100_000),
});

export const renewBatchesSchema = z
  .object({
    batchNames: z.array(z.string().min(1).max(120)).max(500).default([]),
    /** Single new class. Kept so existing callers keep working. */
    newBatch: newBatchSchema.optional(),
    /** Several new classes in one renewal. */
    newBatches: z.array(newBatchSchema).max(50).optional(),
    planDuration: planDurationEnum,
    startAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    seatLimit: z.number().int().positive().optional(),
    billingReference: z.string().max(200).optional(),
    notes: z.string().max(2000).optional(),
    idempotencyKey: z.string().min(8).max(200),
  })
  .superRefine((value, ctx) => {
    const newClasses = [...(value.newBatch ? [value.newBatch] : []), ...(value.newBatches ?? [])];
    if (value.batchNames.length === 0 && newClasses.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["batchNames"],
        message: "Select at least one batch to renew, or allocate a new batch.",
      });
    }
    const names = newClasses.map((item) => item.batchName.toLowerCase());
    if (new Set(names).size !== names.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["newBatches"],
        message: "Each new class needs its own name.",
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
