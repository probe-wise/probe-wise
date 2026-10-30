import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SessionList } from "@/components/interview/session-list";
import { getMyProfile, requireViewer } from "@/lib/dal";
import { listMySessions } from "@/lib/interview/session-dal";

export const metadata: Metadata = { title: "Your sessions" };

export default function SessionsPage() {
  return (
    <div className="page-narrow grid gap-6 py-12">
      <h1 className="text-[2.2rem]!">Your sessions</h1>
      <Suspense fallback={<div className="skeleton h-64" aria-hidden="true" />}>
        <Sessions />
      </Suspense>
    </div>
  );
}

async function Sessions() {
  await requireViewer("/interview");
  const [sessions, profile] = await Promise.all([listMySessions(), getMyProfile()]);
  return (
    <SessionList
      sessions={sessions}
      empty={
        <p className="muted">
          No sessions yet.{" "}
          {profile ? (
            <Link href="/problems" className="link">
              Pick a problem
            </Link>
          ) : (
            "When someone invites you to interview them, the session appears here."
          )}
        </p>
      }
    />
  );
}
