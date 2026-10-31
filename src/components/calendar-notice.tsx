// What happened with calendar invites after scheduling (read from the redirect's query).

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function CalendarNotice({ params }: { params: Params }) {
  const scheduled = Number(one(params.scheduled) ?? 0);
  if (!scheduled) return null;
  const calendar = one(params.calendar);
  const note = one(params.calendar_note)?.slice(0, 300);
  const what = scheduled === 1 ? "Interview scheduled." : `${scheduled} rounds scheduled.`;
  const invites =
    calendar === "google"
      ? "Google Calendar invites were sent, with a Meet link."
      : calendar === "ics"
        ? "Calendar invites were emailed."
        : note
          ? `Calendar: ${note}`
          : "";
  return (
    <p className={`notice ${calendar === "failed" ? "notice-error" : "notice-success"}`} role="status">
      {what} {invites}
    </p>
  );
}
