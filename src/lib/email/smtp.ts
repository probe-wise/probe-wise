import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import type { EmailMessage } from "@/lib/email";

let transport: Transporter | null = null;

function smtp() {
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    connectionTimeout: 10_000,
  });
  return transport;
}

export async function sendWithSmtp(from: string, m: EmailMessage) {
  // A calendar invite also goes in as the text/calendar alternative, so mail clients show RSVP buttons.
  const invite = m.attachments?.find((a) => a.contentType.startsWith("text/calendar"));
  await smtp().sendMail({
    from,
    to: m.to,
    subject: m.subject,
    text: m.text,
    html: m.html,
    replyTo: m.replyTo,
    icalEvent: invite ? { method: /METHOD:(\w+)/.exec(invite.content)?.[1] ?? "REQUEST", content: invite.content } : undefined,
    attachments: m.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
  });
}
