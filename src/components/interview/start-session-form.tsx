"use client";

import { useActionState } from "react";
import { createSession, type ActionState } from "@/app/actions/interview";
import { SubmitButton } from "@/components/submit-button";

export function StartSessionForm({ slug }: { slug: string }) {
  const [state, action] = useActionState<ActionState, FormData>(createSession, { status: "idle" });
  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="problem" value={slug} />
      <fieldset className="grid gap-2">
        <legend className="label mb-1">How do you want to practise?</legend>
        <label className="option">
          <input type="radio" name="mode" value="peer" defaultChecked />
          <span className="option-title">With an interviewer</span>
          <span className="option-hint">Invite a friend or mentor by link. They get the interviewer guide and score you.</span>
        </label>
        <label className="option">
          <input type="radio" name="mode" value="solo" />
          <span className="option-title">Solo</span>
          <span className="option-hint">You run the timer and score yourself against the rubric afterwards.</span>
        </label>
      </fieldset>
      <label className="flex items-start gap-3 text-[0.95rem]">
        <input type="checkbox" name="consent" required className="mt-1.5" />
        <span>
          I agree that this session is recorded (whiteboard, notes, chat, questions, timings and scores) so it can be
          reviewed and scored. I can delete it by deleting my account.
        </span>
      </label>
      {state.status === "error" ? (
        <p role="alert" className="notice notice-error">
          {state.message}
        </p>
      ) : null}
      <SubmitButton pendingLabel="Setting up…">Open the interview room</SubmitButton>
    </form>
  );
}
