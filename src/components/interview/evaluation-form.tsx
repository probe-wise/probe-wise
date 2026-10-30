"use client";

import { useState, useTransition } from "react";
import { saveEvaluation, type EvaluationState } from "@/app/actions/interview";
import type { SessionEvaluationRow } from "@/lib/database.types";
import { PHASES, type Phase } from "@/lib/interview/phases";
import { RECOMMENDATIONS, RUBRIC, SCORES, type Recommendation, type Scores } from "@/lib/interview/rubric";

type Props = {
  sessionId: string;
  kind: "scorecard" | "self";
  draft: SessionEvaluationRow | null;
  /** Phases the session actually reached; others default to "not reached". */
  reached: Phase[];
};

export function EvaluationForm({ sessionId, kind, draft, reached }: Props) {
  const [scores, setScores] = useState<Scores>(() => {
    const initial: Scores = {};
    for (const p of PHASES) {
      const d = draft?.scores?.[p.value];
      initial[p.value] = { score: (d?.score as 1 | 2 | 3 | 4 | null) ?? null, evidence: d?.evidence ?? "" };
    }
    return initial;
  });
  const [recommendation, setRecommendation] = useState<Recommendation | null>(
    (draft?.recommendation as Recommendation | null) ?? null,
  );
  const [summary, setSummary] = useState(draft?.summary ?? "");
  const [state, setState] = useState<EvaluationState>({ status: "idle" });
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = (final: boolean) =>
    startTransition(async () => {
      const res = await saveEvaluation(sessionId, {
        kind,
        scores,
        recommendation: kind === "scorecard" ? recommendation : null,
        summary,
        submit: final,
      });
      setState(res);
      setConfirming(false);
    });

  const setPhase = (phase: Phase, patch: Partial<{ score: 1 | 2 | 3 | 4 | null; evidence: string }>) =>
    setScores((s) => ({ ...s, [phase]: { score: null, evidence: "", ...s[phase], ...patch } }));

  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};

  return (
    <form className="grid gap-6" onSubmit={(e) => e.preventDefault()}>
      <p className="muted">
        {kind === "scorecard"
          ? "Score what you saw, with evidence. Once submitted, the candidate sees it and it can't be changed. Other scorecards unlock for you after you submit."
          : "Score yourself honestly against the rubric before you look at anyone else's view. Submitting is final."}
      </p>

      {PHASES.map((p) => {
        const value = scores[p.value];
        const wasReached = reached.includes(p.value);
        return (
          <fieldset key={p.value} className="grid gap-2 border-t border-grid pt-4">
            <legend className="font-semibold">
              {p.label} <span className="faint font-normal">· {RUBRIC[p.value].assesses}</span>
              {!wasReached ? <span className="faint font-normal"> · not reached</span> : null}
            </legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={`${p.label} score`}>
              {SCORES.map((s) => (
                <label key={s.value} className="option min-w-28 py-1.5!" title={s.hint}>
                  <input
                    type="radio"
                    name={`score-${p.value}`}
                    checked={value?.score === s.value}
                    onChange={() => setPhase(p.value, { score: s.value })}
                  />
                  <span className="option-title">
                    {s.value} · {s.label}
                  </span>
                </label>
              ))}
              <button
                type="button"
                className="btn btn-ghost text-[0.85rem]"
                onClick={() => setPhase(p.value, { score: null })}
                disabled={value?.score == null}
              >
                Clear
              </button>
            </div>
            <label className="sr-only" htmlFor={`evidence-${p.value}`}>
              Evidence for {p.label}
            </label>
            <textarea
              id={`evidence-${p.value}`}
              className="input min-h-16 text-[0.92rem]"
              maxLength={2000}
              placeholder="Evidence: what was said or drawn, and when"
              value={value?.evidence ?? ""}
              onChange={(e) => setPhase(p.value, { evidence: e.target.value })}
            />
          </fieldset>
        );
      })}
      {errors.scores ? <p className="field-error">{errors.scores}</p> : null}

      {kind === "scorecard" ? (
        <fieldset className="grid gap-2">
          <legend className="label mb-1">Overall recommendation</legend>
          <div className="flex flex-wrap gap-2">
            {RECOMMENDATIONS.map((r) => (
              <label key={r.value} className="option min-w-28">
                <input
                  type="radio"
                  name="recommendation"
                  checked={recommendation === r.value}
                  onChange={() => setRecommendation(r.value)}
                />
                <span className="option-title">{r.label}</span>
              </label>
            ))}
          </div>
          <p className="hint">For the level they&apos;re targeting. There&apos;s no “maybe”: pick the side you&apos;d argue for.</p>
          {errors.recommendation ? <p className="field-error">{errors.recommendation}</p> : null}
        </fieldset>
      ) : null}

      <div className="field">
        <label htmlFor="summary" className="label">
          {kind === "scorecard" ? "Summary for the candidate" : "What went well, and what you'd do differently"}
        </label>
        <textarea
          id="summary"
          className="input min-h-28"
          maxLength={5000}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          aria-invalid={Boolean(errors.summary)}
        />
        {errors.summary ? <p className="field-error">{errors.summary}</p> : null}
      </div>

      {state.status === "error" && state.message ? (
        <p role="alert" className="notice notice-error">
          {state.message}
        </p>
      ) : null}
      {state.status === "saved" ? (
        <p role="status" className="notice notice-success">
          Draft saved. Only you can see it.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => submit(false)}>
          Save draft
        </button>
        {confirming ? (
          <>
            <button type="button" className="btn btn-primary" disabled={pending} onClick={() => submit(true)}>
              {pending ? "Submitting…" : "Yes, submit. It's final"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>
              Not yet
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" disabled={pending} onClick={() => setConfirming(true)}>
            Submit
          </button>
        )}
      </div>
    </form>
  );
}
