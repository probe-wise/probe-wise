import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/app/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { getMembership, getViewer } from "@/lib/dal";

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight text-ink">
      {/* A system component with a probe on it. */}
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <rect x="1.5" y="4.5" width="15" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="17" cy="5" r="3.6" fill="var(--probe)" />
      </svg>
      <span className="text-[1.08rem]">Probewise</span>
    </span>
  );
}

export function SiteHeader() {
  return (
    <header className="border-b border-grid">
      <nav aria-label="Main" className="page flex h-16 items-center justify-between gap-4">
        <Link href="/" className="rounded" aria-label="Probewise home">
          <Wordmark />
        </Link>
        {/* The session is read per request, so this part streams in after the static shell. */}
        <Suspense fallback={<span className="skeleton h-5 w-24" aria-hidden="true" />}>
          <AuthNav />
        </Suspense>
      </nav>
    </header>
  );
}

async function AuthNav() {
  const viewer = await getViewer();
  // Candidates in an interview room have an anonymous session: no navigation for them.
  if (viewer?.anonymous) return null;
  if (!viewer) {
    return (
      <Link href="/login" className="btn btn-secondary">
        Sign in
      </Link>
    );
  }
  const membership = await getMembership();
  return (
    <div className="flex items-center gap-1 sm:gap-2">
      {membership ? (
        <>
          <Link href="/dashboard" className="btn btn-ghost">
            Dashboard
          </Link>
          <Link href="/candidates" className="btn btn-ghost hidden sm:inline-flex">
            Candidates
          </Link>
          <Link href="/interview" className="btn btn-ghost hidden md:inline-flex">
            Interviews
          </Link>
          <Link href="/problems" className="btn btn-ghost hidden md:inline-flex">
            Problems
          </Link>
          <Link href="/team" className="btn btn-ghost hidden lg:inline-flex">
            Team
          </Link>
        </>
      ) : null}
      <Link href="/account" className="btn btn-ghost">
        Account
      </Link>
      <form action={signOut}>
        <SubmitButton className="btn btn-secondary" pendingLabel="Signing out…">
          Sign out
        </SubmitButton>
      </form>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-grid py-8">
      <div className="page flex flex-wrap items-center justify-between gap-3 text-sm text-ink-faint">
        <span>Probewise: structured system design interviews for hiring teams.</span>
        <a className="link" href="https://github.com/probe-wise" rel="noopener noreferrer">
          Source on GitHub
        </a>
      </div>
    </footer>
  );
}
