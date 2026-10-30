"use client";

import { useState, useTransition } from "react";
import { createInvite, revokeInvites, type InviteState } from "@/app/actions/interview";

/** Candidate-only: create, copy and revoke the one-time interviewer link. */
export function InvitePanel({ sessionId, interviewerCount }: { sessionId: string; interviewerCount: number }) {
  const [state, setState] = useState<InviteState>({ status: "idle" });
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const full = interviewerCount >= 2;

  const create = () =>
    startTransition(async () => {
      setCopied(false);
      setState(await createInvite(sessionId));
    });

  const revoke = () =>
    startTransition(async () => {
      const res = await revokeInvites(sessionId);
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

  if (full) return <p className="muted">Two interviewers have joined, which is the maximum.</p>;

  return (
    <div className="grid gap-3">
      <p className="muted">
        Send this link to the person interviewing you. It works once, for 7 days, and they&apos;ll need to sign in.
        Making a new link cancels the old one.
      </p>
      {state.status === "created" ? (
        <div className="grid gap-2">
          <label htmlFor="invite-url" className="label">
            Interviewer link
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="invite-url"
              className="input min-w-0 flex-1 font-mono text-[0.85rem]"
              readOnly
              value={state.url}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" className="btn btn-primary" onClick={() => void copy(state.url)}>
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <p className="faint">
            Expires {new Date(state.expiresAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}. This is
            the only time the link is shown.
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost" disabled={pending} onClick={create}>
              Make a new link
            </button>
            <button type="button" className="btn btn-ghost" disabled={pending} onClick={revoke}>
              Cancel link
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={create}>
            {pending ? "Creating…" : "Create invite link"}
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
