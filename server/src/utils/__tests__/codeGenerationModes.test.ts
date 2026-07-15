import { describe, expect, it } from "vitest";

process.env.ORG_CODE_PEPPER = "a-very-long-test-pepper-value-1234567890";
process.env.CLIENT_ORIGINS = "http://localhost:5173";
process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/fake-service-account.json";

describe("code generation modes", () => {
  it("generates school-prefixed random codes", async () => {
    const { buildPlaintextCodesForMode } = await import("../codeGenerationModes");
    const codes = buildPlaintextCodesForMode({
      schoolName: "Moonstar",
      numberOfCodes: 3,
      codeGenerationMode: "RANDOM",
    });

    expect(codes).toHaveLength(3);
    expect(codes.every((code) => code.plaintextCode.startsWith("MNSTR"))).toBe(true);
    expect(new Set(codes.map((code) => code.plaintextCode)).size).toBe(3);
  });

  it("generates predictable school-prefixed codes from student IDs", async () => {
    const { buildPlaintextCodesForMode } = await import("../codeGenerationModes");
    const codes = buildPlaintextCodesForMode({
      schoolName: "Moonstar",
      numberOfCodes: 3,
      codeGenerationMode: "STUDENT_IDS",
      studentIdentifiers: ["01", "02", "03"],
    });

    expect(codes.map((code) => code.plaintextCode)).toEqual(["MNSTR01", "MNSTR02", "MNSTR03"]);
    expect(codes.map((code) => code.studentIdentifier)).toEqual(["01", "02", "03"]);
  });

  it("rejects duplicate student IDs", async () => {
    const { buildPlaintextCodesForMode } = await import("../codeGenerationModes");
    expect(() =>
      buildPlaintextCodesForMode({
        schoolName: "Moonstar",
        numberOfCodes: 2,
        codeGenerationMode: "STUDENT_IDS",
        studentIdentifiers: ["01", "01"],
      })
    ).toThrow(/Duplicate student ID/);
  });
});
