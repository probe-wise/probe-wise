"use client";

import { useState, useTransition } from "react";
import { createCandidateLink, revokeCandidateLinks, type LinkState } from "@/app/actions/interview";

/** Hiring team only: create, copy and cancel the candidate's one-time link. */
type Props = {
  sessionId: string;
  candidateJoined: boolean;
  /** Offered as "Create and email" when email is set up and the candidate has an address. */
  candidateEmail?: string | null;
  emailEnabled?: boolean;
};

export function CandidateLinkPanel({ sessionId, candidateJoined, candidateEmail = null, emailEnabled = false }: Props) {
  const [state, setState] = useState<LinkState>({ status: "idle" });
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const canEmail = emailEnabled && Boolean(candidateEmail);
  const create = (email = false) =>
    startTransition(async () => {
      setCopied(false);
      setState(await createCandidateLink(sessionId, { email }));
    });

  const revoke = () =>
    startTransition(async () => {
      const res = await revokeCandidateLinks(sessionId);
      setState(res.status === "error" ? { status: "error", message: res.message ?? "" } : { status: "idle" });
    });

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="grid gap-3">
      <p className="muted">
        {candidateJoined
          ? "The candidate is in. If they switch device, send them a new link: it moves them over."
          : "Send this to the candidate when you're ready. They don't need an account. It works once, for 24 hours."}
      </p>
      {state.status === "created" ? (
        <div className="grid gap-2">
          <label htmlFor="candidate-url" className="label">
            Candidate link
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="candidate-url"
              className="input min-w-0 flex-1 font-mono text-[0.85rem]"
              readOnly
              value={state.url}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" className="btn btn-primary" onClick={() => void copy(state.url)}>
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          {state.emailedTo ? (
            <p role="status" className="text-[0.9rem] text-pass">
              Emailed to {state.emailedTo}.
            </p>
          ) : null}
          {state.emailError ? (
            <p role="alert" className="field-error">
              Not emailed: {state.emailError}
            </p>
          ) : null}
          <p className="faint">
            Expires {new Date(state.expiresAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}. This is
            the only time it&apos;s shown.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => create(false)}>
              Make a new link
            </button>
            <button type="button" className="btn btn-ghost" disabled={pending} onClick={revoke}>
              Cancel link
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {canEmail && !candidateJoined ? (
            <button type="button" className="btn btn-primary" disabled={pending} onClick={() => create(true)}>
              {pending ? "Sending…" : `Email link to ${candidateEmail}`}
            </button>
          ) : null}
          <button
            type="button"
            className={`btn ${candidateJoined || canEmail ? "btn-secondary" : "btn-primary"}`}
            disabled={pending}
            onClick={() => create(false)}
          >
            {pending ? "Creating…" : candidateJoined ? "New candidate link" : canEmail ? "Create link to copy" : "Create candidate link"}
          </button>
        </div>
      )}
      {state.status === "error" ? (
        <p role="alert" className="notice notice-error">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
