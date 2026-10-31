"use client";

import { useActionState } from "react";
import { acceptTeamInvite, type FormState } from "@/app/actions/org";
import { SubmitButton } from "@/components/submit-button";

export function AcceptInviteForm({ token, defaultName }: { token: string; defaultName: string }) {
  const [state, action] = useActionState<FormState, FormData>(acceptTeamInvite, { status: "idle" });
  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="token" value={token} />
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
      <SubmitButton pendingLabel="Joining…">Join the workspace</SubmitButton>
    </form>
  );
}
