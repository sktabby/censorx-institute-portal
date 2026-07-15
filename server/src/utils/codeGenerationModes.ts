import { ApiError } from "../middleware/errorHandler";
import { generateActivationCode, normalizeActivationCode } from "../services/codeCryptoService";
import { deriveSchoolPrefix } from "./schoolPrefix";

export interface PlaintextCodeEntry {
  plaintextCode: string;
  studentIdentifier: string | null;
}

function ensureStudentIdentifiers(input: { numberOfCodes: number; studentIdentifiers?: string[] }) {
  const studentIdentifiers = (input.studentIdentifiers ?? []).map((id) => id.trim()).filter(Boolean);
  if (studentIdentifiers.length !== input.numberOfCodes) {
    throw new ApiError(400, "STUDENT_ID_COUNT_MISMATCH", "Student ID count must match the number of codes.");
  }

  const seen = new Set<string>();
  for (const id of studentIdentifiers) {
    const normalized = id.toUpperCase();
    if (seen.has(normalized)) {
      throw new ApiError(400, "DUPLICATE_STUDENT_ID", `Duplicate student ID found: ${id}`);
    }
    seen.add(normalized);
  }

  return studentIdentifiers.map((id) => id.toUpperCase());
}

export function buildPlaintextCodesForMode(input: {
  schoolName: string;
  numberOfCodes: number;
  codeGenerationMode?: "RANDOM" | "STUDENT_IDS";
  studentIdentifiers?: string[];
}): PlaintextCodeEntry[] {
  if (input.numberOfCodes <= 0) {
    throw new ApiError(400, "INVALID_QUANTITY", "Requested quantity is invalid.");
  }

  const prefix = deriveSchoolPrefix(input.schoolName);
  const mode = input.codeGenerationMode ?? "RANDOM";

  if (mode === "STUDENT_IDS") {
    return ensureStudentIdentifiers(input).map((studentIdentifier) => ({
      plaintextCode: `${prefix}${studentIdentifier}`,
      studentIdentifier,
    }));
  }

  return Array.from({ length: input.numberOfCodes }, () => {
    const randomSuffix = normalizeActivationCode(generateActivationCode()).replace(/^CX/, "");
    return {
      plaintextCode: `${prefix}${randomSuffix}`,
      studentIdentifier: null,
    };
  });
}
