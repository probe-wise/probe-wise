"use client";

import { GENERIC_PROBES } from "@/lib/interview/probes";
import { PHASES, type Phase } from "@/lib/interview/phases";
import { RUBRIC } from "@/lib/interview/rubric";
import type { InterviewerGuide as Guide } from "@/lib/problems/types";

type Props = {
  guide: Guide;
  phase: string | null;
  /** Stage a question in the chat box (sent as a probe). Omitted when read-only. */
  onPickProbe?: (text: string) => void;
};

/** The confidential interviewer guide. Only ever rendered for interviewers (ADR 0004). */
export function InterviewerGuide({ guide, phase, onPickProbe }: Props) {
  const current = PHASES.find((p) => p.value === phase) ?? PHASES[0];
  const rubric = RUBRIC[current.value as Phase];

  return (
    <div className="grid gap-5 text-[0.9rem]">
      <section className="grid gap-1.5">
        <h3 className="text-[0.95rem]!">Now: {current.label}</h3>
        <p className="muted">{current.goal}</p>
        <p className="faint">A 3 (“solid”) here looks like:</p>
        <ul className="list-disc space-y-0.5 pl-5">
          {rubric.solid.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>

      <section className="grid gap-2">
        <h3 className="text-[0.95rem]!">Problem follow-ups</h3>
        <ProbeList items={guide.probes} onPick={onPickProbe} />
      </section>

      <section className="grid gap-2">
        <h3 className="text-[0.95rem]!">General {current.label.toLowerCase()} questions</h3>
        <ProbeList items={GENERIC_PROBES[current.value as Phase]} onPick={onPickProbe} />
      </section>

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

      <section className="grid gap-1.5">
        <h3 className="text-[0.95rem]!">Numbers to give</h3>
        <ul className="list-disc space-y-0.5 pl-5">
          {guide.scale.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>

      <section className="grid gap-1.5">
        <h3 className="text-[0.95rem]!">Strong signals</h3>
        <ul className="list-disc space-y-0.5 pl-5">
          {guide.strongSignals.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <h3 className="mt-2 text-[0.95rem]!">Common pitfalls</h3>
        <ul className="list-disc space-y-0.5 pl-5">
          {guide.pitfalls.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>

      <details>
        <summary className="cursor-pointer font-semibold">Reference design</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {guide.reference.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </details>
    </div>
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
