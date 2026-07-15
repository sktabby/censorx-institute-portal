import { describe, it, expect } from "vitest";

// ORG_CODE_PEPPER must be set before importing env-dependent modules.
process.env.ORG_CODE_PEPPER = "a-very-long-test-pepper-value-1234567890";
process.env.CLIENT_ORIGINS = "http://localhost:5173";
process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/fake-service-account.json";

describe("codeCryptoService", () => {
  it("generates codes in the expected format", async () => {
    const { generateActivationCode } = await import("../codeCryptoService");
    const code = generateActivationCode();
    expect(code).toMatch(/^CX-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it("excludes ambiguous characters (I, L, O, 0, 1)", async () => {
    const { generateActivationCode } = await import("../codeCryptoService");
    for (let i = 0; i < 50; i++) {
      const code = generateActivationCode();
      expect(code).not.toMatch(/[ILO01]/);
    }
  });

  it("normalizes codes by stripping whitespace/hyphens and uppercasing", async () => {
    const { normalizeActivationCode } = await import("../codeCryptoService");
    expect(normalizeActivationCode(" cx-7k3m-q9td-4pwa-r8f2 ")).toBe("CX7K3MQ9TD4PWAR8F2");
  });

  it("produces a stable HMAC hash for the same normalized code + pepper", async () => {
    const { hashActivationCode, normalizeActivationCode } = await import("../codeCryptoService");
    const normalized = normalizeActivationCode("CX-7K3M-Q9TD-4PWA-R8F2");
    const hash1 = hashActivationCode(normalized);
    const hash2 = hashActivationCode(normalized);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces different hashes for different codes", async () => {
    const { hashActivationCode } = await import("../codeCryptoService");
    expect(hashActivationCode("AAAA")).not.toBe(hashActivationCode("BBBB"));
  });

  it("extracts last 4 characters from the normalized code", async () => {
    const { lastFourOfCode, normalizeActivationCode } = await import("../codeCryptoService");
    const normalized = normalizeActivationCode("CX-7K3M-Q9TD-4PWA-R8F2");
    expect(lastFourOfCode(normalized)).toBe("R8F2");
  });
});
