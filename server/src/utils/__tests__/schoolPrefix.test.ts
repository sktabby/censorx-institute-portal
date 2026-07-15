import { describe, expect, it } from "vitest";
import { deriveSchoolPrefix } from "../schoolPrefix";

describe("deriveSchoolPrefix", () => {
  it("derives a consonant-heavy uppercase prefix from the school name", () => {
    expect(deriveSchoolPrefix("Moonstar")).toBe("MNSTR");
  });

  it("falls back to cleaned characters when there are few consonants", () => {
    expect(deriveSchoolPrefix("AI Academy")).toBe("CDMY");
  });

  it("uses a safe fallback for empty names", () => {
    expect(deriveSchoolPrefix("  !!!  ")).toBe("SCH");
  });
});
