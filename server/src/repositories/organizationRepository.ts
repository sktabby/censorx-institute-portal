import { Collections } from "../config/collections";
import { collection } from "./firestoreRepository";
import type {
  Organization,
  OrganizationSubscription,
  OrganizationLicense,
  OrganizationActivationCode,
  OrganizationStatus,
  SubscriptionStatus,
  LicenseStatus,
  ActivationCodeStatus,
} from "../models/types";

export const organizations = () => collection<Organization>(Collections.organizations);
export const subscriptions = () => collection<OrganizationSubscription>(Collections.organizationSubscriptions);
export const licenses = () => collection<OrganizationLicense>(Collections.organizationLicenses);
export const activationCodes = () => collection<OrganizationActivationCode>(Collections.organizationActivationCodes);

export async function getOrganization(organizationId: string): Promise<Organization | null> {
  const snap = await organizations().doc(organizationId).get();
  return snap.exists ? (snap.data() as Organization) : null;
}

export function getEffectiveSubscriptionStatus(
  subscription: Pick<OrganizationSubscription, "status" | "expiresAt">,
  now = new Date()
): SubscriptionStatus {
  if (subscription.status === "ACTIVE" && subscription.expiresAt.toMillis() <= now.getTime()) {
    return "EXPIRED";
  }
  return subscription.status;
}

export function withEffectiveSubscriptionStatus(subscription: OrganizationSubscription, now = new Date()): OrganizationSubscription {
  // Computed read-time value only: Firestore's stored status is not
  // automatically mutated when time passes. This mirrors the license expiry
  // checks elsewhere, where expiry is evaluated against server time on read.
  return { ...subscription, status: getEffectiveSubscriptionStatus(subscription, now) };
}

export function getEffectiveOrganizationStatus(
  organization: Pick<Organization, "status">,
  subscription: Pick<OrganizationSubscription, "status" | "expiresAt"> | null | undefined,
  now = new Date()
): OrganizationStatus {
  if (organization.status === "SUSPENDED" || organization.status === "ARCHIVED") {
    return organization.status;
  }
  if (subscription && getEffectiveSubscriptionStatus(subscription, now) === "EXPIRED") {
    return "EXPIRED";
  }
  return organization.status;
}

function isExpiredCoverage(
  subscription: Pick<OrganizationSubscription, "status" | "expiresAt"> | null | undefined,
  license: Pick<OrganizationLicense, "expiresAt"> | null | undefined,
  now: Date
) {
  return (
    (subscription ? getEffectiveSubscriptionStatus(subscription, now) === "EXPIRED" : false) ||
    (license ? license.expiresAt.toMillis() <= now.getTime() : false)
  );
}

export function getEffectiveLicenseStatus(
  license: Pick<OrganizationLicense, "status" | "expiresAt">,
  subscription: Pick<OrganizationSubscription, "status" | "expiresAt"> | null | undefined,
  now = new Date()
): LicenseStatus {
  if ((license.status === "UNUSED" || license.status === "ACTIVE") && isExpiredCoverage(subscription, license, now)) {
    return "EXPIRED";
  }
  return license.status;
}

export function withEffectiveLicenseStatus(
  license: OrganizationLicense,
  subscription: Pick<OrganizationSubscription, "status" | "expiresAt"> | null | undefined,
  now = new Date()
): OrganizationLicense {
  return { ...license, status: getEffectiveLicenseStatus(license, subscription, now) };
}

export function getEffectiveActivationCodeStatus(
  code: Pick<OrganizationActivationCode, "status">,
  subscription: Pick<OrganizationSubscription, "status" | "expiresAt"> | null | undefined,
  license: Pick<OrganizationLicense, "status" | "expiresAt"> | null | undefined,
  now = new Date()
): ActivationCodeStatus {
  if (code.status === "UNUSED" && isExpiredCoverage(subscription, license, now)) {
    return "EXPIRED";
  }
  return code.status;
}

export function withEffectiveActivationCodeStatus(
  code: OrganizationActivationCode,
  subscription: Pick<OrganizationSubscription, "status" | "expiresAt"> | null | undefined,
  license: Pick<OrganizationLicense, "status" | "expiresAt"> | null | undefined,
  now = new Date()
): OrganizationActivationCode {
  return { ...code, status: getEffectiveActivationCodeStatus(code, subscription, license, now) };
}

export async function getCurrentSubscription(
  organizationId: string,
  options: { effectiveStatus?: boolean } = {}
): Promise<OrganizationSubscription | null> {
  const org = await getOrganization(organizationId);
  if (!org?.currentSubscriptionId) return null;
  const snap = await subscriptions().doc(org.currentSubscriptionId).get();
  if (!snap.exists) return null;

  const subscription = snap.data() as OrganizationSubscription;
  return options.effectiveStatus === false ? subscription : withEffectiveSubscriptionStatus(subscription);
}

export async function getActiveSubscription(organizationId: string): Promise<OrganizationSubscription | null> {
  return getCurrentSubscription(organizationId);
}

export async function listOrganizationCodes(organizationId: string, limit?: number) {
  let query: FirebaseFirestore.Query<OrganizationActivationCode> = activationCodes().where("organizationId", "==", organizationId);
  if (limit) query = query.limit(limit);
  const [codesSnap, licensesSnap, subscriptionsSnap] = await Promise.all([
    query.get(),
    licenses().where("organizationId", "==", organizationId).get(),
    subscriptions().where("organizationId", "==", organizationId).get(),
  ]);
  const now = new Date();
  const licenseById = new Map<string, OrganizationLicense>();
  licensesSnap.docs.forEach((doc) => licenseById.set(doc.id, doc.data() as OrganizationLicense));
  const subscriptionById = new Map<string, OrganizationSubscription>();
  subscriptionsSnap.docs.forEach((doc) => subscriptionById.set(doc.id, doc.data() as OrganizationSubscription));

  return codesSnap.docs.map((d) => {
    const code = d.data();
    return withEffectiveActivationCodeStatus(
      code,
      subscriptionById.get(code.subscriptionId),
      licenseById.get(code.licenseId),
      now
    );
  });
}

export async function listOrganizationLicenses(organizationId: string, limit?: number) {
  let query: FirebaseFirestore.Query<OrganizationLicense> = licenses().where("organizationId", "==", organizationId);
  if (limit) query = query.limit(limit);
  const [licensesSnap, subscriptionsSnap] = await Promise.all([
    query.get(),
    subscriptions().where("organizationId", "==", organizationId).get(),
  ]);
  const now = new Date();
  const subscriptionById = new Map<string, OrganizationSubscription>();
  subscriptionsSnap.docs.forEach((doc) => subscriptionById.set(doc.id, doc.data() as OrganizationSubscription));

  return licensesSnap.docs.map((d) => {
    const license = d.data();
    return withEffectiveLicenseStatus(license, subscriptionById.get(license.subscriptionId), now);
  });
}
