"use client";

import { roundOf, type Rubric } from "@/lib/interview/rounds";
import type { InterviewerGuide as Guide } from "@/lib/problems/types";

type Props = {
  guide: Guide;
  phase: string | null;
  /** The round type: decides the phases and the general follow-ups. */
  roundType?: string | null;
  /** The rubric the interview is graded on (its aspect for the current phase is shown, if it has one). */
  rubric?: Rubric;
  /** Stage a question in the chat box (sent as a probe). Omitted when read-only. */
  onPickProbe?: (text: string) => void;
};

const REFERENCE_TITLE = { board: "Reference design", code: "Reference approach", conversation: "What good answers cover" };

/** The confidential interviewer guide. Only ever rendered for interviewers (ADR 0004). */
export function InterviewerGuide({ guide, phase, roundType, rubric, onPickProbe }: Props) {
  const round = roundOf(roundType);
  const current = round.phases.find((p) => p.value === phase) ?? round.phases[0];
  const aspect = (rubric ?? round.rubric).aspects.find((a) => a.key === current.value);
  const generic = round.probes[current.value] ?? [];

  return (
    <div className="grid gap-5 text-[0.9rem]">
      <section className="grid gap-1.5">
        <h3 className="text-[0.95rem]!">Now: {current.label}</h3>
        <p className="muted">{current.goal}</p>
        {aspect?.solid.length ? (
          <>
            <p className="faint">A 3 (“solid”) here looks like:</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {aspect.solid.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      {guide.probes.length ? (
        <section className="grid gap-2">
          <h3 className="text-[0.95rem]!">{round.workspace === "conversation" ? "Questions" : "Problem follow-ups"}</h3>
          <ProbeList items={guide.probes} onPick={onPickProbe} />
        </section>
      ) : null}

      {generic.length ? (
        <section className="grid gap-2">
          <h3 className="text-[0.95rem]!">General {current.label.toLowerCase()} questions</h3>
          <ProbeList items={generic} onPick={onPickProbe} />
        </section>
      ) : null}

      {guide.clarifications.length ? (
        <section className="grid gap-1.5">
          <h3 className="text-[0.95rem]!">If they ask…</h3>
          <dl className="grid gap-1.5">
            {guide.clarifications.map((c) => (
              <div key={c.q}>
                <dt className="font-semibold">{c.q}</dt>
                <dd className="muted">{c.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {guide.scale.length ? (
        <section className="grid gap-1.5">
          <h3 className="text-[0.95rem]!">{round.workspace === "code" ? "Constraints to give" : "Numbers to give"}</h3>
          <List items={guide.scale} />
        </section>
      ) : null}

      {guide.strongSignals.length || guide.pitfalls.length ? (
        <section className="grid gap-1.5">
          {guide.strongSignals.length ? (
            <>
              <h3 className="text-[0.95rem]!">Strong signals</h3>
              <List items={guide.strongSignals} />
            </>
          ) : null}
          {guide.pitfalls.length ? (
            <>
              <h3 className="mt-2 text-[0.95rem]!">Common pitfalls</h3>
              <List items={guide.pitfalls} />
            </>
          ) : null}
        </section>
      ) : null}

      {guide.reference.length ? (
        <details>
          <summary className="cursor-pointer font-semibold">{REFERENCE_TITLE[round.workspace]}</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {guide.reference.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-0.5 pl-5">
      {items.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ul>
  );
}

function ProbeList({ items, onPick }: { items: string[]; onPick?: (text: string) => void }) {
  return (
    <ul className="grid gap-1.5">
      {items.map((q) => (
        <li key={q}>
          {onPick ? (
            <button
              type="button"
              className="w-full rounded-md border border-grid bg-board-raised px-2.5 py-1.5 text-left text-[0.88rem] hover:border-probe"
              onClick={() => onPick(q)}
              title="Put this question in the chat box"
            >
              {q}
            </button>
          ) : (
            <span className="text-[0.88rem]">{q}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
