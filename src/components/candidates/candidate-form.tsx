"use client";

import { useActionState } from "react";
import { saveCandidate, type CandidateFormState } from "@/app/actions/candidates";
import { SubmitButton } from "@/components/submit-button";
import type { CandidateRow } from "@/lib/database.types";
import { SENIORITY_LEVELS } from "@/lib/profile-options";

/** Add a candidate (no `candidate`) or edit one. */
export function CandidateForm({ candidate }: { candidate?: CandidateRow }) {
  const [state, action] = useActionState<CandidateFormState, FormData>(saveCandidate, { status: "idle" });
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const editing = Boolean(candidate);

  return (
    <form action={action} className="grid gap-5">
      {candidate ? <input type="hidden" name="id" value={candidate.id} /> : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="field">
          <label htmlFor="full_name" className="label">
            Full name
          </label>
          <input
            id="full_name"
            name="full_name"
            className="input"
            required
            maxLength={100}
            defaultValue={candidate?.full_name}
            aria-invalid={Boolean(errors.full_name)}
          />
          {errors.full_name ? <p className="field-error">{errors.full_name}</p> : null}
        </div>
        <div className="field">
          <label htmlFor="email" className="label">
            Email <span className="faint font-normal">(optional)</span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            className="input"
            maxLength={254}
            defaultValue={candidate?.email ?? ""}
            aria-invalid={Boolean(errors.email)}
          />
          {errors.email ? <p className="field-error">{errors.email}</p> : null}
        </div>
        <div className="field">
          <label htmlFor="role_title" className="label">
            Role <span className="faint font-normal">(optional)</span>
          </label>
          <input
            id="role_title"
            name="role_title"
            className="input"
            maxLength={100}
            placeholder="Backend engineer, Payments"
            defaultValue={candidate?.role_title ?? ""}
            aria-invalid={Boolean(errors.role_title)}
          />
          {errors.role_title ? <p className="field-error">{errors.role_title}</p> : null}
        </div>
        <div className="field">
          <label htmlFor="seniority" className="label">
            Level
          </label>
          <select id="seniority" name="seniority" className="input" defaultValue={candidate?.seniority ?? "mid"}>
            {SENIORITY_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
          <p className="hint">Sets the time per phase and how the rubric is calibrated.</p>
        </div>
      </div>
      <div className="field">
        <label htmlFor="notes" className="label">
          Notes for the team <span className="faint font-normal">(optional)</span>
        </label>
        <textarea
          id="notes"
          name="notes"
          className="input min-h-24"
          maxLength={5000}
          defaultValue={candidate?.notes ?? ""}
          placeholder="Where they came from, what to focus on…"
          aria-invalid={Boolean(errors.notes)}
        />
        <p className="hint">Only your team sees these. The candidate never does.</p>
        {errors.notes ? <p className="field-error">{errors.notes}</p> : null}
      </div>
      {state.status === "error" && state.message ? (
        <p role="alert" className="notice notice-error">
          {state.message}
        </p>
      ) : null}
      {state.status === "saved" ? (
        <p role="status" className="notice notice-success">
          Saved.
        </p>
      ) : null}
      <div>
        <SubmitButton pendingLabel="Saving…">{editing ? "Save changes" : "Add candidate"}</SubmitButton>
      </div>
    </form>
  );
}
