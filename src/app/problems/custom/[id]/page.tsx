import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { setProblemArchived } from "@/app/actions/library";
import { ActionButton } from "@/components/library/archive-button";
import { ProblemForm } from "@/components/library/problem-form";
import { requireMember } from "@/lib/dal";
import { roundLabel } from "@/lib/interview/rounds";
import { guideFrom } from "@/lib/problems/problem-source";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Problem" };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function CustomProblemPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <div className="page-narrow max-w-3xl! grid gap-8 py-12">
      <Link href="/problems" className="link text-[0.95rem]">
        ← Problems
      </Link>
      <Suspense fallback={<div className="skeleton h-96" aria-hidden="true" />}>
        <Problem params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Problem({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { id } = await params;
  const query = await searchParams;
  const { org } = await requireMember(`/problems/custom/${id}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: row } = await supabase.from("problems").select("*").eq("id", id).eq("org_id", org.id).maybeSingle();
  if (!row) notFound();
  const archived = Boolean(row.archived_at);

  return (
    <>
      {query.created === "1" ? (
        <p className="notice notice-success" role="status">
          Problem created. It&apos;s now available when scheduling a {roundLabel(row.round_type).toLowerCase()} round.
        </p>
      ) : null}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-2">
          <p className="faint">
            {roundLabel(row.round_type)} · your team&apos;s · version {row.version}
            {archived ? " · archived" : ""}
          </p>
          <h1 className="text-[2rem]!">{row.title}</h1>
        </div>
        <ActionButton
          run={setProblemArchived.bind(null, row.id, !archived)}
          label={archived ? "Restore" : "Archive"}
          pendingLabel={archived ? "Restoring…" : "Archiving…"}
          className="btn btn-secondary"
        />
      </header>
      {archived ? <p className="notice notice-info">Archived problems can&apos;t be scheduled. Past interviews aren&apos;t affected.</p> : null}
      <ProblemForm
        initial={{
          id: row.id,
          round_type: row.round_type,
          title: row.title,
          summary: row.summary,
          prompt: row.prompt,
          focus: row.focus,
          levels: row.levels,
          language: row.language,
          starter_code: row.starter_code,
          guide: guideFrom(row.guide),
        }}
      />
    </>
  );
}
