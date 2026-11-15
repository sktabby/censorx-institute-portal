import type { PaymentMethod, PaymentMethodDetails, PlanDuration } from "../models/types";

/** Payment captured on the Create School form. */
export interface OrganizationPaymentInput {
  /** Optional price per code per month. */
  amountPerCode?: number;
  /** Amount before discount, when typed by hand. */
  grossAmount?: number;
  /** Discount on the overall amount, in percent (0–100). */
  discountPercent?: number;
  /** Amount payable after any discount. */
  totalAmount: number;
  /** One due date per installment (ISO strings), chosen by the admin. */
  installmentDueDates?: string[];
  /** Optional amount per installment, adding up to the total. Equal parts when left out. */
  installmentAmounts?: number[];
  /** The installments split the balance left after the amount paid now (paid now is separate). */
  splitBalance?: boolean;
  paidAmount: number;
  installments: number;
  method?: PaymentMethod;
  methodDetails?: PaymentMethodDetails;
}

export interface CreateOrganizationInput {
  name: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  /** Optional: callers that do not send it (scripts, older clients) behave exactly as before. */
  payment?: OrganizationPaymentInput;
}

export interface RenewSubscriptionInput {
  planDuration: PlanDuration;
  startAt: string;
  expiresAt: string;
  seatLimit?: number;
  billingReference?: string;
  notes?: string;
}

export interface GenerateCodesInput {
  organizationId: string;
  subscriptionId?: string;
  numberOfCodes: number;
  batchName?: string;
  studentIdentifierPrefix?: string;
  studentIdentifiers?: string[];
  codeGenerationMode?: "RANDOM" | "STUDENT_IDS";
  codes?: string[];
  notes?: string;
  idempotencyKey: string;
}

export interface CreateCodesWithSubscriptionInput extends Omit<GenerateCodesInput, "subscriptionId"> {
  planDuration: PlanDuration;
  startAt?: string;
  expiresAt?: string;
}

/**
 * One class inside a new batch: its name and exactly how many codes it gets.
 * Deliberately no code-generation fields — codes are made later in Create Codes.
 */
export interface CreateBatchClassInput {
  batchName: string;
  seatCount: number;
}

/** A new, independent batch for a school: dates, payment and classes. */
export interface CreateBatchInput {
  planDuration: PlanDuration;
  startAt: string;
  expiresAt: string;
  classes: CreateBatchClassInput[];
  payment?: OrganizationPaymentInput;
  billingReference?: string;
  notes?: string;
  idempotencyKey: string;
}

/** Renewal of ONE batch: new dates and its own payment. Seats stay the same unless overridden. */
export interface RenewBatchInput {
  planDuration: PlanDuration;
  startAt: string;
  expiresAt: string;
  seatLimit?: number;
  payment?: OrganizationPaymentInput;
  billingReference?: string;
  notes?: string;
  idempotencyKey: string;
}
