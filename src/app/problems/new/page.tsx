import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ProblemForm } from "@/components/library/problem-form";
import { requireMember } from "@/lib/dal";

export const metadata: Metadata = { title: "New problem" };

export default function NewProblemPage() {
  return (
    <div className="page-narrow max-w-3xl! grid gap-8 py-12">
      <Link href="/problems" className="link text-[0.95rem]">
        ← Problems
      </Link>
      <header className="grid gap-2">
        <h1 className="text-[2.2rem]!">New problem</h1>
        <p className="lede">Your team&apos;s own system design problem, coding exercise or behavioural question set.</p>
      </header>
      <Suspense fallback={<div className="skeleton h-96" aria-hidden="true" />}>
        <Form />
      </Suspense>
    </div>
  );
}

async function Form() {
  await requireMember("/problems/new");
  return <ProblemForm />;
}
