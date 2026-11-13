export type PortalRole = "SUPER_ADMIN" | "SCHOOL_ADMIN";
export type PortalUserStatus = "ACTIVE" | "DISABLED";

export type OrganizationStatus = "ACTIVE" | "SUSPENDED" | "EXPIRED" | "ARCHIVED";

export type PlanDuration = "MONTHLY" | "THREE_MONTHS" | "SIX_MONTHS" | "YEARLY" | "CUSTOM";
export type SubscriptionStatus = "ACTIVE" | "SUSPENDED" | "EXPIRED" | "RENEWED" | "CANCELLED";

export type LicenseStatus = "UNUSED" | "ACTIVE" | "REVOKED" | "EXPIRED" | "DELETED";
export type ActivationCodeStatus = "UNUSED" | "REDEEMED" | "REVOKED" | "REPLACED" | "EXPIRED" | "DELETED";

export type EnquiryStatus = "NEW" | "CONTACTED" | "CLOSED" | "SPAM";

export interface PortalUser {
  uid: string;
  email: string;
  displayName: string;
  role: PortalRole;
  organizationId: string | null;
  status: PortalUserStatus;
  mustChangePassword: boolean;
  createdAt: FirebaseFirestore.Timestamp;
  createdBy: string;
  updatedAt: FirebaseFirestore.Timestamp;
  lastLoginAt: FirebaseFirestore.Timestamp | null;
}

export type PaymentMethod = "CASH" | "CHEQUE" | "UPI" | "CARD";
export type PaymentStatus = "PENDING_PAYMENT" | "INSTALLMENTS" | "PREPAID";

/** Method-specific details. Only the keys relevant to the chosen method are stored. */
export interface PaymentMethodDetails {
  chequeNumber?: string;
  bankName?: string;
  chequeDate?: string;
  transactionId?: string;
  upiId?: string;
  /** Last four digits only. Full card numbers are never accepted or stored. */
  cardLast4?: string;
  cardReference?: string;
}

/** Payment recorded when a school is created. Absent on schools created before billing existed. */
export interface OrganizationPayment {
  billNumber: string;
  billDate: FirebaseFirestore.Timestamp;
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
  installments: number;
  status: PaymentStatus;
  method: PaymentMethod | null;
  methodDetails: PaymentMethodDetails | null;
}

export interface Organization {
  organizationId: string;
  name: string;
  identifier: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  city: string;
  state: string;
  country: string;
  status: OrganizationStatus;
  purchasedSeats: number;
  activatedSeats: number;
  allowedDevicesPerStudent: number;
  currentSubscriptionId: string | null;
  billingReference: string | null;
  notes: string | null;
  payment?: OrganizationPayment | null;
  createdAt: FirebaseFirestore.Timestamp;
  createdBy: string;
  updatedAt: FirebaseFirestore.Timestamp;
  updatedBy: string;
}

export interface OrganizationSubscription {
  subscriptionId: string;
  organizationId: string;
  planDuration: PlanDuration;
  startAt: FirebaseFirestore.Timestamp;
  expiresAt: FirebaseFirestore.Timestamp;
  seatLimit: number;
  status: SubscriptionStatus;
  billingReference: string | null;
  notes: string | null;
  createdAt: FirebaseFirestore.Timestamp;
  createdBy: string;
  updatedAt: FirebaseFirestore.Timestamp;
  renewedFromSubscriptionId: string | null;
}

export interface OrganizationLicense {
  licenseId: string;
  organizationId: string;
  subscriptionId: string;
  /**
   * Denormalized from the paired activation code so a license is
   * self-describing. Null for licenses generated before batch tracking.
   */
  batchName: string | null;
  status: LicenseStatus;
  studentUid: string | null;
  studentIdentifier: string | null;
  studentName: string | null;
  studentEmail: string | null;
  parentName: string | null;
  parentEmail: string | null;
  parentPhone: string | null;
  deviceId: string | null;
  deviceFingerprint: string | null;
  deviceModel: string | null;
  redeemedAt: FirebaseFirestore.Timestamp | null;
  expiresAt: FirebaseFirestore.Timestamp;
  lastActiveAt: FirebaseFirestore.Timestamp | null;
  revokedAt: FirebaseFirestore.Timestamp | null;
  revokedBy: string | null;
  revocationReason: string | null;
  createdAt: FirebaseFirestore.Timestamp;
  createdBy: string;
  updatedAt: FirebaseFirestore.Timestamp;
}

/** Document ID is the codeHash itself — plaintext codes are never stored. */
export interface OrganizationActivationCode {
  codeHash: string;
  codeLast4: string;
  licenseId: string;
  organizationId: string;
  subscriptionId: string;
  batchName: string | null;
  status: ActivationCodeStatus;
  createdAt: FirebaseFirestore.Timestamp;
  createdBy: string;
  redeemedAt: FirebaseFirestore.Timestamp | null;
  replacedAt: FirebaseFirestore.Timestamp | null;
  replacedBy: string | null;
}

/** PENDING = seats allocated by a renewal, codes not generated yet. */
export type BatchRecordStatus = "PENDING" | "GENERATED";

/**
 * A named, sized allocation of seats.
 *
 * Batches used to exist only implicitly, as the batchName stamped on activation
 * codes. That cannot represent a batch with zero codes, which is exactly what
 * seat-only allocation from Renew School produces — so the allocation is
 * recorded here and the codes are generated against it later in Create Codes.
 * Batches created before this collection existed still resolve from their
 * codes, so both shapes are merged on read.
 */
export interface OrganizationBatch {
  batchId: string;
  organizationId: string;
  batchName: string;
  /** Subscription whose window this batch inherits. */
  subscriptionId: string;
  seatCount: number;
  status: BatchRecordStatus;
  startAt: FirebaseFirestore.Timestamp;
  expiresAt: FirebaseFirestore.Timestamp;
  createdAt: FirebaseFirestore.Timestamp;
  createdBy: string;
  updatedAt: FirebaseFirestore.Timestamp;
  generatedAt: FirebaseFirestore.Timestamp | null;
  /**
   * Set when a later renewal moved this still-pending batch onto its window.
   * Surfaced in the UI so the date change is never silent.
   */
  windowUpdatedAt: FirebaseFirestore.Timestamp | null;
}

export interface UserOrganizationEntitlement {
  uid: string;
  organizationId: string;
  licenseId: string;
  subscriptionId: string;
  status: LicenseStatus;
  source: "ORGANIZATION_LICENSE";
  expiresAt: FirebaseFirestore.Timestamp;
  serverCheckedAt: FirebaseFirestore.Timestamp;
  offlineValidUntil: FirebaseFirestore.Timestamp;
  deviceId: string | null;
  deviceFingerprint: string | null;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

export interface InstituteEnquiry {
  enquiryId: string;
  fullName: string;
  instituteName: string;
  email: string;
  phone: string;
  studentCount: number;
  preferredPlan: PlanDuration;
  message: string;
  status: EnquiryStatus;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}
