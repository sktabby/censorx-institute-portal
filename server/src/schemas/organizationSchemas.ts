import { z } from "zod";
import { MAX_CODES_PER_CLASS } from "../config/limits";

export const planDurationEnum = z.enum(["MONTHLY", "THREE_MONTHS", "SIX_MONTHS", "YEARLY", "CUSTOM"]);
export const activationCodeStatusEnum = z.enum(["UNUSED", "REDEEMED", "REVOKED", "REPLACED", "EXPIRED", "DELETED"]);
export const licenseListStatusEnum = z.enum(["ACTIVE", "UNUSED", "REVOKED", "REPLACED", "EXPIRED", "DELETED"]);

export const paymentMethodEnum = z.enum(["CASH", "CHEQUE", "UPI", "CARD"]);

const moneySchema = z.number().finite().min(0).max(100_000_000);
const detailText = z.string().trim().max(120);

/** Payment captured when a school is created. Pending and status are derived server-side. */
export const organizationPaymentSchema = z
  .object({
    /** Optional price per code per month. When given, amount before discount = codes × this × months. */
    amountPerCode: moneySchema.refine((value) => value > 0, "Amount per code must be more than 0.").optional(),
    /** Amount before discount, when typed by hand. */
    grossAmount: moneySchema.optional(),
    /** Discount on the overall amount, in percent. */
    discountPercent: z.number().finite().min(0).max(100).optional(),
    /** Amount payable after any discount. The server re-checks it. */
    totalAmount: moneySchema.refine((value) => value > 0, "Total amount must be more than 0."),
    /** One due date per installment, chosen by the admin. */
    installmentDueDates: z.array(z.string().datetime()).max(60).optional(),
    /** The installments split what is left after the amount paid now; the amount paid now is separate. */
    splitBalance: z.boolean().optional(),
    /** Optional amount per installment; must add up to the total (with splitBalance: the total less the amount paid now). Equal parts when left out. */
    installmentAmounts: z.array(moneySchema.refine((value) => value > 0, "Each installment must be more than 0.")).max(60).optional(),
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
    if (value.installmentAmounts && value.installmentAmounts.length !== value.installments) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["installmentAmounts"],
        message: "Give one amount for every installment.",
      });
    }
    if (value.installmentDueDates && value.installmentDueDates.length !== value.installments) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["installmentDueDates"],
        message: "Give one due date for every installment.",
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

export const subscriptionIdParamSchema = z.object({
  organizationId: z.string().min(1),
  subscriptionId: z.string().min(1),
});

export const classParamSchema = z.object({
  organizationId: z.string().min(1),
  subscriptionId: z.string().min(1),
  batchName: z.string().min(1).max(120),
});

/** One class in a new batch: its name and exactly how many codes it gets. */
const batchClassSchema = z.object({
  batchName: z.string().trim().min(1).max(120),
  seatCount: z.number().int().positive().max(MAX_CODES_PER_CLASS, { message: `A class can have at most ${MAX_CODES_PER_CLASS} codes. Split a bigger group into two classes.` }),
});

/**
 * A new, independent batch: dates, payment and classes. Seats and time only — there is
 * deliberately no code-generation input here; codes are made later in Create Codes.
 */
export const createBatchSchema = z
  .object({
    planDuration: planDurationEnum,
    startAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    classes: z.array(batchClassSchema).min(1, "Add at least one class.").max(50),
    payment: organizationPaymentSchema.optional(),
    billingReference: z.string().max(200).optional(),
    notes: z.string().max(2000).optional(),
    idempotencyKey: z.string().min(8).max(200),
  })
  .superRefine((value, ctx) => {
    const names = value.classes.map((item) => item.batchName.toLowerCase());
    if (new Set(names).size !== names.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["classes"], message: "Each class needs its own name." });
    }
  });

/** Renewal of ONE batch: new dates and its own payment. */
export const renewBatchSchema = z.object({
  planDuration: planDurationEnum,
  startAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  seatLimit: z.number().int().positive().optional(),
  payment: organizationPaymentSchema.optional(),
  billingReference: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  idempotencyKey: z.string().min(8).max(200),
});

const methodDetailsSchema = z
  .object({
    chequeNumber: detailText.optional(),
    bankName: detailText.optional(),
    chequeDate: detailText.optional(),
    transactionId: detailText.optional(),
    upiId: detailText.optional(),
    cardLast4: detailText.optional(),
    cardReference: detailText.optional(),
  })
  .optional();

