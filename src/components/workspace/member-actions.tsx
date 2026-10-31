"use client";

import { useState, useTransition } from "react";
import { changeMemberRole, removeMember, revokeTeamInvite, type FormState } from "@/app/actions/org";

function useRun() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<FormState>) =>
    start(async () => {
      const res = await fn();
      setError(res.status === "error" ? (res.message ?? "Something went wrong.") : null);
    });
  return { pending, error, run };
}

/** Admin controls on a member row: switch role, remove (with a confirm step). */
export function MemberActions({ userId, role, name }: { userId: string; role: string; name: string }) {
  const { pending, error, run } = useRun();
  const [confirming, setConfirming] = useState(false);
  const other = role === "admin" ? "interviewer" : "admin";
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button type="button" className="btn btn-ghost text-[0.9rem]" disabled={pending} onClick={() => run(() => changeMemberRole(userId, other))}>
        Make {other}
      </button>
      {confirming ? (
        <>
          <button type="button" className="btn btn-danger text-[0.9rem]" disabled={pending} onClick={() => run(() => removeMember(userId))}>
            Remove {name}
          </button>
          <button type="button" className="btn btn-ghost text-[0.9rem]" onClick={() => setConfirming(false)}>
            Keep
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-ghost text-[0.9rem]" onClick={() => setConfirming(true)}>
          Remove
        </button>
      )}
      {error ? (
        <p role="alert" className="field-error w-full text-right">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function RevokeInviteButton({ inviteId }: { inviteId: string }) {
  const { pending, error, run } = useRun();
  return (
    <>
      <button type="button" className="btn btn-ghost text-[0.9rem]" disabled={pending} onClick={() => run(() => revokeTeamInvite(inviteId))}>
        {pending ? "Cancelling…" : "Cancel invite"}
      </button>
      {error ? (
        <span role="alert" className="field-error">
          {error}
        </span>
      ) : null}
    </>
  );
}
