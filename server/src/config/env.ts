import { z } from "zod";
import "dotenv/config";

const optionalString = z.preprocess((value) => (value === "" ? undefined : value), z.string().optional());
const optionalEmail = z.preprocess((value) => (value === "" ? undefined : value), z.string().email().optional());
const optionalPort = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.coerce.number().int().positive().optional()
);

/**
 * All backend environment variables are validated at process startup.
 * If a required variable is missing/invalid, the process fails fast
 * with a clear error instead of failing later at request time.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(8080),
    CLIENT_ORIGINS: z.string().min(1, "CLIENT_ORIGINS is required (comma separated list)"),

    GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
    FIREBASE_PROJECT_ID: z.string().optional(),
    FIREBASE_CLIENT_EMAIL: z.string().optional(),
    FIREBASE_PRIVATE_KEY: z.string().optional(),

    ORG_CODE_PEPPER: z
      .string()
      .min(32, "ORG_CODE_PEPPER must be a long, high-entropy secret (>=32 chars)"),

    SMTP_HOST: optionalString,
    SMTP_PORT: optionalPort,
    SMTP_USER: optionalString,
    SMTP_PASSWORD: optionalString,
    SMTP_FROM_EMAIL: optionalEmail,

    APP_CHECK_ENFORCED: z
      .string()
      .default("false")
      .transform((v) => v === "true"),

    ALLOW_ADMIN_BOOTSTRAP: z
      .string()
      .default("false")
      .transform((v) => v === "true"),

    TRUST_PROXY: z.string().default("1"),
    LOG_LEVEL: z.string().default("info"),

    /**
     * Expiry sweep: materialises EXPIRED onto past-due subscriptions,
     * licenses and codes. Read-time projection remains the fallback, so
     * disabling the sweep degrades data freshness but never correctness.
     */
    EXPIRY_SWEEP_ENABLED: z
      .string()
      .default("true")
      .transform((v) => v === "true"),
    /**
     * Cron is evaluated in the SERVER's local timezone, which on Render is UTC.
     *
     * Default "45 21 * * *" = 21:45 UTC = 03:15 AM IST (Asia/Kolkata) the NEXT
     * day. IST is UTC+5:30 with no DST, so this holds year-round.
     *
     * Do NOT "correct" this to "15 3 * * *" — that reads as 3:15 AM but would
     * actually fire at 08:45 IST, in the middle of the school working day.
     */
    EXPIRY_SWEEP_CRON: z.string().default("45 21 * * *"),
    EXPIRY_SWEEP_RUN_ON_BOOT: z
      .string()
      .default("false")
      .transform((v) => v === "true"),
  })
  .superRefine((val, ctx) => {
    const hasServiceAccountFile = !!val.GOOGLE_APPLICATION_CREDENTIALS;
    const hasDiscreteCreds =
      !!val.FIREBASE_PROJECT_ID && !!val.FIREBASE_CLIENT_EMAIL && !!val.FIREBASE_PRIVATE_KEY;

    if (!hasServiceAccountFile && !hasDiscreteCreds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Provide either GOOGLE_APPLICATION_CREDENTIALS (local dev) or " +
          "FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY (production).",
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;

const smtpKeys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM_EMAIL"] as const;
const missingSmtpKeys = smtpKeys.filter((key) => !parsed.data[key]);
if (missingSmtpKeys.length > 0) {
  // eslint-disable-next-line no-console
  console.warn(`SMTP email is not fully configured. Missing: ${missingSmtpKeys.join(", ")}`);
}
