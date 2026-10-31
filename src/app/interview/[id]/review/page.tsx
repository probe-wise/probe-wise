import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { BoardViewer } from "@/components/interview/board-viewer";
import { AiAssessmentPanel } from "@/components/interview/ai-assessment-panel";
import { EvaluationForm } from "@/components/interview/evaluation-form";
import { requireViewer } from "@/lib/dal";
import type { AiAssessmentRow, AspectScores, SessionEvaluationRow, SessionParticipantRow } from "@/lib/database.types";
import { isAiAssessmentConfigured } from "@/lib/env";
import type { BoardElement } from "@/lib/interview/board";
import { eventLabel, eventText, type SessionEvent } from "@/lib/interview/events";
import { computeMetrics, formatDuration } from "@/lib/interview/metrics";
import { averageScore, recommendationLabel, scoreLabel, type Scores } from "@/lib/interview/rubric";
import { anyPhaseLabel, codeLanguageLabel, roundOf, sessionRubric, type Rubric } from "@/lib/interview/rounds";
import {
  getAiAssessment,
  getBoardEventMeta,
  getEvaluations,
  getSessionCandidate,
  getMyInterviewerNotes,
  getSessionEvents,
  getSessionView,
  verifySessionLog,
} from "@/lib/interview/session-dal";
import { loadProblem } from "@/lib/problems/problem-source";

export const metadata: Metadata = { title: "Interview review" };

type Params = Promise<{ id: string }>;

export default function ReviewPage({ params }: { params: Params }) {
  return (
    <div className="page py-12">
      <Suspense fallback={<div className="skeleton h-[70dvh]" aria-label="Loading the review" />}>
        <Review params={params} />
      </Suspense>
    </div>
  );
}

const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

