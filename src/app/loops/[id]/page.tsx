import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CalendarNotice } from "@/components/calendar-notice";
import { requireMember } from "@/lib/dal";
import type { AspectScores } from "@/lib/database.types";
import { RECOMMENDATIONS, averageScore, recommendationLabel, type Scores } from "@/lib/interview/rubric";
import { roundLabel, sessionRubric } from "@/lib/interview/rounds";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Interview loop" };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const STATUS = { lobby: "Scheduled", in_progress: "In progress", completed: "Finished", cancelled: "Cancelled" } as const;
const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

export default function LoopPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <div className="page py-12">
      <Suspense fallback={<div className="skeleton h-[60dvh]" aria-hidden="true" />}>
        <Loop params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Loop({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { id } = await params;
  const query = await searchParams;
  const { org, member } = await requireMember(`/loops/${id}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: loop } = await supabase.from("interview_loops").select("*").eq("id", id).eq("org_id", org.id).maybeSingle();
  if (!loop) notFound();

  const [{ data: candidate }, { data: sessions }] = await Promise.all([
    supabase.from("candidates").select("id, full_name, role_title").eq("id", loop.candidate_id).maybeSingle(),
    supabase
      .from("interview_sessions")
      .select("id, round_type, status, problem_title, scheduled_at, started_at, rubric")
      .eq("loop_id", id)
      .order("scheduled_at", { ascending: true, nullsFirst: false })
      .order("created_at"),
  ]);
  const ids = (sessions ?? []).map((s) => s.id);
  // RLS releases scorecards and AI assessments per ADR 0006: what we get is what this viewer may see.
  const [{ data: participants }, { data: evaluations }, { data: ai }] = ids.length
    ? await Promise.all([
        supabase.from("session_participants").select("id, session_id, user_id, role, display_name, joined_at").in("session_id", ids),
        supabase.from("session_evaluations").select("*").in("session_id", ids).not("submitted_at", "is", null),
        supabase.from("session_ai_assessments").select("*").in("session_id", ids).eq("status", "completed"),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const names = new Map((participants ?? []).map((p) => [p.id, p.display_name]));
  const rounds = (sessions ?? []).map((s) => {
    const mine = (participants ?? []).find((p) => p.session_id === s.id && p.user_id === member.user_id && p.role === "interviewer" && p.joined_at);
    const cards = (evaluations ?? []).filter((e) => e.session_id === s.id);
    const locked = Boolean(mine) && !cards.some((e) => e.participant_id === mine!.id);
    return {
      ...s,
      rubric: sessionRubric(s),
      interviewers: (participants ?? []).filter((p) => p.session_id === s.id && p.role === "interviewer").map((p) => p.display_name),
      cards,
      ai: (ai ?? []).find((a) => a.session_id === s.id) ?? null,
      locked,
    };
  });
  const tally = RECOMMENDATIONS.map((r) => ({ ...r, count: rounds.flatMap((x) => x.cards).filter((c) => c.recommendation === r.value).length }));
  const totalCards = tally.reduce((a, b) => a + b.count, 0);
  const anyLocked = rounds.some((r) => r.locked);

  return (
    <div className="grid gap-12">
      <CalendarNotice params={query} />
      <header className="grid gap-2">
        {candidate ? (
          <Link href={`/candidates/${candidate.id}`} className="link text-[0.95rem]">
            ← {candidate.full_name}
          </Link>
        ) : null}
        <h1 className="text-[2.2rem]!">{loop.name}</h1>
        <p className="lede">
          {rounds.length} round{rounds.length === 1 ? "" : "s"} · {rounds.filter((r) => r.status === "completed").length} finished
          {candidate?.role_title ? ` · ${candidate.role_title}` : ""}
        </p>
      </header>

      <section aria-labelledby="overall-h" className="grid gap-3">
        <h2 id="overall-h">Overall</h2>
        {anyLocked ? (
          <p className="notice notice-info">
            Some rounds stay hidden until you submit your scorecard for them, so your scores are your own.
          </p>
        ) : null}
        {totalCards ? (
          <div className="flex flex-wrap gap-3">
            {tally.map((t) => (
              <div key={t.value} className="panel grid min-w-32 gap-0.5 py-3!">
                <span className="text-[1.6rem] font-semibold tabular-nums">{t.count}</span>
                <span className="faint">{t.label}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No scorecards submitted yet.</p>
        )}
        <p className="faint">Counts every submitted scorecard across the loop. The AI&apos;s recommendations are listed per round, not counted here.</p>
      </section>

      <section aria-labelledby="rounds-h" className="grid gap-6">
        <h2 id="rounds-h">Rounds</h2>
        {rounds.map((r, i) => (
          <article key={r.id} className="panel grid gap-4">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-0.5">
                <p className="faint">
                  Round {i + 1} · {roundLabel(r.round_type)} · {STATUS[r.status]}
                  {r.scheduled_at ? ` · ${when(r.scheduled_at)}` : ""}
                </p>
                <h3>{r.problem_title}</h3>
                <p className="faint">
                  {r.interviewers.join(", ")} · {r.rubric.name}
                </p>
              </div>
              <Link href={r.status === "completed" ? `/interview/${r.id}/review` : `/interview/${r.id}`} className="btn btn-secondary">
                {r.status === "completed" ? "Review" : "Open"}
              </Link>
            </header>
            {r.locked ? (
              <p className="muted">Submit your scorecard for this round to see the others.</p>
            ) : r.cards.length || r.ai ? (
              <RoundTable round={r} names={names} />
            ) : r.status === "completed" ? (
              <p className="muted">No scorecards yet.</p>
            ) : null}
          </article>
        ))}
        {!rounds.length ? <p className="muted">No rounds in this loop.</p> : null}
      </section>
    </div>
  );
}

type RoundData = {
  rubric: ReturnType<typeof sessionRubric>;
  cards: { id: string; participant_id: string; scores: AspectScores; recommendation: string | null }[];
  ai: { scores: AspectScores; recommendation: string | null } | null;
};

function RoundTable({ round, names }: { round: RoundData; names: Map<string, string> }) {
  const columns = [
    ...round.cards.map((c) => ({ key: c.id, label: names.get(c.participant_id) ?? "Interviewer", scores: c.scores, recommendation: c.recommendation })),
    ...(round.ai ? [{ key: "ai", label: "AI (advisory)", scores: round.ai.scores, recommendation: round.ai.recommendation }] : []),
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] text-left text-[0.9rem]">
        <thead className="text-ink-faint">
          <tr className="border-b border-grid">
            <th className="py-1.5 font-semibold">Aspect</th>
            {columns.map((c) => (
              <th key={c.key} className="py-1.5 text-right font-semibold">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {round.rubric.aspects.map((a) => (
            <tr key={a.key} className="border-b border-grid">
              <td className="py-1.5">{a.label}</td>
              {columns.map((c) => (
                <td key={c.key} className="py-1.5 text-right tabular-nums">
                  {c.scores[a.key]?.score ?? "–"}
                </td>
              ))}
            </tr>
          ))}
          <tr className="border-b border-grid">
            <td className="py-1.5 font-semibold">Average</td>
            {columns.map((c) => (
              <td key={c.key} className="py-1.5 text-right font-semibold tabular-nums">
                {averageScore(c.scores as Scores) ?? "–"}
              </td>
            ))}
          </tr>
          <tr>
            <td className="py-1.5 font-semibold">Recommendation</td>
            {columns.map((c) => (
              <td key={c.key} className="py-1.5 text-right font-semibold">
                {recommendationLabel(c.recommendation) || "–"}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
