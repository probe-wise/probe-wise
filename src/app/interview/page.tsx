import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SessionList } from "@/components/interview/session-list";
import { requireMember } from "@/lib/dal";
import { listWorkspaceSessions } from "@/lib/interview/session-dal";

export const metadata: Metadata = { title: "Interviews" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const FILTERS = [
  { value: "all", label: "All" },
  { value: "mine", label: "Mine" },
  { value: "open", label: "Scheduled and live" },
  { value: "finished", label: "Finished" },
] as const;

export default function InterviewsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="page-narrow max-w-3xl! grid gap-6 py-12">
      <h1 className="text-[2.2rem]!">Interviews</h1>
      <Suspense fallback={<div className="skeleton h-64" aria-hidden="true" />}>
        <Interviews searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Interviews({ searchParams }: { searchParams: SearchParams }) {
  await requireMember("/interview");
  const params = await searchParams;
  const filter = FILTERS.find((f) => f.value === params.show)?.value ?? "all";
  const sessions = await listWorkspaceSessions({
    mineOnly: filter === "mine",
    status: filter === "open" ? ["lobby", "in_progress"] : filter === "finished" ? ["completed"] : undefined,
    limit: 100,
  });
  return (
    <div className="grid gap-5">
      <nav aria-label="Filter interviews" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={f.value === "all" ? "/interview" : `/interview?show=${f.value}`}
            className={`chip ${filter === f.value ? "border-marker! text-ink!" : ""}`}
            aria-current={filter === f.value ? "page" : undefined}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      <SessionList
        sessions={sessions}
        empty={
          <p className="muted">
            No interviews here yet.{" "}
            <Link href="/candidates" className="link">
              Pick a candidate
            </Link>{" "}
            to schedule one.
          </p>
        }
      />
    </div>
  );
}
