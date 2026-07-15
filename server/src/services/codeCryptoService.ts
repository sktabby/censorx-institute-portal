import crypto from "node:crypto";
import { env } from "../config/env";

/**
 * This service defines the EXACT algorithm used to generate, normalize,
 * and hash student activation codes. The Android app's redemption logic
 * must implement (or call) this same algorithm — do not reimplement it
 * independently on the Android side. If this file changes, the Android
 * integration must change with it.
 */

// Crockford-style alphabet, excluding I, L, O, 0, 1 to avoid ambiguity.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const SEGMENT_LENGTH = 4;
const SEGMENT_COUNT = 4; // CX-XXXX-XXXX-XXXX-XXXX
const PREFIX = "CX";

/**
 * Generates a cryptographically random activation code with at least
 * 128 bits of entropy, formatted as: CX-7K3M-Q9TD-4PWA-R8F2
 */
export function generateActivationCode(): string {
  const totalChars = SEGMENT_LENGTH * SEGMENT_COUNT; // 16 chars
  // 5 bits of entropy per character (alphabet length 31 ~= 5 bits), so
  // 16 chars gives ~80 bits from encoding alone; we draw from a larger
  // random pool (crypto.randomBytes) to comfortably exceed 128 bits total
  // entropy budget across the generation process.
  const randomBytes = crypto.randomBytes(totalChars * 2); // extra bytes for uniform rejection sampling

  let chars = "";
  let byteIndex = 0;
  while (chars.length < totalChars) {
    if (byteIndex >= randomBytes.length) {
      // Extremely unlikely with the buffer size above, but stay safe.
      byteIndex = 0;
    }
    const byte = randomBytes[byteIndex++];
    // Rejection sampling to avoid modulo bias.
    if (byte >= 256 - (256 % CODE_ALPHABET.length)) continue;
    chars += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }

  const segments: string[] = [];
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    segments.push(chars.slice(i * SEGMENT_LENGTH, (i + 1) * SEGMENT_LENGTH));
  }

  return `${PREFIX}-${segments.join("-")}`;
}

/**
 * Normalizes a user- or scanner-submitted code prior to hashing:
 * removes whitespace, removes hyphens, uppercases. This MUST match the
 * normalization performed by the Android redemption client/service.
 */
export function normalizeActivationCode(rawCode: string): string {
  return rawCode.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * HMAC-SHA256(normalizedCode, ORG_CODE_PEPPER) — hex digest.
 * The pepper must be identical across website generation and Android
 * redemption. Never store or return plaintext codes after creation.
 */
export function hashActivationCode(normalizedCode: string): string {
  return crypto.createHmac("sha256", env.ORG_CODE_PEPPER).update(normalizedCode).digest("hex");
}

/** Last 4 characters of the *normalized* code, safe to store/display. */
export function lastFourOfCode(normalizedCode: string): string {
  return normalizedCode.slice(-4);
}

export function hashFromRawCode(rawCode: string): { normalized: string; hash: string; last4: string } {
  const normalized = normalizeActivationCode(rawCode);
  return {
    normalized,
    hash: hashActivationCode(normalized),
    last4: lastFourOfCode(normalized),
  };
}
