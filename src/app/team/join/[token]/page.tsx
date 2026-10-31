import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { signOut } from "@/app/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { AcceptInviteForm } from "@/components/workspace/accept-invite-form";
import { requireViewer } from "@/lib/dal";
import { hashInviteToken, isWellFormedToken } from "@/lib/interview/invite-token";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Join your team", robots: { index: false } };

type Params = Promise<{ token: string }>;

export default function TeamJoinPage({ params }: { params: Params }) {
  return (
    <div className="page-narrow py-14">
      <Suspense fallback={<div className="skeleton h-64" aria-hidden="true" />}>
        <Join params={params} />
      </Suspense>
    </div>
  );
}

const STATE_MESSAGES = {
  expired: "This invite has expired. Ask an admin for a new one.",
  revoked: "This invite was cancelled. Ask an admin for a new one.",
  used: "This invite has already been used. Each invite works once.",
} as const;

async function Join({ params }: { params: Params }) {
  const { token } = await params;
  const viewer = await requireViewer(`/team/join/${token}`);
  if (viewer.anonymous) redirect(`/login?next=${encodeURIComponent(`/team/join/${token}`)}`);

  const preview = isWellFormedToken(token)
    ? (await (await createClient()).rpc("org_invite_preview", { p_token_hash: hashInviteToken(token) })).data?.[0]
    : undefined;

  if (!preview) return <Problem title="This invite link isn't valid" body="Check you copied the whole link, or ask for a new one." />;
  if (preview.invite_state !== "valid") return <Problem title="This invite can't be used" body={STATE_MESSAGES[preview.invite_state]} />;
  if (preview.already_member) {
    return (
      <Problem
        title="You're already in a workspace"
        body={`An account can belong to one workspace for now. Delete or leave your current one, or sign in with ${preview.email}'s own account.`}
      />
    );
  }
  if (!preview.email_matches) {
    return (
      <div className="grid gap-4">
        <h1 className="text-[2rem]!">This invite is for {preview.email}</h1>
        <p className="lede">You&apos;re signed in as {viewer.email ?? "another account"}. Sign out and sign in with {preview.email}.</p>
        <form action={signOut}>
          <SubmitButton className="btn btn-secondary" pendingLabel="Signing out…">
            Sign out
          </SubmitButton>
        </form>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <p className="faint">Team invite</p>
        <h1 className="text-[2rem]!">Join {preview.org_name} on Probewise</h1>
        <p className="lede">
          You&apos;re invited as {preview.role === "admin" ? "an admin" : "an interviewer"}. You&apos;ll
          be able to add candidates, schedule interviews and write scorecards.
        </p>
      </header>
      <AcceptInviteForm token={token} defaultName={viewer.email?.split("@")[0] ?? ""} />
    </div>
  );
}

function Problem({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid gap-4">
      <h1 className="text-[2rem]!">{title}</h1>
      <p className="lede">{body}</p>
      <div>
        <Link href="/" className="btn btn-secondary">
          Home
        </Link>
      </div>
    </div>
  );
}
