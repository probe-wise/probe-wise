import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireMember } from "@/lib/dal";
import { SENIORITY_LEVELS, labelFor } from "@/lib/profile-options";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Candidates" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function CandidatesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="page grid gap-8 py-12">
      <Suspense fallback={<div className="skeleton h-96" aria-hidden="true" />}>
        <Candidates searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const STATUS_ORDER = ["in_progress", "lobby", "completed", "cancelled"] as const;
const STATUS_LABEL = { in_progress: "Interview in progress", lobby: "Interview scheduled", completed: "Interviewed", cancelled: "Cancelled" };

async function Candidates({ searchParams }: { searchParams: SearchParams }) {
  const { org } = await requireMember("/candidates");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const supabase = await createClient();
  let query = supabase
    .from("candidates")
    .select("*")
    .eq("org_id", org.id)
    .order("created_at", { ascending: false })
    .limit(200);
  // PostgREST's or() syntax treats commas and brackets as separators; strip them from the search.
  const term = q.replace(/[,()%*\\]/g, " ").trim();
  if (term) query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%,role_title.ilike.%${term}%`);
  const { data: candidates } = await query;
  const ids = (candidates ?? []).map((c) => c.id);
  const { data: sessions } = ids.length
    ? await supabase.from("interview_sessions").select("candidate_id, status").in("candidate_id", ids)
    : { data: [] };
  const latest = new Map<string, (typeof STATUS_ORDER)[number]>();
  for (const s of sessions ?? []) {
    const current = latest.get(s.candidate_id);
    if (!current || STATUS_ORDER.indexOf(s.status) < STATUS_ORDER.indexOf(current)) latest.set(s.candidate_id, s.status);
  }

  return (
    <>
      {params.deleted === "1" ? (
        <p className="notice notice-success" role="status">
          The candidate and their interviews were deleted.
        </p>
      ) : null}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-2">
          <h1 className="text-[2.2rem]!">Candidates</h1>
          <p className="lede">The people {org.name} is interviewing. Only your team can see this list.</p>
        </div>
        <Link href="/candidates/new" className="btn btn-primary">
          Add candidate
        </Link>
      </header>

      <form className="flex max-w-md gap-2" role="search">
        <label htmlFor="q" className="sr-only">
          Search candidates
        </label>
        <input id="q" name="q" className="input flex-1" defaultValue={q} placeholder="Search by name, email or role" />
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
      </form>

      {candidates?.length ? (
        <ul className="grid gap-2">
          {candidates.map((c) => {
            const status = latest.get(c.id);
            return (
              <li key={c.id}>
                <Link
                  href={`/candidates/${c.id}`}
                  className="grid gap-0.5 rounded-lg border border-grid bg-board-raised px-4 py-3 hover:border-ink-faint sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <span className="grid">
                    <span className="font-semibold">{c.full_name}</span>
                    <span className="faint">
                      {[c.role_title, c.seniority ? labelFor(SENIORITY_LEVELS, c.seniority) : null, c.email].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className={`text-[0.9rem] ${status === "in_progress" || status === "lobby" ? "text-marker" : "text-ink-faint"}`}>
                    {status ? STATUS_LABEL[status] : "No interviews yet"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">
          {q ? "No candidates match that search." : "No candidates yet. Add one to schedule their interview."}
        </p>
      )}
    </>
  );
}
