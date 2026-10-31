import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CandidateForm } from "@/components/candidates/candidate-form";
import { requireMember } from "@/lib/dal";

export const metadata: Metadata = { title: "Add a candidate" };

export default function NewCandidatePage() {
  return (
    <div className="page-narrow max-w-3xl! grid gap-8 py-12">
      <Link href="/candidates" className="link text-[0.95rem]">
        ← Candidates
      </Link>
      <header className="grid gap-2">
        <h1 className="text-[2.2rem]!">Add a candidate</h1>
        <p className="lede">Next you&apos;ll schedule their interview and pick who runs it.</p>
      </header>
      <Suspense fallback={<div className="skeleton h-96" aria-hidden="true" />}>
        <Form />
      </Suspense>
    </div>
  );
}

async function Form() {
  await requireMember("/candidates/new");
  return <CandidateForm />;
}
