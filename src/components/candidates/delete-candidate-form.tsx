"use client";

import { useActionState, useState } from "react";
import { deleteCandidate, type CandidateFormState } from "@/app/actions/candidates";
import { SubmitButton } from "@/components/submit-button";

export function DeleteCandidateForm({ id, name }: { id: string; name: string }) {
  const [state, action] = useActionState<CandidateFormState, FormData>(deleteCandidate, { status: "idle" });
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  if (!open) {
    return (
      <button type="button" className="btn btn-danger" onClick={() => setOpen(true)}>
        Delete candidate
      </button>
    );
  }
  return (
    <form action={action} className="grid max-w-sm gap-3">
      <input type="hidden" name="id" value={id} />
      <p className="text-[0.95rem]">
        Deletes {name} and every interview, recording and scorecard for them. This can&apos;t be undone.
      </p>
      <div className="field">
        <label className="label" htmlFor="confirm-delete">
          Type DELETE to confirm
        </label>
        <input
          id="confirm-delete"
          name="confirm"
          className="input"
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </div>
      {state.status === "error" ? (
        <p className="field-error" role="alert">
          {state.message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <SubmitButton className="btn btn-danger" pendingLabel="Deleting…" disabled={typed.trim() !== "DELETE"}>
          Delete candidate
        </SubmitButton>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
