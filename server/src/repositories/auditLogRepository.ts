import { Collections } from "../config/collections";
import { collection, newDocId, serverTimestamp } from "./firestoreRepository";

export interface AuditLogEntry {
  auditId: string;
  actorUid: string;
  actorRole: string;
  action: string;
  organizationId: string | null;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: FirebaseFirestore.Timestamp;
}

export async function writeAuditLog(entry: Omit<AuditLogEntry, "auditId" | "createdAt">) {
  const auditId = newDocId(Collections.organizationAuditLogs);
  await collection(Collections.organizationAuditLogs)
    .doc(auditId)
    .set({ ...entry, auditId, createdAt: serverTimestamp() });
  return auditId;
}
