"use client";

import { useActionState } from "react";
import { joinAsCandidate, type ActionState } from "@/app/actions/interview";
import { SubmitButton } from "@/components/submit-button";

export function CandidateJoinForm({ token, defaultName, company }: { token: string; defaultName: string; company: string }) {
  const [state, action] = useActionState<ActionState, FormData>(joinAsCandidate, { status: "idle" });
  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="token" value={token} />
      <div className="field">
        <label htmlFor="display_name" className="label">
          Your name
        </label>
        <input id="display_name" name="display_name" className="input" defaultValue={defaultName} maxLength={80} required autoComplete="name" />
        <p className="hint">Your interviewers see this in the room.</p>
      </div>
      <label className="flex items-start gap-3">
        <input type="checkbox" name="consent" required className="mt-1.5" />
        <span>
          I agree that this interview is recorded (the whiteboard, my notes, the chat and timings) and shared with {company}
          &apos;s hiring team to evaluate my application.
        </span>
      </label>
      {state.status === "error" ? (
        <p role="alert" className="notice notice-error">
          {state.message}
        </p>
      ) : null}
      <SubmitButton pendingLabel="Joining…">Join the interview</SubmitButton>
    </form>
  );
}
