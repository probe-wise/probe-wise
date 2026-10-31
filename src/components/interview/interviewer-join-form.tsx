"use client";

import { useActionState } from "react";
import { joinAsInterviewer, type ActionState } from "@/app/actions/interview";
import { SubmitButton } from "@/components/submit-button";

export function InterviewerJoinForm({ sessionId, assigned }: { sessionId: string; assigned: boolean }) {
  const [state, action] = useActionState<ActionState, FormData>(joinAsInterviewer, { status: "idle" });
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="session" value={sessionId} />
      <label className="flex items-start gap-3">
        <input type="checkbox" name="consent" required className="mt-1.5" />
        <span>
          I agree that what I do in this interview (whiteboard, chat, questions, private notes and my scorecard) is recorded
          for my team&apos;s review.
        </span>
      </label>
      {state.status === "error" ? (
        <p role="alert" className="notice notice-error">
          {state.message}
        </p>
      ) : null}
      <SubmitButton pendingLabel="Joining…">{assigned ? "Enter the room" : "Join as an interviewer"}</SubmitButton>
    </form>
  );
}
