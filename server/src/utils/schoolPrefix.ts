const FALLBACK_PREFIX = "SCH";
const MAX_PREFIX_LENGTH = 6;

export function deriveSchoolPrefix(name: string): string {
  const cleaned = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return FALLBACK_PREFIX;

  const consonants = cleaned.replace(/[AEIOU]/g, "");
  const source = consonants.length >= 3 ? consonants : cleaned;
  return source.slice(0, MAX_PREFIX_LENGTH);
}
