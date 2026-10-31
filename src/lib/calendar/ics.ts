// iCalendar (RFC 5545) invites, for workspaces that don't use Google Calendar.
// Pure, so it's unit-tested.

export type IcsEvent = {
  uid: string;
  /** Increase on every change so calendars apply updates and cancellations. */
  sequence: number;
  method: "REQUEST" | "CANCEL";
  start: Date;
  minutes: number;
  summary: string;
  description: string;
  url?: string;
  organizer: { name: string; email: string };
  attendees: { name?: string; email: string }[];
  now?: Date;
};

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const text = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const param = (s: string) => `"${s.replace(/"/g, "'")}"`;

/** Lines longer than 75 octets are folded with CRLF + space. */
function fold(line: string) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let chunk = "";
  for (const ch of line) {
    if (Buffer.byteLength(chunk + ch, "utf8") > (out.length ? 74 : 75)) {
      out.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  out.push(chunk);
  return out.join("\r\n ");
}

export function buildIcs(e: IcsEvent) {
  const end = new Date(e.start.getTime() + e.minutes * 60_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Probewise//Interviews//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${e.method}`,
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `SEQUENCE:${e.sequence}`,
    `DTSTAMP:${stamp(e.now ?? new Date())}`,
    `DTSTART:${stamp(e.start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${text(e.summary)}`,
    `DESCRIPTION:${text(e.description)}`,
    ...(e.url ? [`URL:${e.url}`] : []),
    `ORGANIZER;CN=${param(e.organizer.name)}:mailto:${e.organizer.email}`,
    ...e.attendees.map(
      (a) => `ATTENDEE;${a.name ? `CN=${param(a.name)};` : ""}ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`,
    ),
    `STATUS:${e.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
