"use client";

import { useState, useTransition } from "react";
import { saveEvaluation, type EvaluationState } from "@/app/actions/interview";
import type { SessionEvaluationRow } from "@/lib/database.types";
import { RECOMMENDATIONS, SCORES, type AspectScore, type Recommendation } from "@/lib/interview/rubric";
import type { Rubric } from "@/lib/interview/rounds";

type Props = {
  sessionId: string;
  draft: SessionEvaluationRow | null;
  /** The rubric this interview is graded on (its snapshot). */
  rubric: Rubric;
  /** The round's phases; aspects named after a phase that wasn't reached are marked. */
  phaseKeys: string[];
  reached: string[];
};

/** An interviewer's scorecard: every aspect of the rubric, a recommendation and a summary. */
export function EvaluationForm({ sessionId, draft, rubric, phaseKeys, reached }: Props) {
  const [scores, setScores] = useState<Record<string, AspectScore>>(() => {
    const initial: Record<string, AspectScore> = {};
    for (const a of rubric.aspects) {
      const d = draft?.scores?.[a.key];
      initial[a.key] = { score: (d?.score as 1 | 2 | 3 | 4 | null) ?? null, evidence: d?.evidence ?? "" };
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
        scores,
        recommendation,
        summary,
        submit: final,
      });
      setState(res);
      setConfirming(false);
    });

  const setAspect = (aspect: string, patch: Partial<{ score: 1 | 2 | 3 | 4 | null; evidence: string }>) =>
    setScores((s) => ({ ...s, [aspect]: { ...(s[aspect] ?? { score: null, evidence: "" }), ...patch } }));

  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};

  return (
    <form className="grid gap-6" onSubmit={(e) => e.preventDefault()}>
      <p className="muted">
        Score what you saw, with evidence. Your team sees it once you submit, and it can&apos;t be changed after that.
        Other scorecards and the AI assessment unlock for you when you submit yours. The candidate never sees it.
      </p>

      {rubric.aspects.map((a) => {
        const p = { value: a.key, label: a.label };
        const value = scores[p.value];
        const wasReached = !phaseKeys.includes(p.value) || reached.includes(p.value);
        return (
          <fieldset key={p.value} className="grid gap-2 border-t border-grid pt-4">
            <legend className="font-semibold">
              {p.label} {a.assesses ? <span className="faint font-normal">· {a.assesses}</span> : null}
              {!wasReached ? <span className="faint font-normal"> · not reached</span> : null}
            </legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={`${p.label} score`}>
              {SCORES.map((s) => (
                <label key={s.value} className="option min-w-28 py-1.5!" title={s.hint}>
                  <input
                    type="radio"
                    name={`score-${p.value}`}
                    checked={value?.score === s.value}
                    onChange={() => setAspect(p.value, { score: s.value })}
                  />
                  <span className="option-title">
                    {s.value} · {s.label}
                  </span>
                </label>
              ))}
              <button
                type="button"
                className="btn btn-ghost text-[0.85rem]"
                onClick={() => setAspect(p.value, { score: null })}
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
              onChange={(e) => setAspect(p.value, { evidence: e.target.value })}
            />
          </fieldset>
        );
      })}
      {errors.scores ? <p className="field-error">{errors.scores}</p> : null}

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

      <div className="field">
        <label htmlFor="summary" className="label">
          Summary for the hiring team
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
