"use client";

import { useActionState, useState } from "react";
import { saveProblem, type LibraryState } from "@/app/actions/library";
import { SubmitButton } from "@/components/submit-button";
import { CODE_LANGUAGES, ROUND_TYPES, type RoundType } from "@/lib/interview/rounds";
import type { InterviewerGuide } from "@/lib/problems/types";
import { SENIORITY_LEVELS } from "@/lib/profile-options";

export type ProblemFormValues = {
  id?: string;
  round_type: RoundType;
  title: string;
  summary: string;
  prompt: string;
  focus: string;
  levels: string[];
  language: string | null;
  starter_code: string;
  guide: InterviewerGuide;
};

const EMPTY_GUIDE: InterviewerGuide = { clarifications: [], scale: [], probes: [], strongSignals: [], pitfalls: [], reference: [] };

/** Create or edit a workspace problem (ADR 0011). Guide lists are one item per line. */
export function ProblemForm({ initial }: { initial?: ProblemFormValues }) {
  const [state, action] = useActionState<LibraryState, FormData>(saveProblem, { status: "idle" });
  const [round, setRound] = useState<RoundType>(initial?.round_type ?? "system_design");
  const guide = initial?.guide ?? EMPTY_GUIDE;
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const editing = Boolean(initial?.id);
  const behavioural = round === "behavioural";

  return (
    <form action={action} className="grid gap-6">
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      {editing ? <input type="hidden" name="round_type" value={round} /> : null}

      <fieldset className="grid gap-2" disabled={editing}>
        <legend className="label mb-1">Round type{editing ? " (can't be changed)" : ""}</legend>
        <div className="flex flex-wrap gap-2">
          {ROUND_TYPES.map((t) => (
            <label key={t.value} className="option min-w-40">
              <input type="radio" name="round_type" value={t.value} checked={round === t.value} onChange={() => setRound(t.value)} />
              <span className="option-title">{t.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field label="Title" error={errors.title}>
        <input name="title" className="input" required maxLength={200} defaultValue={initial?.title} />
      </Field>
      <Field label={behavioural ? "What the candidate sees" : "Prompt (what the candidate sees)"} error={errors.prompt} hint="Shown in the room. Keep anything you don't want them to know for the guide below.">
        <textarea name="prompt" className="input min-h-36" required maxLength={8000} defaultValue={initial?.prompt} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="One-line summary" error={errors.summary} hint="Shown to your team in lists.">
          <input name="summary" className="input" maxLength={500} defaultValue={initial?.summary} />
        </Field>
        <Field label="Focus" error={errors.focus} hint="What the follow-ups dig into.">
          <input name="focus" className="input" maxLength={200} defaultValue={initial?.focus} />
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="label mb-1">Levels it&apos;s calibrated for</legend>
        <div className="flex flex-wrap gap-2">
          {SENIORITY_LEVELS.map((l) => (
            <label key={l.value} className="option min-w-28 py-1.5!">
              <input type="checkbox" name="levels" value={l.value} defaultChecked={initial ? initial.levels.includes(l.value) : true} />
              <span className="option-title">{l.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {round === "coding" ? (
        <div className="grid gap-5">
          <Field label="Starting language" error={errors.language}>
            <select name="language" className="input max-w-xs" defaultValue={initial?.language ?? "python"}>
              {CODE_LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Starter code" error={errors.starter_code} hint="The editor starts with this, e.g. a function signature.">
            <textarea name="starter_code" className="input min-h-36 font-mono text-[0.85rem]" maxLength={20000} defaultValue={initial?.starter_code} spellCheck={false} />
          </Field>
        </div>
      ) : null}

      <fieldset className="grid gap-5 border-t border-grid pt-6">
        <legend className="text-[1.15rem] font-semibold">Interviewer guide (your team only)</legend>
        <p className="muted -mt-2">One item per line.</p>
        <Field label={behavioural ? "Questions and follow-ups" : "Follow-up questions"} error={errors.probes} hint="Interviewers click these to ask them in the room.">
          <textarea name="probes" className="input min-h-28" defaultValue={guide.probes.join("\n")} />
        </Field>
        {!behavioural ? (
          <>
            <Field label="If they ask…" hint="One per line: question :: answer to give.">
              <textarea
                name="clarifications"
                className="input min-h-24"
                placeholder="How many users? :: 10 million a day"
                defaultValue={guide.clarifications.map((c) => `${c.q} :: ${c.a}`).join("\n")}
              />
            </Field>
            <Field label={round === "coding" ? "Constraints to give" : "Numbers to give"}>
              <textarea name="scale" className="input min-h-20" defaultValue={guide.scale.join("\n")} />
            </Field>
          </>
        ) : null}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Strong signals">
            <textarea name="strong_signals" className="input min-h-24" defaultValue={guide.strongSignals.join("\n")} />
          </Field>
          <Field label="Common pitfalls">
            <textarea name="pitfalls" className="input min-h-24" defaultValue={guide.pitfalls.join("\n")} />
          </Field>
        </div>
        <Field label={round === "system_design" ? "Reference design" : round === "coding" ? "Reference approach" : "What good answers cover"} hint="Also used to anchor the AI assessment.">
          <textarea name="reference" className="input min-h-24" defaultValue={guide.reference.join("\n")} />
        </Field>
      </fieldset>

      {state.status === "error" && state.message ? (
        <p role="alert" className="notice notice-error">
          {state.message}
        </p>
      ) : null}
      {state.status === "saved" ? (
        <p role="status" className="notice notice-success">
          Saved. Interviews already scheduled keep the prompt they were created with.
        </p>
      ) : null}
      <div>
        <SubmitButton pendingLabel="Saving…">{editing ? "Save changes" : "Create problem"}</SubmitButton>
      </div>
    </form>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
      {error ? <span className="field-error">{error}</span> : null}
    </label>
  );
}