async function Review({ params }: { params: Params }) {
  const { id } = await params;
  await requireViewer(`/interview/${id}/review`);
  const view = await getSessionView(id);
  if (!view) notFound();
  const { session, participants, me, isStaff } = view;
  // Reviews are for the hiring team. The candidate's room shows them a closing message instead.
  if (!isStaff || session.status === "lobby" || session.status === "in_progress") redirect(`/interview/${id}`);

  const isInterviewer = me?.role === "interviewer";
  const [events, boardMeta, evaluations, integrity, privateNotes, ai, candidate] = await Promise.all([
    getSessionEvents(id, { includeBoard: false }),
    getBoardEventMeta(id),
    getEvaluations(id),
    verifySessionLog(id),
    isInterviewer && me ? getMyInterviewerNotes(id, me.id) : Promise.resolve(""),
    getAiAssessment(id),
    getSessionCandidate(session.candidate_id),
  ]);
  const all = [...events, ...boardMeta].sort((a, b) => a.seq - b.seq);
  const round = roundOf(session.round_type);
  const rubric = sessionRubric(session);
  const phaseKeys = round.phases.map((p) => p.value);
  const metrics = computeMetrics(all, session.phase_plan, session.ended_at ?? undefined, phaseKeys);
  const names = new Map(participants.map((p) => [p.id, p]));
  const problem = await loadProblem(session.problem_slug);
  const mine = me ? (evaluations.find((e) => e.participant_id === me.id) ?? null) : null;
  const submitted = evaluations.filter((e) => e.submitted_at);
  // Anti-anchoring (ADR 0006): an interviewer sees others' scorecards and the AI's only after submitting.
  const locked = isInterviewer && !mine?.submitted_at;
  const aiDone = ai?.status === "completed" ? ai : null;
  // A run that hasn't finished in 10 minutes died with its request (the database allows a retry then).
  const stale = ai?.status === "running" && new Date(ai.requested_at).getTime() < new Date().getTime() - 10 * 60_000;
  const aiState =
    ai && ai.status !== "completed"
      ? stale
        ? { status: "failed" as const, error: "The last attempt didn't finish. Try again." }
        : { status: ai.status, error: ai.error }
      : null;
  const reached = phaseKeys.filter((p) => metrics.path.includes(p));

  if (session.status === "cancelled") {
    return (
      <div className="page-narrow grid gap-4">
        <h1 className="text-[2rem]!">This interview was cancelled</h1>
        <p className="lede">It never started, so there&apos;s nothing to review.</p>
        <Link href="/interview" className="link">
          All interviews
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-12">
      <header className="grid gap-3">
        <p className="faint">
          {round.label} ·{" "}
          {candidate ? (
            <Link href={`/candidates/${candidate.id}`} className="link">
              {candidate.full_name}
            </Link>
          ) : (
            "Candidate"
          )}
          {candidate?.role_title ? ` · ${candidate.role_title}` : ""} · {when(session.started_at ?? session.created_at)}
          {session.end_reason === "ended_early" ? " · the candidate ended it early" : ""}
        </p>
        <h1 className="text-[2.2rem]!">{session.problem_title}</h1>
        <p className="muted">
          {participants
            .filter((p) => p.joined_at)
            .map((p) => `${p.display_name} (${p.role})`)
            .join(" · ")}{" "}
          ·{" "}
          {metrics.durationMs != null ? `${formatDuration(metrics.durationMs)} of ${formatDuration(metrics.plannedMs)} planned` : ""}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <IntegrityBadge integrity={integrity} />
          {session.loop_id ? (
            <Link href={`/loops/${session.loop_id}`} className="btn btn-secondary">
              Loop summary
            </Link>
          ) : null}
          <a href={`/interview/${id}/export`} className="btn btn-secondary" download>
            Export full record (JSON)
          </a>
        </div>
      </header>

      <section aria-labelledby="eval-h" className="grid gap-6">
        <h2 id="eval-h">Scorecards</h2>
        {isInterviewer && !mine?.submitted_at ? (
          <div className="panel">
            <h3 className="mb-3">Your scorecard</h3>
            <EvaluationForm sessionId={id} draft={mine} rubric={rubric} phaseKeys={phaseKeys} reached={reached} />
          </div>
        ) : null}
        {locked ? (
          <p className="notice notice-info">
            Other scorecards and the AI assessment unlock when you submit yours, so your scores stay your own.
          </p>
        ) : (
          <>
            {submitted.length || aiDone ? (
              <ScoreComparison evaluations={submitted} ai={aiDone} names={names} myId={me?.id ?? null} rubric={rubric} />
            ) : null}
            {submitted.length ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {submitted.map((e) => (
                  <EvaluationCard key={e.id} evaluation={e} author={names.get(e.participant_id)} isMine={e.participant_id === me?.id} rubric={rubric} />
                ))}
              </div>
            ) : (
              <p className="muted">No scorecards submitted yet.</p>
            )}
          </>
        )}
      </section>

      {!locked ? (
        <section aria-labelledby="ai-h" className="grid gap-4">
          <h2 id="ai-h">AI assessment</h2>
          {aiDone ? (
            <AiCard ai={aiDone} rubric={rubric} />
          ) : (
            <AiAssessmentPanel sessionId={id} configured={isAiAssessmentConfigured()} state={aiState} />
          )}
        </section>
      ) : null}

      <section aria-labelledby="time-h" className="grid gap-4">
        <h2 id="time-h">Where the time went</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-[0.93rem]">
            <thead className="text-ink-faint">
              <tr className="border-b border-grid">
                <th className="py-2 font-semibold">Phase</th>
                <th className="py-2 text-right font-semibold">Planned</th>
                <th className="py-2 text-right font-semibold">Actual</th>
                <th className="py-2 text-right font-semibold">Probes</th>
                {round.workspace !== "conversation" ? (
                  <th className="py-2 text-right font-semibold">{round.workspace === "code" ? "Code edits" : "Board edits"}</th>
                ) : null}
                <th className="py-2 text-right font-semibold">Messages</th>
              </tr>
            </thead>
            <tbody>
              {metrics.phases.map((p) => {
                const over = p.actualMs - p.plannedMs;
                return (
                  <tr key={p.phase} className="border-b border-grid">
                    <td className="py-2">{anyPhaseLabel(p.phase)}</td>
                    <td className="py-2 text-right tabular-nums">{formatDuration(p.plannedMs)}</td>
                    <td className={`py-2 text-right tabular-nums ${p.visits && over > 60_000 ? "text-probe" : ""}`}>
                      {p.visits ? formatDuration(p.actualMs) : "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums">{p.probes}</td>
                    {round.workspace !== "conversation" ? (
                      <td className="py-2 text-right tabular-nums">{round.workspace === "code" ? p.codeEdits : p.boardEdits}</td>
                    ) : null}
                    <td className="py-2 text-right tabular-nums">{p.chatMessages}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted text-[0.93rem]">
          Path: {metrics.path.map(anyPhaseLabel).join(" → ") || "—"}.{" "}
          {round.workspace !== "board"
            ? ""
            : metrics.firstBoardEditMs != null
              ? `First thing drawn ${formatDuration(metrics.firstBoardEditMs)} in.`
              : "Nothing was drawn on the board."}
        </p>
      </section>

      <section aria-labelledby="board-h" className="grid gap-4">
        <h2 id="board-h">Final board and notes</h2>
        {round.workspace === "board" ? <BoardViewer elements={session.board as BoardElement[]} /> : null}
        {round.workspace === "code" ? (
          <div className="grid gap-1.5">
            <h3>Final code · {codeLanguageLabel(session.code_language)}</h3>
            <pre className="max-h-[36rem] overflow-auto rounded-lg border border-grid bg-board-raised p-3 font-mono text-[0.85rem]">
              {session.code || "No code was written."}
            </pre>
          </div>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid gap-1.5">
            <h3>Candidate&apos;s notes</h3>
            <pre className="whitespace-pre-wrap rounded-lg border border-grid bg-board-raised p-3 font-mono text-[0.85rem]">
              {session.notes || "No notes."}
            </pre>
          </div>
          {isInterviewer ? (
            <div className="grid gap-1.5">
              <h3>Your private notes</h3>
              <pre className="whitespace-pre-wrap rounded-lg border border-grid bg-board-raised p-3 font-mono text-[0.85rem]">
                {privateNotes || "No notes."}
              </pre>
            </div>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="transcript-h" className="grid gap-4">
        <h2 id="transcript-h">Transcript</h2>
        <Transcript events={events} names={names} />
      </section>

      {problem ? (
        <section aria-labelledby="learn-h" className="grid gap-4">
          <h2 id="learn-h">What a strong answer covers</h2>
          {problem.version !== session.problem_version ? (
            <p className="faint">This problem has been updated since this interview (v{session.problem_version} → v{problem.version}).</p>
          ) : null}
          <div className="grid gap-6 lg:grid-cols-3">
            <List title={round.workspace === "board" ? "Reference outline" : round.workspace === "code" ? "Reference approach" : "What good answers cover"} items={problem.guide.reference} />
            <List title="Strong signals" items={problem.guide.strongSignals} />
            <List title="Common pitfalls" items={problem.guide.pitfalls} />
          </div>
        </section>
      ) : null}

      <section aria-labelledby="log-h" className="grid gap-3">
        <h2 id="log-h">Audit log</h2>
        <p className="muted text-[0.93rem]">
          Every recorded action in order. Board edits are summarised here; the export has their full contents.
        </p>
        <details>
          <summary className="cursor-pointer font-semibold">Show all {all.length} events</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-[0.85rem]">
              <thead className="text-ink-faint">
                <tr className="border-b border-grid">
                  <th className="py-1.5">#</th>
                  <th className="py-1.5">Time</th>
                  <th className="py-1.5">Phase</th>
                  <th className="py-1.5">Who</th>
                  <th className="py-1.5">What</th>
                </tr>
              </thead>
              <tbody>
                {all.map((e) => (
                  <tr key={e.seq} className="border-b border-grid align-top">
                    <td className="py-1.5 tabular-nums text-ink-faint">{e.seq}</td>
                    <td className="py-1.5 tabular-nums">{clock(e.created_at)}</td>
                    <td className="py-1.5">{e.phase ? anyPhaseLabel(e.phase) : "—"}</td>
                    <td className="py-1.5">{e.participant_id ? (names.get(e.participant_id)?.display_name ?? "—") : "System"}</td>
                    <td className="py-1.5">
                      {eventLabel(e.type)}
                      {describe(e)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </div>
  );
}

function describe(e: SessionEvent) {
  const text = eventText(e);
  if (e.type === "phase.changed") return `: ${anyPhaseLabel(String(e.payload.to))}`;
  if (e.type === "session.ended") return ` (${String(e.payload.reason).replace("_", " ")})`;
  if (e.type === "chat.message" || e.type === "probe.asked") return `: ${text.length > 120 ? `${text.slice(0, 120)}…` : text}`;
  if (e.type === "notes.updated" || e.type === "interviewer_note.updated") return ` (${text.length} characters)`;
  return "";
}

function IntegrityBadge({ integrity }: { integrity: Awaited<ReturnType<typeof verifySessionLog>> }) {
  if (!integrity) return <span className="chip">Integrity check unavailable</span>;
  return integrity.ok ? (
    <span className="chip border-pass! text-pass!" title={`Chain head ${integrity.head_hash}`}>
      ✓ Record verified · {integrity.event_count} events · {integrity.head_hash.slice(0, 12)}
    </span>
  ) : (
    <span className="chip border-probe! text-probe!" role="alert">
      ✗ Record failed verification at event #{integrity.first_bad_seq}
    </span>
  );
}

function EvaluationCard({
  evaluation,
  author,
  isMine,
  rubric,
}: {
  evaluation: SessionEvaluationRow;
  author: SessionParticipantRow | undefined;
  isMine: boolean;
  rubric: Rubric;
}) {
  const scores = evaluation.scores as Scores;
  const avg = averageScore(scores);
  return (
    <article className="panel grid content-start gap-3">
      <header className="grid gap-1">
        <p className="faint">
          Scorecard · {isMine ? "you" : (author?.display_name ?? "Unknown")} · submitted {when(evaluation.submitted_at!)}
        </p>
        <h3>
          {evaluation.recommendation ? `${recommendationLabel(evaluation.recommendation)} · ` : ""}
          {avg != null ? `average ${avg} / 4` : "not scored"}
        </h3>
      </header>
      <dl className="grid gap-2">
        {rubric.aspects.map((a) => {
          const p = { value: a.key, label: a.label };
          const s = scores[p.value];
          if (!s || (s.score == null && !s.evidence)) return null;
          return (
            <div key={p.value} className="grid gap-0.5">
              <dt className="font-semibold">
                {p.label}: {s.score ?? "–"} <span className="faint font-normal">({scoreLabel(s.score)})</span>
              </dt>
              {s.evidence ? <dd className="muted whitespace-pre-wrap text-[0.93rem]">{s.evidence}</dd> : null}
            </div>
          );
        })}
      </dl>
      {evaluation.summary ? <p className="whitespace-pre-wrap border-t border-grid pt-3">{evaluation.summary}</p> : null}
      <p className="faint text-[0.8rem]">{rubric.name} · scored 1–4</p>
    </article>
  );
}

const scoreOf = (scores: AspectScores, aspect: string) => scores[aspect]?.score ?? null;

/** Every aspect side by side: each submitted scorecard, then the AI. Spread shows where to talk. */
function ScoreComparison({
  evaluations,
  ai,
  names,
  myId,
  rubric,
}: {
  evaluations: SessionEvaluationRow[];
  ai: AiAssessmentRow | null;
  names: Map<string, SessionParticipantRow>;
  myId: string | null;
  rubric: Rubric;
}) {
  const columns = [
    ...evaluations.map((e) => ({
      key: e.id,
      label: e.participant_id === myId ? "You" : (names.get(e.participant_id)?.display_name ?? "Interviewer"),
      scores: e.scores,
      recommendation: e.recommendation,
    })),
    ...(ai ? [{ key: "ai", label: "AI (advisory)", scores: ai.scores, recommendation: ai.recommendation }] : []),
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[30rem] text-left text-[0.93rem]">
        <thead className="text-ink-faint">
          <tr className="border-b border-grid">
            <th className="py-2 font-semibold">Aspect</th>
            {columns.map((c) => (
              <th key={c.key} className="py-2 text-right font-semibold">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rubric.aspects.map((r) => {
            const a = { value: r.key, label: r.label };
            const values = columns.map((c) => scoreOf(c.scores, a.value)).filter((v): v is number => v != null);
            const split = values.length > 1 && Math.max(...values) - Math.min(...values) >= 2;
            return (
              <tr key={a.value} className="border-b border-grid">
                <td className="py-2">
                  {a.label}
                  {split ? <span className="ml-2 text-[0.8rem] text-probe">split</span> : null}
                </td>
                {columns.map((c) => (
                  <td key={c.key} className="py-2 text-right tabular-nums" title={scoreLabel(scoreOf(c.scores, a.value))}>
                    {scoreOf(c.scores, a.value) ?? "–"}
                  </td>
                ))}
              </tr>
            );
          })}
          <tr>
            <td className="py-2 font-semibold">Recommendation</td>
            {columns.map((c) => (
              <td key={c.key} className="py-2 text-right font-semibold">
                {recommendationLabel(c.recommendation) || "–"}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function AiCard({ ai, rubric }: { ai: AiAssessmentRow; rubric: Rubric }) {
  const scores = ai.scores as Scores;
  const avg = averageScore(scores);
  return (
    <article className="panel grid content-start gap-4">
      <header className="grid gap-1">
        <p className="faint">
          Generated {when(ai.completed_at!)} by {ai.model ?? "Claude"} · advisory, from the recording only
        </p>
        <h3>
          {recommendationLabel(ai.recommendation)} · {avg != null ? `average ${avg} / 4` : "not scored"}
        </h3>
      </header>
      {ai.summary ? <p className="whitespace-pre-wrap">{ai.summary}</p> : null}
      <div className="grid gap-6 md:grid-cols-2">
        <List title="Strengths" items={ai.strengths.length ? ai.strengths : ["None listed."]} />
        <List title="Concerns" items={ai.concerns.length ? ai.concerns : ["None listed."]} />
      </div>
      <details>
        <summary className="cursor-pointer font-semibold">Evidence for each aspect</summary>
        <dl className="mt-3 grid gap-2">
          {rubric.aspects.map((r) => {
            const a = { value: r.key, label: r.label };
            const s = scores[a.value];
            if (!s) return null;
            return (
              <div key={a.value} className="grid gap-0.5">
                <dt className="font-semibold">
                  {a.label}: {s.score ?? "–"} <span className="faint font-normal">({scoreLabel(s.score)})</span>
                </dt>
                {s.evidence ? <dd className="muted whitespace-pre-wrap text-[0.93rem]">{s.evidence}</dd> : null}
              </div>
            );
          })}
        </dl>
      </details>
      <p className="faint text-[0.8rem]">
        The AI didn&apos;t see interviewers&apos; private notes or scorecards. It can miss anything said out loud that
        wasn&apos;t typed. Rubric v{ai.rubric_version}.
      </p>
    </article>
  );
}

function Transcript({ events, names }: { events: SessionEvent[]; names: Map<string, SessionParticipantRow> }) {
  const items = events.filter((e) => ["chat.message", "probe.asked", "phase.changed", "session.started", "session.ended"].includes(e.type));
  if (!items.some((e) => e.type === "chat.message" || e.type === "probe.asked")) {
    return <p className="muted">No messages or interviewer questions were recorded.</p>;
  }
  return (
    <ol className="grid max-h-[32rem] gap-2 overflow-y-auto rounded-xl border border-grid bg-board-raised p-4">
      {items.map((e) =>
        e.type === "chat.message" || e.type === "probe.asked" ? (
          <li key={e.seq} className={`grid gap-0.5 rounded-lg px-3 py-2 ${e.type === "probe.asked" ? "border-l-3 border-probe bg-probe-wash" : "bg-board"}`}>
            <span className="text-[0.8rem] text-ink-faint">
              {e.type === "probe.asked" ? <span className="hand text-[1rem] text-probe">Probe · </span> : null}
              <strong className="text-ink-soft">{(e.participant_id && names.get(e.participant_id)?.display_name) || "Someone"}</strong> ·{" "}
              {clock(e.created_at)}
            </span>
            <p className="whitespace-pre-wrap">{eventText(e)}</p>
          </li>
        ) : (
          <li key={e.seq} className="faint text-center text-[0.8rem]">
            {e.type === "phase.changed" ? `${anyPhaseLabel(String(e.payload.to))} · ${clock(e.created_at)}` : `${eventLabel(e.type)} · ${clock(e.created_at)}`}
          </li>
        ),
      )}
    </ol>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="grid content-start gap-2">
      <h3>{title}</h3>
      <ul className="list-disc space-y-1 pl-5 text-[0.95rem]">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}
