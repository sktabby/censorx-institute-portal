import type { PaymentMethod, PaymentMethodDetails, PlanDuration } from "../models/types";

/** Payment captured on the Create School form. */
export interface OrganizationPaymentInput {
  totalAmount: number;
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
 * Seat-only allocation made as part of a batch-wise renewal. Deliberately has
 * no code-generation fields: the batch is named and sized here, and its codes
 * are generated later from Create Codes under the renewal's inherited window.
 */
export interface RenewBatchesNewBatchInput {
  batchName: string;
  seatCount: number;
}

export interface RenewBatchesInput {
  /** Existing batches to renew in place. May be empty when only allocating a new batch. */
  batchNames?: string[];
  /** Optional seat-only allocation made alongside the renewal. */
  newBatch?: RenewBatchesNewBatchInput;
  /** Optional: several seat-only allocations in the same renewal. */
  newBatches?: RenewBatchesNewBatchInput[];
  planDuration: PlanDuration;
  startAt: string;
  expiresAt: string;
  seatLimit?: number;
  billingReference?: string;
  notes?: string;
  idempotencyKey: string;
}

// RenewBatchesResult lives in organizationService, where GenerateCodesResult is
// already in scope — importing it here would create a module cycle.
