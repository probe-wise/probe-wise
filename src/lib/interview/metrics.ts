// Session analytics computed from the audit log. Pure, so the review page, tests and
// milestone 3's scorer all derive the same numbers from the same events.

import type { SessionEvent } from "@/lib/interview/events";
import { PHASE_VALUES, type Phase, type PhasePlan } from "@/lib/interview/phases";

export type PhaseStats = {
  phase: Phase;
  plannedMs: number;
  actualMs: number;
  visits: number;
  probes: number;
  chatMessages: number;
  notesEdits: number;
  boardEdits: number;
};

export type SessionMetrics = {
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  plannedMs: number;
  phases: PhaseStats[];
  /** Phase order as it actually happened (repeats when someone went back). */
  path: Phase[];
  firstBoardEditMs: number | null;
  probes: number;
  chatMessages: number;
  byParticipant: Record<string, { boardEdits: number; chatMessages: number; probes: number; notesEdits: number }>;
};

const ms = (iso: string) => new Date(iso).getTime();

export function computeMetrics(
  events: readonly SessionEvent[],
  plan: PhasePlan,
  now: string = new Date().toISOString(),
): SessionMetrics {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const phases = new Map<Phase, PhaseStats>(
    PHASE_VALUES.map((p) => [
      p,
      { phase: p, plannedMs: plan[p] * 60_000, actualMs: 0, visits: 0, probes: 0, chatMessages: 0, notesEdits: 0, boardEdits: 0 },
    ]),
  );
  const byParticipant: SessionMetrics["byParticipant"] = {};
  const path: Phase[] = [];

  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let current: { phase: Phase; since: string } | null = null;
  let firstBoardEditMs: number | null = null;

  const closeCurrent = (at: string) => {
    if (!current) return;
    phases.get(current.phase)!.actualMs += Math.max(0, ms(at) - ms(current.since));
    current = null;
  };

  for (const e of sorted) {
    const who = e.participant_id ? (byParticipant[e.participant_id] ??= { boardEdits: 0, chatMessages: 0, probes: 0, notesEdits: 0 }) : null;
    const stats = e.phase ? phases.get(e.phase) : undefined;
    switch (e.type) {
      case "session.started":
        startedAt = e.created_at;
        break;
      case "phase.changed": {
        const to = e.payload.to as Phase;
        if (!phases.has(to)) break;
        closeCurrent(e.created_at);
        current = { phase: to, since: e.created_at };
        phases.get(to)!.visits += 1;
        path.push(to);
        break;
      }
      case "session.ended":
        closeCurrent(e.created_at);
        if (startedAt) endedAt = e.created_at;
        break;
      case "probe.asked":
        if (stats) stats.probes += 1;
        if (who) who.probes += 1;
        break;
      case "chat.message":
        if (stats) stats.chatMessages += 1;
        if (who) who.chatMessages += 1;
        break;
      case "notes.updated":
        if (stats) stats.notesEdits += 1;
        if (who) who.notesEdits += 1;
        break;
      case "board.updated":
        if (stats) stats.boardEdits += 1;
        if (who) who.boardEdits += 1;
        if (firstBoardEditMs === null && startedAt) firstBoardEditMs = ms(e.created_at) - ms(startedAt);
        break;
    }
  }
  // Still running: count the current phase up to now.
  if (current && !endedAt) closeCurrent(now);

  const all = [...phases.values()];
  return {
    startedAt,
    endedAt,
    durationMs: startedAt ? ms(endedAt ?? now) - ms(startedAt) : null,
    plannedMs: all.reduce((sum, p) => sum + p.plannedMs, 0),
    phases: all,
    path,
    firstBoardEditMs,
    probes: all.reduce((sum, p) => sum + p.probes, 0),
    chatMessages: all.reduce((sum, p) => sum + p.chatMessages, 0),
    byParticipant,
  };
}

/** "12:05" style durations for timers and tables. */
export function formatDuration(totalMs: number) {
  const negative = totalMs < 0;
  const s = Math.floor(Math.abs(totalMs) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  const body = h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
  return negative ? `-${body}` : body;
}
