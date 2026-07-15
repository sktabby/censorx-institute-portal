import { ApiError } from "../src/middleware/errorHandler";
import { createOrganization } from "../src/services/organizationService";

function getEmailArg() {
  return process.argv.find((arg) => arg.startsWith("--email="))?.split("=")[1];
}

async function main() {
  const email = getEmailArg();
  if (!email) {
    console.error("Usage: npm --workspace server exec tsx scripts/reproDuplicateSchoolEmail.ts -- --email=<existing-auth-email>");
    process.exit(1);
  }

  try {
    await createOrganization(
      {
        name: "Duplicate Email Repro School",
        contactName: "Manual Repro",
        contactEmail: email,
        contactPhone: "9999999999",
      },
      "manual-repro"
    );

    console.error("Unexpected success. Use an email that already exists in Firebase Auth.");
    process.exit(1);
  } catch (err) {
    if (err instanceof ApiError) {
      console.log(`Rejected with ApiError: ${err.status} ${err.code} - ${err.message}`);
      process.exit(0);
    }

    console.error("Rejected with a non-ApiError:", err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unexpected uncaught script failure:", err);
  process.exit(1);
});
