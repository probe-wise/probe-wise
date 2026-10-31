import "server-only";
import type { EmailMessage } from "@/lib/email";

// Resend's REST API (https://resend.com/docs/api-reference/emails/send-email).
export async function sendWithResend(from: string, m: EmailMessage) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from,
      to: m.to,
      subject: m.subject,
      text: m.text,
      html: m.html,
      reply_to: m.replyTo,
      attachments: m.attachments?.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content, "utf8").toString("base64"),
        content_type: a.contentType,
      })),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
}