/** Money received against a batch's bill, e.g. a later installment. */
export const recordPaymentSchema = z
  .object({
    amount: moneySchema.refine((value) => value > 0, "Enter an amount above 0."),
    paidAt: z.string().datetime().optional(),
    method: paymentMethodEnum,
    methodDetails: methodDetailsSchema,
  })
  .superRefine((value, ctx) => {
    const details = value.methodDetails ?? {};
    const missing = (...keys: Array<keyof typeof details>) => keys.some((key) => !details[key]?.trim());
    if (value.method === "CHEQUE" && missing("chequeNumber", "bankName", "chequeDate")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["methodDetails"], message: "Cheque number, bank name and cheque date are required." });
    }
    if (value.method === "UPI" && missing("transactionId")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["methodDetails"], message: "UPI transaction ID is required." });
    }
    if (value.method === "CARD" && !/^\d{4}$/.test(details.cardLast4?.trim() ?? "")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["methodDetails"], message: "Enter the last 4 digits of the card." });
    }
  });

export const installmentDatesSchema = z.object({
  dueDates: z.array(z.string().datetime()).min(1).max(60),
  /** Optional new amount per installment; must add up to the bill's total. */
  amounts: z.array(moneySchema.refine((value) => value > 0, "Each installment must be more than 0.")).min(1).max(60).optional(),
});

export const renewalEmailsSchema = z.object({ enabled: z.boolean() });

export const pauseBatchSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

/** Which bill of the series to show; the first invoice when left out. */
export const billQuerySchema = z.object({
  billNumber: z.string().min(1).max(80).optional(),
});

export const addClassSeatsSchema = z.object({
  extraSeats: z.number().int().positive().max(MAX_CODES_PER_CLASS, { message: `A class can have at most ${MAX_CODES_PER_CLASS} codes. Split a bigger group into two classes.` }),
  /** Price for the extra codes. Leave out, or amount 0, for free codes. */
  charge: z
    .object({
      amount: moneySchema,
      dueDate: z.string().datetime().optional(),
      ratePerCodePerMonth: moneySchema.optional(),
      months: z.number().int().min(1).max(120).optional(),
      /** Paid on the spot: recorded with the charge, no installment or due date. */
      paidNow: z
        .object({ method: paymentMethodEnum, methodDetails: methodDetailsSchema })
        .superRefine((value, ctx) => {
          const details = value.methodDetails ?? {};
          const missing = (...keys: Array<keyof typeof details>) => keys.some((key) => !details[key]?.trim());
          if (value.method === "CHEQUE" && missing("chequeNumber", "bankName", "chequeDate")) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["methodDetails"], message: "Cheque number, bank name and cheque date are required." });
          }
          if (value.method === "UPI" && missing("transactionId")) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["methodDetails"], message: "UPI transaction ID is required." });
          }
          if (value.method === "CARD" && !/^\d{4}$/.test(details.cardLast4?.trim() ?? "")) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["methodDetails"], message: "Enter the last 4 digits of the card." });
          }
        })
        .optional(),
    })
    .optional(),
});

export const increaseSeatsSchema = z.object({
  additionalSeats: z.number().int().positive().max(1_000_000),
});

/** Which codes to put in the downloaded spreadsheet. `batchNames` is comma separated. */
/** The codes just made on Create Codes, sent back to get them as an Excel file. */
export const createdCodesWorkbookSchema = z.object({
  schoolName: z.string().trim().max(200).optional(),
  classes: z
    .array(
      z.object({
        batchName: z.string().trim().min(1).max(120),
        codes: z
          .array(
            z.object({
              plaintextCode: z.string().min(1).max(120),
              studentIdentifier: z.string().max(120).nullable().optional(),
              codeLast4: z.string().max(20),
              licenseId: z.string().max(120),
            })
          )
          .max(MAX_CODES_PER_CLASS),
      })
    )
    .min(1)
    .max(50),
});

/** Student IDs to check against the ones a school has already used. */
export const studentIdCheckSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(120)).min(1).max(MAX_CODES_PER_CLASS),
});

/** A student ID file (.xlsx) as base64, to read its first column. */
export const studentIdFileSchema = z.object({
  fileBase64: z.string().min(1).max(7_000_000),
});

export const codeExportQuerySchema = z.object({
  subscriptionId: z.string().min(1).optional(),
  batchNames: z
    .string()
    .max(5000)
    .optional()
    .transform((value) =>
      value
        ? value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : undefined
    ),
});

export const notificationListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export const markNotificationsReadSchema = z.object({
  notificationIds: z.array(z.string().min(1)).max(500).optional(),
});

export const generateCodesSchema = z.object({
  subscriptionId: z.string().min(1).optional(),
  numberOfCodes: z.number().int().positive().max(MAX_CODES_PER_CLASS, { message: `A class can have at most ${MAX_CODES_PER_CLASS} codes. Split a bigger group into two classes.` }),
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
  subscriptionId: z.string().min(1).optional(),
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
