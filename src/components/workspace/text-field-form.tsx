"use client";

import { useActionState, useId } from "react";
import type { FormState } from "@/app/actions/org";
import { SubmitButton } from "@/components/submit-button";

type Props = {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  name: string;
  label: string;
  defaultValue: string;
  maxLength: number;
  buttonLabel: string;
  hint?: string;
};

/** One text field and a save button, for small settings (your name, the workspace name). */
export function TextFieldForm({ action, name, label, defaultValue, maxLength, buttonLabel, hint }: Props) {
  const [state, formAction] = useActionState<FormState, FormData>(action, { status: "idle" });
  const id = useId();
  return (
    <form action={formAction} className="grid max-w-md gap-3">
      <div className="field">
        <label htmlFor={id} className="label">
          {label}
        </label>
        <input id={id} name={name} className="input" defaultValue={defaultValue} maxLength={maxLength} required />
        {hint ? <p className="hint">{hint}</p> : null}
      </div>
      {state.status === "error" ? (
        <p role="alert" className="field-error">
          {state.message}
        </p>
      ) : null}
      {state.status === "saved" ? (
        <p role="status" className="text-[0.9rem] text-pass">
          Saved.
        </p>
      ) : null}
      <div>
        <SubmitButton className="btn btn-secondary" pendingLabel="Saving…">
          {buttonLabel}
        </SubmitButton>
      </div>
    </form>
  );
}
