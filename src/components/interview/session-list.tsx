import Link from "next/link";
import { roundLabel } from "@/lib/interview/rounds";
import type { SessionListItem } from "@/lib/interview/session-dal";

const STATUS: Record<SessionListItem["status"], string> = {
  lobby: "Scheduled",
  in_progress: "In progress",
  completed: "Finished",
  cancelled: "Cancelled",
};

const date = (iso: string) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
const dateTime = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

/** Interviews as links: open ones go to the room, finished ones to the review. */
export function SessionList({
  sessions,
  empty,
  showCandidate = true,
}: {
  sessions: SessionListItem[];
  empty: React.ReactNode;
  showCandidate?: boolean;
}) {
  if (!sessions.length) return <>{empty}</>;
  return (
    <ul className="grid gap-2">
      {sessions.map((s) => {
        const open = s.status === "lobby" || s.status === "in_progress";
        const href = s.status === "completed" ? `/interview/${s.id}/review` : `/interview/${s.id}`;
        const when = s.status === "lobby" && s.scheduled_at ? dateTime(s.scheduled_at) : date(s.started_at ?? s.created_at);
        return (
          <li key={s.id}>
            <Link
              href={href}
              className={`grid gap-0.5 rounded-lg border px-3 py-2 hover:border-ink-faint ${
                open ? "border-marker bg-marker-wash" : "border-grid bg-board-raised"
              } ${s.status === "cancelled" ? "opacity-70" : ""}`}
            >
              <span className="font-semibold">
                {showCandidate && s.candidate ? `${s.candidate.full_name} · ` : ""}
                {s.problem_title}
              </span>
              <span className="faint">
                {roundLabel(s.round_type)} · {STATUS[s.status]}
                {s.end_reason === "ended_early" ? " early" : ""} · {when}
                {s.interviewers.length ? ` · ${s.interviewers.map((i) => i.display_name).join(", ")}` : ""}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
