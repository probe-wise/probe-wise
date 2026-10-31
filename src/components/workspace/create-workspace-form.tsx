"use client";

import { useActionState } from "react";
import { createWorkspace, type FormState } from "@/app/actions/org";
import { SubmitButton } from "@/components/submit-button";

export function CreateWorkspaceForm({ defaultName }: { defaultName: string }) {
  const [state, action] = useActionState<FormState, FormData>(createWorkspace, { status: "idle" });
  return (
    <form action={action} className="grid gap-5">
      <div className="field">
        <label htmlFor="company" className="label">
          Company
        </label>
        <input id="company" name="company" className="input" maxLength={100} required autoComplete="organization" />
        <p className="hint">Candidates see this name on their interview link.</p>
      </div>
      <div className="field">
        <label htmlFor="display_name" className="label">
          Your name
        </label>
        <input id="display_name" name="display_name" className="input" maxLength={80} required defaultValue={defaultName} autoComplete="name" />
        <p className="hint">Shown to candidates you interview and to your teammates.</p>
      </div>
      {state.status === "error" ? (
        <p role="alert" className="notice notice-error">
          {state.message}
        </p>
      ) : null}
      <SubmitButton pendingLabel="Creating…">Create workspace</SubmitButton>
    </form>
  );
}
