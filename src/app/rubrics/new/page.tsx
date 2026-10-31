import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { RubricEditor } from "@/components/library/rubric-editor";
import { requireMember } from "@/lib/dal";
import { ROUNDS, isRoundType } from "@/lib/interview/rounds";

export const metadata: Metadata = { title: "New rubric" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function NewRubricPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="page-narrow max-w-3xl! grid gap-8 py-12">
      <Link href="/rubrics" className="link text-[0.95rem]">
        ← Rubrics
      </Link>
      <Suspense fallback={<div className="skeleton h-96" aria-hidden="true" />}>
        <Editor searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Editor({ searchParams }: { searchParams: SearchParams }) {
  const { member } = await requireMember("/rubrics/new");
  const params = await searchParams;
  const round = ROUNDS[isRoundType(params.round) ? params.round : "system_design"];
  const viewing = params.view === "builtin" || member.role !== "admin";
  return (
    <>
      <header className="grid gap-2">
        <p className="faint">{round.label}</p>
        <h1 className="text-[2rem]!">{viewing ? round.rubric.name : `New ${round.label.toLowerCase()} rubric`}</h1>
        <p className="lede">
          {viewing
            ? "The built-in rubric. Admins can start a custom one from it."
            : "Starts as a copy of the built-in rubric. Rename, remove or add aspects (up to 12)."}
        </p>
        {viewing && member.role === "admin" ? (
          <Link href={`/rubrics/new?round=${round.value}`} className="link">
            Make a custom rubric from this
          </Link>
        ) : null}
      </header>
      <RubricEditor
        id={null}
        round={round.value}
        initial={viewing ? round.rubric : { name: `${round.label} rubric`, aspects: round.rubric.aspects }}
        readOnly={viewing}
      />
    </>
  );
}
