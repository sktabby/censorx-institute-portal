/**
 * Read only the fields a page needs. Portal pages count and list codes and licences, but each
 * full licence carries student, parent and device details too; reading just a few fields cuts
 * the data downloaded per page by about 90%.
 *
 * Read-only paths only. Never use a trimmed document for a write.
 */
export function onlyFields<Q>(query: Q, fields: readonly string[]): Q {
  const select = (query as unknown as { select?: (...names: string[]) => Q }).select;
  // Test doubles have no select(): they return whole documents, which is fine for reads.
  return typeof select === "function" ? select.apply(query, fields as string[]) : query;
}

/** Enough to work out a licence's effective status and which batch and school it belongs to. */
export const LICENSE_STATUS_FIELDS = ["licenseId", "organizationId", "subscriptionId", "status", "expiresAt"] as const;

/** Status fields plus what the school dashboard's "recent activations" shows. */
export const LICENSE_DASHBOARD_FIELDS = [
  ...LICENSE_STATUS_FIELDS,
  "studentUid",
  "studentName",
  "studentIdentifier",
  "studentEmail",
  "redeemedAt",
] as const;

/** Status fields plus what a code row shows (student ID and email). */
export const LICENSE_CODE_ROW_FIELDS = [...LICENSE_STATUS_FIELDS, "studentIdentifier", "studentEmail"] as const;

/** Enough to work out a code's effective status and its class and batch. */
export const CODE_STATUS_FIELDS = ["licenseId", "organizationId", "subscriptionId", "batchName", "status"] as const;

/** Status fields plus what a code row shows. */
export const CODE_ROW_FIELDS = [...CODE_STATUS_FIELDS, "codeLast4", "createdAt", "redeemedAt"] as const;
