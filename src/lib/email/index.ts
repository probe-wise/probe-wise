import "server-only";

// Outgoing email, behind one interface (ADR 0013). Pick a provider with EMAIL_PROVIDER:
//   resend: RESEND_API_KEY
//   smtp:   SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS, SMTP_SECURE ("true" for port 465)
// Both need EMAIL_FROM, e.g. "Acme Hiring <hiring@acme.com>". With nothing set, email is
// off and the app shows links to copy instead.

export type Attachment = { filename: string; content: string; contentType: string };
export type EmailMessage = {
  to: string[];
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  attachments?: Attachment[];
};

type Provider = "resend" | "smtp";

export function emailProvider(): Provider | null {
  const p = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (!process.env.EMAIL_FROM?.trim()) return null;
  if (p === "resend" && process.env.RESEND_API_KEY?.trim()) return "resend";
  if (p === "smtp" && process.env.SMTP_HOST?.trim()) return "smtp";
  return null;
}

export const isEmailConfigured = () => emailProvider() !== null;

export class EmailError extends Error {}

/** Sends one message. Throws EmailError (safe to show) when sending fails. */
export async function sendEmail(message: EmailMessage) {
  const provider = emailProvider();
  if (!provider) throw new EmailError("Email isn't set up for this workspace.");
  const to = [...new Set(message.to.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  if (!to.length) return;
  const from = process.env.EMAIL_FROM!.trim();
  try {
    if (provider === "resend") {
      const { sendWithResend } = await import("@/lib/email/resend");
      await sendWithResend(from, { ...message, to });
    } else {
      const { sendWithSmtp } = await import("@/lib/email/smtp");
      await sendWithSmtp(from, { ...message, to });
    }
  } catch (err) {
    console.error(`email via ${provider} failed`, err);
    throw new EmailError("We couldn't send the email. Check the email settings and try again.");
  }
}
