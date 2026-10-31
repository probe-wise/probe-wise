import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { setDefaultRubric } from "@/app/actions/library";
import { ActionButton } from "@/components/library/archive-button";
import { requireMember } from "@/lib/dal";
import { ROUNDS, ROUND_TYPES } from "@/lib/interview/rounds";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Rubrics" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function RubricsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="page-narrow max-w-3xl! grid gap-8 py-12">
      <header className="grid gap-2">
        <h1 className="text-[2.2rem]!">Rubrics</h1>
        <p className="lede">
          What interviewers grade on. Each round type has a built-in rubric; admins can add their own and pick the
          default. Every interview keeps a copy of the rubric it was scheduled with.
        </p>
      </header>
      <Suspense fallback={<div className="skeleton h-96" aria-hidden="true" />}>
        <Rubrics searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Rubrics({ searchParams }: { searchParams: SearchParams }) {
  const { org, member } = await requireMember("/rubrics");
  const params = await searchParams;
  const isAdmin = member.role === "admin";
  const supabase = await createClient();
  const { data: rubrics } = await supabase.from("rubrics").select("*").eq("org_id", org.id).is("archived_at", null).order("name");

  return (
    <div className="grid gap-10">
      {params.archived === "1" ? (
        <p className="notice notice-success" role="status">
          Rubric archived.
        </p>
      ) : null}
      {ROUND_TYPES.map((round) => {
        const mine = (rubrics ?? []).filter((r) => r.round_type === round.value);
        const builtInDefault = !mine.some((r) => r.is_default);
        return (
          <section key={round.value} aria-labelledby={`${round.value}-h`} className="grid gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`${round.value}-h`} className="text-[1.3rem]!">
                {round.label}
              </h2>
              {isAdmin ? (
                <Link href={`/rubrics/new?round=${round.value}`} className="link">
                  New {round.label.toLowerCase()} rubric
                </Link>
              ) : null}
            </div>
            <ul className="grid gap-2">
              <li className="panel flex flex-wrap items-center justify-between gap-3 py-3!">
                <div className="grid">
                  <Link href={`/rubrics/new?round=${round.value}&view=builtin`} className="font-semibold hover:underline">
                    {ROUNDS[round.value].rubric.name}
                  </Link>
                  <span className="faint">
                    {ROUNDS[round.value].rubric.aspects.map((a) => a.label).join(" · ")}
                  </span>
                </div>
                {builtInDefault ? (
                  <span className="chip border-marker! text-ink!">Default</span>
                ) : isAdmin ? (
                  <ActionButton run={setDefaultRubric.bind(null, round.value, null)} label="Make default" pendingLabel="Saving…" />
                ) : null}
              </li>
              {mine.map((r) => (
                <li key={r.id} className="panel flex flex-wrap items-center justify-between gap-3 py-3!">
                  <div className="grid">
                    <Link href={`/rubrics/${r.id}`} className="font-semibold hover:underline">
                      {r.name}
                    </Link>
                    <span className="faint">{r.aspects.map((a) => a.label).join(" · ")}</span>
                  </div>
                  {r.is_default ? (
                    <span className="chip border-marker! text-ink!">Default</span>
                  ) : isAdmin ? (
                    <ActionButton run={setDefaultRubric.bind(null, round.value, r.id)} label="Make default" pendingLabel="Saving…" />
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {!isAdmin ? <p className="muted">Only admins can add or change rubrics.</p> : null}
    </div>
  );
}
