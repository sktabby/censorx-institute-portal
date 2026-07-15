import path from "node:path";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required in server/.env`);
  }
  return value;
}

function maskPassword(value: string) {
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}${"*".repeat(Math.max(4, value.length - 4))}${value.slice(-2)}`;
}

async function main() {
  const host = requiredEnv("SMTP_HOST");
  const port = Number(requiredEnv("SMTP_PORT"));
  const user = requiredEnv("SMTP_USER");
  const pass = requiredEnv("SMTP_PASSWORD");
  const from = requiredEnv("SMTP_FROM_EMAIL");
  const secure = port === 465;

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("SMTP_PORT must be a positive integer.");
  }

  const config = {
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
  };

  console.log("SMTP transporter config:", {
    host,
    port,
    secure,
    auth: {
      user,
      pass: maskPassword(pass),
    },
  });

  const transporter = nodemailer.createTransport(config);

  try {
    const verifyResult = await transporter.verify();
    console.log("SMTP verify result:", verifyResult);
  } catch (err) {
    console.error("SMTP verify failed with full error:", err);
    throw err;
  }

  try {
    const sendResult = await transporter.sendMail({
      from,
      to: user,
      subject: "CensorX SMTP test",
      text: "This is a one-off SMTP test email from server/scripts/testSmtp.ts.",
    });
    console.log("SMTP sendMail success:", sendResult);
  } catch (err) {
    console.error("SMTP sendMail failed with full error:", err);
    throw err;
  }
}

main().catch((err) => {
  console.error("SMTP test failed:", err);
  process.exit(1);
});
