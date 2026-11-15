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

/**
 * A payment and its bill. Today this lives on each batch (organizationSubscriptions.payment);
 * schools created before batches existed may still carry one on the organization itself.
 */
export interface OrganizationPayment {
  /**
   * Paid outside the installment plan: when the batch was set up, plus any extra codes paid on
   * the spot. The installments split only the rest (total − this). Missing on older bills, whose installments split the
   * whole total and include any amount paid at the start.
   */
  upfrontAmount?: number | null;
  billNumber: string;
  billDate: FirebaseFirestore.Timestamp;
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
  installments: number;
  status: PaymentStatus;
  method: PaymentMethod | null;
  methodDetails: PaymentMethodDetails | null;
  /** What the bill is for, e.g. "Batch 2 — Class 5A (30 codes), Class 5B (25 codes)". */
  description?: string | null;
  /** Price per code per month, when the amount was worked out as codeCount × amountPerCode × months. */
  amountPerCode?: number | null;
  codeCount?: number | null;
  months?: number | null;
  /** Amount before discount. Missing on bills made before discounts existed (then equal to totalAmount). */
  grossAmount?: number | null;
  discountPercent?: number | null;
  discountAmount?: number | null;
  /** The invoice's item lines. Missing on older bills, which show a single subscription line. */
  lineItems?: InvoiceLineItem[] | null;
  /** The batch and period this bill covers. */
  batchLabel?: string | null;
  serviceStartAt?: FirebaseFirestore.Timestamp | null;
  serviceEndAt?: FirebaseFirestore.Timestamp | null;
  /** "NEW" for a new batch, "RENEWAL" for a renewal. */
  billKind?: "NEW" | "RENEWAL" | null;
  /** Classes covered by this bill, with their number of codes when known. */
  classesCovered?: Array<{ name: string; codes: number | null }> | null;
  /** Installment plan with the due dates chosen by the admin. Missing on older bills. */
  installmentPlan?: PaymentInstallment[] | null;
  /** Every payment received against this bill, oldest first. */
  transactions?: PaymentTransaction[] | null;
  /** Every bill issued for this payment: the first invoice, then one after each later payment. */
  bills?: IssuedBill[] | null;
}

export interface PaymentInstallment {
  number: number;
  amount: number;
  dueDate: FirebaseFirestore.Timestamp;
  /** Set when the "due in 3 days" reminder was sent. */
  upcomingNoticeAt?: FirebaseFirestore.Timestamp | null;
  /** Set when the "due today / now due" reminder was sent. */
  dueNoticeAt?: FirebaseFirestore.Timestamp | null;
  /** Set when the "overdue" reminder was sent (7 days after the due date). */
  overdueNoticeAt?: FirebaseFirestore.Timestamp | null;
  /** A reminder whose in-app notice was created but whose email could not be sent yet; retried nightly. */
  reminderEmailPending?: "UPCOMING" | "DUE" | "OVERDUE" | null;
  /** Last "still overdue" follow-up email (every 3 days after the overdue email, until paid). */
  followUpEmailedAt?: FirebaseFirestore.Timestamp | null;
  /** How many follow-ups were sent for this installment. */
  followUpCount?: number;
  /** Set on installments added after the first invoice: the bill that added them. */
  addedOnBill?: string | null;
}

export interface PaymentTransaction {
  transactionId: string;
  amount: number;
  paidAt: FirebaseFirestore.Timestamp;
  method: PaymentMethod;
  methodDetails: PaymentMethodDetails | null;
  recordedBy: string;
  recordedAt: FirebaseFirestore.Timestamp;
  /** The bill issued for this payment. */
  billNumber: string;
}

export interface IssuedBill {
  billNumber: string;
  issuedAt: FirebaseFirestore.Timestamp;
  /**
   * INVOICE = the first bill; PAYMENT = a new bill after a later payment;
   * ADJUSTMENT = a new bill after something was added to the order (e.g. extra codes).
   */
  kind: "INVOICE" | "PAYMENT" | "ADJUSTMENT";
  transactionId: string | null;
  paidToDate: number;
  balance: number;
  /** Total of the order as of this bill. Missing on older bills (then the current total). */
  totalAtBill?: number | null;
  /** What changed, printed on the bill, e.g. "2 extra codes added to Class 5A". */
  note?: string | null;
  /** Why an ADJUSTMENT bill was issued. Missing on older bills (then: items were added). */
  reason?: "EXTRA_CODES" | "SCHEDULE_CHANGE" | null;
}

