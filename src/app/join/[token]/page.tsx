import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CandidateJoinForm } from "@/components/interview/candidate-join-form";
import { SetupNotice } from "@/components/setup-notice";
import { isSupabaseConfigured } from "@/lib/env";
import { hashInviteToken, isWellFormedToken } from "@/lib/interview/invite-token";
import { createClient } from "@/lib/supabase/server";

// The candidate's way in. Public: candidates have no account. Joining gives them an
// anonymous session that only opens this interview room.

export const metadata: Metadata = { title: "Your interview", robots: { index: false } };

type Params = Promise<{ token: string }>;

export default function CandidateJoinPage({ params }: { params: Params }) {
  return (
    <div className="page-narrow py-14">
      <Suspense fallback={<div className="skeleton h-64" aria-hidden="true" />}>
        <Join params={params} />
      </Suspense>
    </div>
  );
}

const STATE_MESSAGES = {
  expired: "This link has expired. Ask your interviewer to send a new one.",
  revoked: "This link was replaced. Use the newest link your interviewer sent.",
  used: "This link has already been used. If you're switching device, ask your interviewer for a new link.",
  closed: "This interview has ended.",
} as const;

async function Join({ params }: { params: Params }) {
  if (!isSupabaseConfigured()) return <SetupNotice />;
  const { token } = await params;
  const preview = isWellFormedToken(token)
    ? (await (await createClient()).rpc("candidate_link_preview", { p_token_hash: hashInviteToken(token) })).data?.[0]
    : undefined;

  if (!preview) return <Message title="This link isn't valid" body="Check you copied the whole link, or ask your interviewer for a new one." />;
  if (preview.my_role) redirect(`/interview/${preview.session_id}`);
  if (preview.link_state !== "valid") return <Message title="This link can't be used" body={STATE_MESSAGES[preview.link_state]} />;
  if (preview.is_staff) {
    return (
      <Message
        title="This is the candidate's link"
        body={`You're signed in to ${preview.org_name}'s workspace, so you can't join as the candidate. Send the link to them, or open it in a private window to try it out.`}
      />
    );
  }

  const when = preview.scheduled_at
    ? new Date(preview.scheduled_at).toLocaleString([], { dateStyle: "full", timeStyle: "short" })
    : null;

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <p className="faint">{preview.org_name}</p>
        <h1 className="text-[2rem]!">Your system design interview</h1>
        <p className="lede">
          {preview.org_name} has invited you to a live system design interview{when ? ` (${when})` : ""}. You don&apos;t
          need an account.
        </p>
      </header>
      <ul className="panel grid gap-2 text-[0.95rem]">
        <li>You&apos;ll share a whiteboard, a notes pad and a chat with your interviewer. Use a laptop or desktop.</li>
        <li>Your interviewer runs the clock and moves through the stages: requirements, estimates, API, design, deep dive and trade-offs.</li>
        <li>Think out loud. Asking clarifying questions is part of the interview.</li>
      </ul>
      <CandidateJoinForm token={token} defaultName={preview.candidate_name} company={preview.org_name} />
    </div>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid gap-4">
      <h1 className="text-[2rem]!">{title}</h1>
      <p className="lede">{body}</p>
    </div>
  );
}
