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
