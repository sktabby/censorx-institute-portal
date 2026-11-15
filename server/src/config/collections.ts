/**
 * Firestore collection names for the SHARED Firebase project.
 * These names must exactly match whatever the Android app already uses.
 * If the Android app's existing collection names differ, update this file
 * to match them BEFORE writing any data — do not rename the Android side.
 */
export const Collections = {
  users: "users",
  portalUsers: "portalUsers",
  organizations: "organizations",
  organizationSubscriptions: "organizationSubscriptions",
  organizationLicenses: "organizationLicenses",
  organizationActivationCodes: "organizationActivationCodes",
  organizationBatches: "organizationBatches",
  organizationMembers: "organizationMembers",
  userOrganizationEntitlements: "userOrganizationEntitlements",
  organizationAuditLogs: "organizationAuditLogs",
  instituteEnquiries: "instituteEnquiries",
  /** Portal-only: in-app notices for schools. The Android app never reads this. */
  organizationNotifications: "organizationNotifications",
  /** Portal-only: encrypted full codes for school download. The Android app never reads this. */
  organizationCodeVault: "organizationCodeVault",
} as const;
