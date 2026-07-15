import { Collections } from "../config/collections";
import { collection } from "./firestoreRepository";
import type { PortalUser } from "../models/types";

const portalUsers = () => collection<PortalUser>(Collections.portalUsers);

export async function getPortalUser(uid: string): Promise<PortalUser | null> {
  const snap = await portalUsers().doc(uid).get();
  return snap.exists ? (snap.data() as PortalUser) : null;
}

export async function touchLastLogin(uid: string, timestamp: FirebaseFirestore.Timestamp) {
  await portalUsers().doc(uid).update({ lastLoginAt: timestamp });
}

export async function setMustChangePassword(uid: string, mustChangePassword: boolean) {
  await portalUsers().doc(uid).update({ mustChangePassword });
}
