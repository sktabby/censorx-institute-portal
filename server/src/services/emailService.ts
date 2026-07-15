import nodemailer from "nodemailer";
import { env } from "../config/env";
import { ApiError } from "../middleware/errorHandler";

function assertSmtpConfigured() {
  if (!env.SMTP_HOST || !env.SMTP_PORT || !env.SMTP_USER || !env.SMTP_PASSWORD || !env.SMTP_FROM_EMAIL) {
    throw new ApiError(
      503,
      "SMTP_NOT_CONFIGURED",
      "SMTP email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM_EMAIL."
    );
  }
}

function createTransporter() {
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASSWORD,
    },
  });
}

export async function sendSchoolAdminWelcomeEmail(input: { to: string; tempPassword: string }) {
  assertSmtpConfigured();

  const transporter = createTransporter();

  await transporter.sendMail({
    from: env.SMTP_FROM_EMAIL,
    to: input.to,
    subject: "CensorX.ai Institute Partnership login credentials",
    text:
      "You are registered with CensorX.ai Institute Partnership.\n\n" +
      `Your temporary login credentials:\nEmail: ${input.to}\nPassword: ${input.tempPassword}\n\n` +
      "Please log in and change your password.",
  });
}

export async function sendActivationCodesEmail(input: {
  to: string;
  schoolName: string;
  batchName: string;
  attachment: { filename: string; content: Buffer };
}) {
  assertSmtpConfigured();

  const transporter = createTransporter();
  await transporter.sendMail({
    from: env.SMTP_FROM_EMAIL,
    to: input.to,
    subject: `CensorX Activation Codes — ${input.schoolName} — ${input.batchName}`,
    text:
      `Attached are the activation codes for ${input.batchName} at ${input.schoolName}.\n\n` +
      "Please distribute these to your students. Each code is single-use and cannot be recovered after distribution — keep this file secure.",
    attachments: [
      {
        filename: input.attachment.filename,
        content: input.attachment.content,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    ],
  });
}
