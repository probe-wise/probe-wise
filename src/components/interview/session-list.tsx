import Link from "next/link";
import type { SessionListItem } from "@/lib/interview/session-dal";

const STATUS: Record<SessionListItem["status"], string> = {
  lobby: "Waiting to start",
  in_progress: "In progress",
  completed: "Finished",
  cancelled: "Cancelled",
};

const date = (iso: string) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

/** Sessions as links: open ones go to the room, finished ones to the review. */
export function SessionList({ sessions, empty }: { sessions: SessionListItem[]; empty: React.ReactNode }) {
  if (!sessions.length) return <>{empty}</>;
  return (
    <ul className="grid gap-2">
      {sessions.map((s) => {
        const open = s.status === "lobby" || s.status === "in_progress";
        const href = s.status === "completed" ? `/interview/${s.id}/review` : `/interview/${s.id}`;
        return (
          <li key={s.id}>
            <Link
              href={href}
              className={`grid gap-0.5 rounded-lg border px-3 py-2 hover:border-ink-faint ${
                open ? "border-marker bg-marker-wash" : "border-grid bg-board-raised"
              } ${s.status === "cancelled" ? "opacity-70" : ""}`}
            >
              <span className="font-semibold">{s.problem_title}</span>
              <span className="faint">
                {STATUS[s.status]}
                {s.end_reason === "ended_early" ? " early" : ""} · {s.mode === "peer" ? "Peer" : "Solo"} · You were the{" "}
                {s.my_role} · {date(s.created_at)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
