import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { archiveRubric } from "@/app/actions/library";
import { ActionButton } from "@/components/library/archive-button";
import { RubricEditor } from "@/components/library/rubric-editor";
import { requireMember } from "@/lib/dal";
import { roundLabel } from "@/lib/interview/rounds";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Rubric" };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function RubricPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <div className="page-narrow max-w-3xl! grid gap-8 py-12">
      <Link href="/rubrics" className="link text-[0.95rem]">
        ← Rubrics
      </Link>
      <Suspense fallback={<div className="skeleton h-96" aria-hidden="true" />}>
        <Rubric params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Rubric({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { id } = await params;
  const query = await searchParams;
  const { org, member } = await requireMember(`/rubrics/${id}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: rubric } = await supabase.from("rubrics").select("*").eq("id", id).eq("org_id", org.id).maybeSingle();
  if (!rubric || rubric.archived_at) notFound();
  const isAdmin = member.role === "admin";
  return (
    <>
      {query.created === "1" ? (
        <p className="notice notice-success" role="status">
          Rubric created. Make it the default on the rubrics page, or pick it per round when scheduling.
        </p>
      ) : null}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-2">
          <p className="faint">
            {roundLabel(rubric.round_type)}
            {rubric.is_default ? " · default" : ""}
          </p>
          <h1 className="text-[2rem]!">{rubric.name}</h1>
        </div>
        {isAdmin ? <ActionButton run={archiveRubric.bind(null, rubric.id)} label="Archive" pendingLabel="Archiving…" className="btn btn-secondary" /> : null}
      </header>
      <RubricEditor id={rubric.id} round={rubric.round_type} initial={{ name: rubric.name, aspects: rubric.aspects }} readOnly={!isAdmin} />
    </>
  );
}
