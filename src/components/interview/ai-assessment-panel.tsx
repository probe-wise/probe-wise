"use client";

import { useState, useTransition } from "react";
import { requestAiAssessment } from "@/app/actions/interview";

type Props = {
  sessionId: string;
  configured: boolean;
  /** A run that's in progress (started by someone, possibly in another tab) or that failed. */
  state: { status: "running" | "failed"; error: string | null } | null;
};

/** The button to generate the AI assessment. The result itself is rendered by the server. */
export function AiAssessmentPanel({ sessionId, configured, state }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!configured) {
    return (
      <p className="muted">
        AI assessment isn&apos;t set up for this deployment. An admin can add <code>ANTHROPIC_API_KEY</code> and{" "}
        <code>SUPABASE_SECRET_KEY</code> to turn it on.
      </p>
    );
  }

  const run = () =>
    startTransition(async () => {
      setError(null);
      const res = await requestAiAssessment(sessionId);
      if (res.status === "error") setError(res.message ?? "Something went wrong.");
    });

  const shownError = error ?? (state?.status === "failed" ? state.error : null);
  return (
    <div className="grid gap-3">
      <p className="muted">
        Claude reads the recording (problem, board, candidate notes, chat and timings) and grades it on the same rubric.
        It doesn&apos;t see your private notes or anyone&apos;s scorecard. Treat it as a second opinion, not a decision.
      </p>
      {pending || state?.status === "running" ? (
        <p role="status" className="notice notice-info">
          Generating the assessment. This usually takes under a minute…
        </p>
      ) : (
        <div>
          <button type="button" className="btn btn-secondary" onClick={run}>
            {state?.status === "failed" ? "Try again" : "Generate AI assessment"}
          </button>
        </div>
      )}
      {shownError && !pending ? (
        <p role="alert" className="notice notice-error">
          {shownError}
        </p>
      ) : null}
    </div>
  );
}
