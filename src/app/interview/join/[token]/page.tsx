import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { JoinForm } from "@/components/interview/join-form";
import { getMyProfile, requireViewer } from "@/lib/dal";
import { hashInviteToken, isWellFormedToken } from "@/lib/interview/invite-token";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Join an interview", robots: { index: false } };

type Params = Promise<{ token: string }>;

export default function JoinPage({ params }: { params: Params }) {
  return (
    <div className="page-narrow py-14">
      <Suspense fallback={<div className="skeleton h-64" aria-hidden="true" />}>
        <Join params={params} />
      </Suspense>
    </div>
  );
}

const STATE_MESSAGES = {
  expired: "This invite link has expired. Ask the candidate for a new one.",
  revoked: "This invite link was cancelled. Ask the candidate for a new one.",
  used: "Someone has already used this invite link. Each link works once; ask the candidate for a new one.",
  closed: "This interview has already ended.",
} as const;

async function Join({ params }: { params: Params }) {
  const { token } = await params;
  const viewer = await requireViewer(`/interview/join/${token}`);

  const preview = isWellFormedToken(token)
    ? (await (await createClient()).rpc("session_invite_preview", { p_token_hash: hashInviteToken(token) })).data?.[0]
    : undefined;

  if (!preview) {
    return <Problem title="This invite link isn't valid" body="Check you copied the whole link, or ask for a new one." />;
  }
  if (preview.my_role) redirect(`/interview/${preview.session_id}`);
  if (preview.invite_state !== "valid") {
    return <Problem title="This link can't be used" body={STATE_MESSAGES[preview.invite_state]} />;
  }

  const profile = await getMyProfile();
  const defaultName = profile?.full_name ?? viewer.email?.split("@")[0] ?? "";

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <p className="faint">Interviewer invite</p>
        <h1 className="text-[2rem]!">Interview {preview.candidate_name}</h1>
        <p className="lede">
          {preview.candidate_name} has asked you to run a mock system design interview: <strong>{preview.problem_title}</strong>.
        </p>
      </header>
      <ul className="panel grid gap-2 text-[0.95rem]">
        <li>You&apos;ll get a private interviewer guide: hidden requirements, numbers, follow-up questions and a rubric.</li>
        <li>You control the timer and phases. The board is shared; you can both draw.</li>
        <li>Afterwards you write a scorecard. The candidate sees it once you submit it.</li>
      </ul>
      <JoinForm token={token} defaultName={defaultName} />
    </div>
  );
}

function Problem({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid gap-4">
      <h1 className="text-[2rem]!">{title}</h1>
      <p className="lede">{body}</p>
      <div>
        <Link href="/interview" className="btn btn-secondary">
          Your sessions
        </Link>
      </div>
    </div>
  );
}
