"use client";

import { useActionState, useState } from "react";
import { inviteTeammate, type TeamInviteState } from "@/app/actions/org";
import { SubmitButton } from "@/components/submit-button";
import { ORG_ROLES } from "@/lib/org";

/** Admins only. Shows the invite link once, to send over any channel. */
export function TeamInviteForm() {
  const [state, action] = useActionState<TeamInviteState, FormData>(inviteTeammate, { status: "idle" });
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  const copied = state.status === "created" && copiedAt === state.createdAt;

  return (
    <div className="grid gap-4">
      <form action={action} className="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div className="field">
          <label htmlFor="invite-email" className="label">
            Email
          </label>
          <input id="invite-email" name="email" type="email" className="input" required maxLength={254} placeholder="teammate@company.com" />
        </div>
        <div className="field">
          <label htmlFor="invite-role" className="label">
            Role
          </label>
          <select id="invite-role" name="role" className="input" defaultValue="interviewer">
            {ORG_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton pendingLabel="Creating…">Create invite</SubmitButton>
      </form>
      {state.status === "error" ? (
        <p role="alert" className="notice notice-error">
          {state.message}
        </p>
      ) : null}
      {state.status === "created" ? (
        <div className="grid gap-2 rounded-lg border border-grid bg-board-raised p-3">
          <label htmlFor="team-invite-url" className="label">
            Invite link for {state.email}
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="team-invite-url"
              className="input min-w-0 flex-1 font-mono text-[0.85rem]"
              readOnly
              value={state.url}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                navigator.clipboard.writeText(state.url).then(
                  () => setCopiedAt(state.createdAt),
                  () => setCopiedAt(null),
                )
              }
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          {state.emailed ? (
            <p role="status" className="text-[0.9rem] text-pass">
              Emailed to {state.email}.
            </p>
          ) : null}
          {state.emailError ? (
            <p role="alert" className="field-error">
              Not emailed: {state.emailError}
            </p>
          ) : null}
          <p className="faint">
            {state.emailed ? "You can also send it yourself." : "Send it to them directly."} It works once, only for {state.email}, until{" "}
            {new Date(state.expiresAt).toLocaleDateString([], { dateStyle: "medium" })}. This is the only time it&apos;s shown.
          </p>
        </div>
      ) : null}
    </div>
  );
}
