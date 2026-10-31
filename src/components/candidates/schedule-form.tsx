"use client";

import { useActionState, useId, useState } from "react";
import { scheduleInterviews, type ScheduleState } from "@/app/actions/candidates";
import { SubmitButton } from "@/components/submit-button";
import { ROUND_TYPES, type RoundType } from "@/lib/interview/rounds";
import type { ProblemSummary } from "@/lib/problems/types";

export type RubricChoice = { id: string; name: string; isDefault: boolean };

type Props = {
  candidateId: string;
  /** Schedulable problems per round type (custom first). */
  problems: Record<RoundType, ProblemSummary[]>;
  /** Custom rubrics per round type; the built-in one is always offered. */
  rubrics: Record<RoundType, RubricChoice[]>;
  team: { user_id: string; display_name: string }[];
  me: string;
};

type Draft = {
  key: number;
  round_type: RoundType;
  problem: string;
  rubric: string;
  interviewers: string[];
  /** datetime-local value (no time zone); converted to an instant on submit. */
  local: string;
};

const MAX_ROUNDS = 6;

/** Schedule one round, or a loop of several (ADR 0012). */
export function ScheduleForm({ candidateId, problems, rubrics, team, me }: Props) {
  const [state, action] = useActionState<ScheduleState, FormData>(scheduleInterviews, { status: "idle" });
  const [nextKey, setNextKey] = useState(1);
  const defaults = (round: RoundType, key: number, interviewers = [me]): Draft => ({
    key,
    round_type: round,
    problem: problems[round][0]?.slug ?? "",
    rubric: rubrics[round].find((r) => r.isDefault)?.id ?? "builtin",
    interviewers,
    local: "",
  });
  const [rounds, setRounds] = useState<Draft[]>(() => [defaults("system_design", 0)]);
  const [loopName, setLoopName] = useState("");

  const update = (key: number, patch: Partial<Draft>) => setRounds((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = () => {
    // Suggest the next round type that isn't in the loop yet.
    const used = new Set(rounds.map((r) => r.round_type));
    const round = ROUND_TYPES.find((t) => !used.has(t.value))?.value ?? "system_design";
    setRounds((rs) => [...rs, defaults(round, nextKey)]);
    setNextKey((k) => k + 1);
  };

  const payload = JSON.stringify(
    rounds.map((r) => ({
      round_type: r.round_type,
      problem: r.problem,
      rubric: r.rubric,
      interviewers: r.interviewers,
      scheduled_at: r.local ? new Date(r.local).toISOString() : null,
    })),
  );
  const ready = rounds.every((r) => r.problem && r.interviewers.length >= 1);

  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="candidate" value={candidateId} />
      <input type="hidden" name="rounds" value={payload} />

      {rounds.length > 1 ? (
        <div className="field">
          <label htmlFor="loop_name" className="label">
            Loop name
          </label>
          <input
            id="loop_name"
            name="loop_name"
            className="input"
            maxLength={100}
            placeholder="Onsite, final round…"
            value={loopName}
            onChange={(e) => setLoopName(e.target.value)}
          />
          <p className="hint">The rounds are summarised together on the loop page.</p>
        </div>
      ) : null}

      <ol className="grid gap-4">
        {rounds.map((r, i) => (
          <RoundFields
            key={r.key}
            index={i}
            count={rounds.length}
            draft={r}
            problems={problems[r.round_type]}
            rubrics={rubrics[r.round_type]}
            team={team}
            me={me}
            onChange={(patch) => update(r.key, patch)}
            onRoundType={(round) => update(r.key, { ...defaults(round, r.key, r.interviewers) })}
            onRemove={() => setRounds((rs) => rs.filter((x) => x.key !== r.key))}
          />
        ))}
      </ol>

      {rounds.length < MAX_ROUNDS ? (
        <div>
          <button type="button" className="btn btn-ghost" onClick={add}>
            + Add another round
          </button>
        </div>
      ) : null}

      {state.status === "error" ? (
        <p role="alert" className="notice notice-error">
          {state.message}
        </p>
      ) : null}
      <div>
        <SubmitButton pendingLabel="Scheduling…" disabled={!ready}>
          {rounds.length > 1 ? `Schedule ${rounds.length} rounds` : "Schedule interview"}
        </SubmitButton>
      </div>
    </form>
  );
}

function RoundFields({
  index,
  count,
  draft,
  problems,
  rubrics,
  team,
  me,
  onChange,
  onRoundType,
  onRemove,
}: {
  index: number;
  count: number;
  draft: Draft;
  problems: ProblemSummary[];
  rubrics: RubricChoice[];
  team: Props["team"];
  me: string;
  onChange: (patch: Partial<Draft>) => void;
  onRoundType: (round: RoundType) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const toggle = (uid: string) => {
    const p = draft.interviewers;
    onChange({ interviewers: p.includes(uid) ? p.filter((x) => x !== uid) : p.length >= 2 ? [p[1], uid] : [...p, uid] });
  };
  return (
    <li className="grid gap-3 rounded-lg border border-grid p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{count > 1 ? `Round ${index + 1}` : "Round"}</span>
        {count > 1 ? (
          <button type="button" className="btn btn-ghost text-[0.85rem]" onClick={onRemove}>
            Remove
          </button>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="field">
          <label htmlFor={`${id}-type`} className="label">
            Type
          </label>
          <select id={`${id}-type`} className="input" value={draft.round_type} onChange={(e) => onRoundType(e.target.value as RoundType)}>
            {ROUND_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-rubric`} className="label">
            Rubric
          </label>
          <select id={`${id}-rubric`} className="input" value={draft.rubric} onChange={(e) => onChange({ rubric: e.target.value })}>
            <option value="builtin">Built-in{rubrics.some((r) => r.isDefault) ? "" : " (default)"}</option>
            {rubrics.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.isDefault ? " (default)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${id}-problem`} className="label">
          {draft.round_type === "behavioural" ? "Question set" : "Problem"}
        </label>
        <select id={`${id}-problem`} className="input" value={draft.problem} onChange={(e) => onChange({ problem: e.target.value })}>
          {problems.length === 0 ? <option value="">No problems for this round yet</option> : null}
          {problems.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.custom ? "★ " : ""}
              {p.title}
            </option>
          ))}
        </select>
        <p className="hint">★ your team&apos;s own. Built-in ones suited to the candidate&apos;s level come first.</p>
      </div>
      <fieldset className="grid gap-2">
        <legend className="label mb-1">Interviewers (one or two)</legend>
        <div className="flex flex-wrap gap-2">
          {team.map((m) => (
            <label key={m.user_id} className="option min-w-36 py-1.5!">
              <input type="checkbox" checked={draft.interviewers.includes(m.user_id)} onChange={() => toggle(m.user_id)} />
              <span className="option-title">
                {m.display_name}
                {m.user_id === me ? " (you)" : ""}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field max-w-xs">
        <label htmlFor={`${id}-when`} className="label">
          When <span className="faint font-normal">(optional; needed for calendar invites)</span>
        </label>
        <input id={`${id}-when`} type="datetime-local" className="input" value={draft.local} onChange={(e) => onChange({ local: e.target.value })} />
      </div>
    </li>
  );
}
