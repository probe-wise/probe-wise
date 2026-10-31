import "server-only";
import type { EmailMessage } from "@/lib/email";

// Plain, short transactional emails. Every one has a text version.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(heading: string, paragraphs: string[], cta?: { label: string; url: string }) {
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,sans-serif;color:#1f2937;line-height:1.5;max-width:560px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 16px">${esc(heading)}</h2>
${paragraphs.map((p) => `<p style="margin:0 0 12px">${esc(p)}</p>`).join("\n")}
${cta ? `<p style="margin:20px 0"><a href="${esc(cta.url)}" style="background:#2563eb;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600">${esc(cta.label)}</a></p><p style="font-size:13px;color:#6b7280">Or paste this link into your browser: ${esc(cta.url)}</p>` : ""}
<p style="font-size:12px;color:#9ca3af;margin-top:24px">Sent by Probewise.</p></body></html>`;
  const text = [heading, "", ...paragraphs, ...(cta ? ["", `${cta.label}: ${cta.url}`] : [])].join("\n");
  return { html, text };
}

export const when = (iso: string, timeZone?: string) =>
  new Date(iso).toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: timeZone ?? "UTC", timeZoneName: "short" });

export function teamInviteEmail(o: { to: string; org: string; inviter: string; role: string; url: string; expires: string }): EmailMessage {
  const body = layout(`Join ${o.org} on Probewise`, [
    `${o.inviter} invited you to ${o.org}'s hiring workspace as ${o.role === "admin" ? "an admin" : "an interviewer"}.`,
    `Sign in with ${o.to} to accept. The invite works once and expires on ${new Date(o.expires).toLocaleDateString("en-GB", { dateStyle: "long" })}.`,
  ], { label: "Accept the invite", url: o.url });
  return { to: [o.to], subject: `${o.inviter} invited you to ${o.org} on Probewise`, ...body };
}

export function candidateLinkEmail(o: { to: string; org: string; name: string; url: string; expires: string; interviewer: string }): EmailMessage {
  const body = layout(`Your interview with ${o.org}`, [
    `Hi ${o.name}, ${o.interviewer} is ready for your interview. Open the link below to join the interview room. You don't need an account.`,
    "Use a laptop or desktop with a recent browser. The interview is recorded (whiteboard, code, notes, chat and timings) for the hiring team.",
    `The link works once and expires ${when(o.expires)}.`,
  ], { label: "Join the interview", url: o.url });
  return { to: [o.to], subject: `Join your interview with ${o.org}`, ...body };
}

export function interviewScheduledEmail(o: {
  to: string[];
  org: string;
  title: string;
  start: string;
  minutes: number;
  forCandidate: boolean;
  candidateName: string;
  roomUrl?: string;
  meetingUrl?: string | null;
  ics?: string;
}): EmailMessage {
  const paragraphs = o.forCandidate
    ? [
        `Hi ${o.candidateName}, your ${o.title.toLowerCase()} interview with ${o.org} is scheduled for ${when(o.start)} (${o.minutes} minutes).`,
        "When it starts, your interviewer will send you a link to the interview room. You won't need an account.",
        ...(o.meetingUrl ? [`Video call: ${o.meetingUrl}`] : []),
      ]
    : [
        `You're interviewing ${o.candidateName}: ${o.title}, ${when(o.start)} (${o.minutes} minutes).`,
        "Open the interview room a few minutes early and send the candidate their link from the lobby.",
        ...(o.meetingUrl ? [`Video call: ${o.meetingUrl}`] : []),
      ];
  const body = layout(o.forCandidate ? `Your interview with ${o.org}` : `Interview: ${o.candidateName}`, paragraphs, o.roomUrl && !o.forCandidate ? { label: "Open the interview room", url: o.roomUrl } : undefined);
  return {
    to: o.to,
    subject: o.forCandidate ? `Interview with ${o.org}: ${when(o.start)}` : `Interview: ${o.candidateName} (${o.title})`,
    ...body,
    attachments: o.ics ? [{ filename: "invite.ics", content: o.ics, contentType: "text/calendar; charset=utf-8; method=REQUEST" }] : undefined,
  };
}

export function interviewCancelledEmail(o: { to: string[]; org: string; title: string; start: string; ics?: string }): EmailMessage {
  const body = layout("Interview cancelled", [`The ${o.title} interview with ${o.org} on ${when(o.start)} has been cancelled.`]);
  return {
    to: o.to,
    subject: `Cancelled: interview with ${o.org}`,
    ...body,
    attachments: o.ics ? [{ filename: "cancel.ics", content: o.ics, contentType: "text/calendar; charset=utf-8; method=CANCEL" }] : undefined,
  };
}