/** One line of an invoice. Amounts are in rupees, rounded to paise. */
export interface InvoiceLineItem {
  /** Main text, e.g. "Class 5A". */
  item: string;
  /** Smaller second line, e.g. "Student activation codes — Batch 2". */
  detail: string | null;
  quantity: number;
  /** "codes" or "item". */
  unit: string;
  /** Price per unit (per code per month when months is set). */
  rate: number;
  months: number | null;
  amount: number;
  /** Set on lines added after the first invoice (e.g. extra codes): the bill that added them. */
  addedOnBill?: string | null;
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
  /**
   * Aggregates kept for the mobile app's redemption guard (activatedSeats >= purchasedSeats):
   * purchasedSeats = seats of every batch that is currently live; activatedSeats = students
   * currently holding a seat. Every read path derives its own numbers from the licences.
   */
  purchasedSeats: number;
  activatedSeats: number;
  allowedDevicesPerStudent: number;
  /** Informational only: the batch created or renewed most recently. No logic depends on it. */
  currentSubscriptionId: string | null;
  billingReference: string | null;
  notes: string | null;
  /** Legacy: a payment recorded on the school itself, before payments moved to batches. */
  payment?: OrganizationPayment | null;
  createdAt: FirebaseFirestore.Timestamp;
  createdBy: string;
  updatedAt: FirebaseFirestore.Timestamp;
  updatedBy: string;
}

/**
 * One batch period. A school has many batches, each an independent subscription with its own
 * dates, seats, payment and classes. Renewing a batch creates a new period document that keeps
 * the batch's number and points back at the period it renews (renewedFromSubscriptionId); the
 * renewed period is marked RENEWED.
 */
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
  /** 1-based batch number within the school. Missing on records written before batches existed (treated as 1). */
  batchNumber?: number;
  /** Display label, e.g. "Batch 2". */
  batchLabel?: string | null;
  /** Payment and bill for this period. */
  payment?: OrganizationPayment | null;
  cancelledAt?: FirebaseFirestore.Timestamp | null;
  /** Set while access is stopped by the admin (status SUSPENDED). */
  pausedAt?: FirebaseFirestore.Timestamp | null;
  pauseReason?: string | null;
  /** Set once the "ends in 3 days" in-app notice was created for this period. */
  renewalReminderSentAt?: FirebaseFirestore.Timestamp | null;
  /** Set once the reminder email was accepted by the mail server (retried daily until then). */
  renewalReminderEmailedAt?: FirebaseFirestore.Timestamp | null;
  /** Set once the "batch ended" in-app notice was created for this period. */
  endedNoticeSentAt?: FirebaseFirestore.Timestamp | null;
  endedEmailedAt?: FirebaseFirestore.Timestamp | null;
  /** Last renewal (marketing) email after the period ended: every 4 days until it is renewed. */
  renewalOfferEmailedAt?: FirebaseFirestore.Timestamp | null;
  renewalOfferCount?: number;
  /** Set when the admin stopped the renewal emails for this period (e.g. the school asked). */
  renewalEmailsStoppedAt?: FirebaseFirestore.Timestamp | null;
}

export type NotificationType =
  | "BATCH_CREATED"
  | "BATCH_RENEWED"
  | "BATCH_ENDING_SOON"
  | "BATCH_ENDED"
  | "CODES_READY"
  | "BATCH_PAUSED"
  | "BATCH_RESUMED"
  | "PAYMENT_RECEIVED"
  | "PAYMENT_DUE"
  | "PAYMENT_OVERDUE";

/** An in-app notice shown in the school portal (bell + Notifications page). */
export interface OrganizationNotification {
  notificationId: string;
  organizationId: string;
  type: NotificationType;
  title: string;
  message: string;
  subscriptionId: string | null;
  batchLabel: string | null;
  createdAt: FirebaseFirestore.Timestamp;
  readAt: FirebaseFirestore.Timestamp | null;
}

/**
 * Encrypted copy of a full activation code so the school can download it later.
 * Document ID is the licenseId. AES-256-GCM under CODE_VAULT_KEY; the hash in
 * organizationActivationCodes is still what redemption uses — this never takes part in it.
 */
export interface OrganizationCodeVaultEntry {
  licenseId: string;
  organizationId: string;
  subscriptionId: string;
  batchName: string | null;
  codeHash: string;
  codeLast4: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
  createdAt: FirebaseFirestore.Timestamp;
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
