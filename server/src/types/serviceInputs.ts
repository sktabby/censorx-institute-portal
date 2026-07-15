import type { PlanDuration } from "../models/types";

export interface CreateOrganizationInput {
  name: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
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
