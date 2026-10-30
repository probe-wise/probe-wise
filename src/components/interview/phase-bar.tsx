"use client";

import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/interview/metrics";
import { PHASES, nextPhase, phaseIndex, phaseLabel, type PhasePlan } from "@/lib/interview/phases";

/** Server-aligned clock: `offsetMs` is server time minus local time, measured at page load. */
export function useServerNow(offsetMs: number, tickMs = 1000) {
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offsetMs), tickMs);
    return () => clearInterval(id);
  }, [offsetMs, tickMs]);
  return now;
}

type Props = {
  phase: string | null;
  phaseStartedAt: string | null;
  startedAt: string | null;
  plan: PhasePlan;
  now: number;
  canControl: boolean;
  busy: boolean;
  onChangePhase: (phase: string) => void;
};

export function PhaseBar({ phase, phaseStartedAt, startedAt, plan, now, canControl, busy, onChangePhase }: Props) {
  const current = phaseIndex(phase);
  const plannedMs = phase ? (plan[phase as keyof PhasePlan] ?? 0) * 60_000 : 0;
  const inPhaseMs = phaseStartedAt ? now - new Date(phaseStartedAt).getTime() : 0;
  const remainingMs = plannedMs - inPhaseMs;
  const totalMs = startedAt ? now - new Date(startedAt).getTime() : 0;
  const next = nextPhase(phase);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <ol className="flex flex-wrap items-center gap-1" aria-label="Interview phases">
        {PHASES.map((p, i) => {
          const state = i < current ? "done" : i === current ? "current" : "todo";
          return (
            <li key={p.value}>
              <button
                type="button"
                disabled={!canControl || busy || state === "current"}
                onClick={() => onChangePhase(p.value)}
                aria-current={state === "current" ? "step" : undefined}
                title={canControl ? `Go to ${p.label}` : p.goal}
                className={`phase-step phase-${state}`}
              >
                <span className="tabular-nums">{i + 1}</span>
                <span className="hidden xl:inline">{p.label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="flex items-baseline gap-3" aria-live="off">
        <span className="font-semibold">{phaseLabel(phase)}</span>
        <span
          className={`tabular-nums font-semibold ${remainingMs < 0 ? "text-probe" : "text-ink"}`}
          title="Time left in this phase"
        >
          {remainingMs < 0 ? `+${formatDuration(-remainingMs)} over` : `${formatDuration(remainingMs)} left`}
        </span>
        <span className="faint tabular-nums" title="Total interview time">
          {formatDuration(totalMs)} total
        </span>
      </div>

      {canControl && next ? (
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onChangePhase(next)}>
          Next: {phaseLabel(next)} →
        </button>
      ) : null}
    </div>
  );
}
