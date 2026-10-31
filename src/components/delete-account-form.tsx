"use client";

import { useActionState, useId, useState } from "react";
import { deleteAccount, type DeleteAccountState } from "@/app/actions/org";
import { SubmitButton } from "@/components/submit-button";

const idle: DeleteAccountState = { status: "idle" };

/** Two-step, typed confirmation for deleting an account. */
export function DeleteAccountForm({ buttonLabel, consequence }: { buttonLabel: string; consequence: string }) {
  const [state, action] = useActionState(deleteAccount, idle);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const id = useId();

  if (!open) {
    return (
      <button type="button" className="btn btn-danger" onClick={() => setOpen(true)}>
        {buttonLabel}
      </button>
    );
  }

  return (
    <form action={action} className="grid max-w-sm gap-3">
      <p className="text-[0.95rem]">{consequence} This can&apos;t be undone.</p>
      <div className="field">
        <label className="label" htmlFor={`${id}-confirm`}>
          Type DELETE to confirm
        </label>
        <input
          id={`${id}-confirm`}
          name="confirm"
          className="input"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          aria-invalid={state.status === "error" ? true : undefined}
        />
      </div>
      {state.status === "error" ? (
        <p className="field-error" role="alert">
          {state.message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <SubmitButton className="btn btn-danger" pendingLabel="Deleting…" disabled={typed.trim() !== "DELETE"}>
          {buttonLabel}
        </SubmitButton>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setOpen(false);
            setTyped("");
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
