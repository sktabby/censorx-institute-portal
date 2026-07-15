import { db } from "../config/firebaseAdmin";
import type { CollectionReference, DocumentData, Transaction } from "firebase-admin/firestore";

/**
 * Thin wrapper so business logic depends on a small typed surface rather
 * than the full Firestore SDK. Keeps repositories mockable for unit tests.
 */
export function collection<T = DocumentData>(name: string): CollectionReference<T> {
  return db.collection(name) as CollectionReference<T>;
}

export function newDocId(collectionName: string): string {
  return db.collection(collectionName).doc().id;
}

export function serverTimestamp() {
  // Lazily imported to avoid circular import issues in tests that mock db.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { FieldValue } = require("firebase-admin/firestore");
  return FieldValue.serverTimestamp();
}

export async function runTransaction<T>(
  fn: (tx: Transaction) => Promise<T>
): Promise<T> {
  return db.runTransaction(fn);
}

export { db };
