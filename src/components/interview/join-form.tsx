"use client";

import { useActionState } from "react";
import { acceptInvite, type ActionState } from "@/app/actions/interview";
import { SubmitButton } from "@/components/submit-button";

export function JoinForm({ token, defaultName }: { token: string; defaultName: string }) {
  const [state, action] = useActionState<ActionState, FormData>(acceptInvite, { status: "idle" });
  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="token" value={token} />
      <div className="field">
        <label htmlFor="display_name" className="label">
          Your name
        </label>
        <input id="display_name" name="display_name" className="input" defaultValue={defaultName} maxLength={80} required />
        <p className="hint">The candidate sees this, and it&apos;s stored in the session record.</p>
      </div>
      <label className="flex items-start gap-3">
        <input type="checkbox" name="consent" required className="mt-1.5" />
        <span>
          I agree that everything I do in this session (whiteboard, chat, questions, notes and my scorecard) is recorded
          and kept with the candidate&apos;s session for review.
        </span>
      </label>
      {state.status === "error" ? (
        <p role="alert" className="notice notice-error">
          {state.message}
        </p>
      ) : null}
      <SubmitButton pendingLabel="Joining…">Join as interviewer</SubmitButton>
    </form>
  );
}
