"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AutosaveTextarea } from "@/components/interview/autosave-textarea";
import { ChatPanel, phaseMarker, type FeedItem } from "@/components/interview/chat-panel";
import { InterviewerGuide } from "@/components/interview/interviewer-guide";
import { cancelInterview } from "@/app/actions/interview";
import { CandidateLinkPanel } from "@/components/interview/candidate-link-panel";
import type { CodeEditorHandle, CodeSaveState } from "@/components/interview/code-editor";
import { PhaseBar, useServerNow } from "@/components/interview/phase-bar";
import { useSessionChannel } from "@/components/interview/use-session-channel";
import type { SaveState, WhiteboardHandle } from "@/components/interview/whiteboard";
import type { InterviewSessionRow, SessionParticipantRow } from "@/lib/database.types";
import type { BoardElement } from "@/lib/interview/board";
import { sessionErrorMessage } from "@/lib/interview/errors";
import { eventText, type SessionEvent } from "@/lib/interview/events";
import { roundOf, sessionRubric } from "@/lib/interview/rounds";
import type { InterviewerGuide as Guide } from "@/lib/problems/types";
import { createClient } from "@/lib/supabase/client";

// Excalidraw and CodeMirror are large and browser-only: load them on demand, never on the server.
const Whiteboard = dynamic(() => import("@/components/interview/whiteboard"), {
  ssr: false,
  loading: () => <div className="skeleton h-full w-full rounded-none" aria-label="Loading the whiteboard" />,
});
const CodeEditor = dynamic(() => import("@/components/interview/code-editor"), {
  ssr: false,
  loading: () => <div className="skeleton h-full w-full rounded-none" aria-label="Loading the code editor" />,
});

type Props = {
  session: InterviewSessionRow;
  participants: SessionParticipantRow[];
  me: SessionParticipantRow;
  companyName: string;
  /** Hiring team only: lets the link panel offer to email the candidate. */
  candidateEmail?: string | null;
  emailEnabled?: boolean;
  /** Visible events up to session.last_seq, without board deltas (the board comes materialised). */
  events: SessionEvent[];
  privateNotes: string;
  guide: Guide | null;
  serverNow: string;
};

type Live = {
  status: InterviewSessionRow["status"];
  phase: string | null;
  phaseStartedAt: string | null;
  startedAt: string | null;
  endReason: string | null;
};

const NOTES_PLACEHOLDER = `Requirements
-

Estimates
-

API / data model
-

Open questions
- `;

function toFeed(events: SessionEvent[], names: Map<string, string>, myId: string): FeedItem[] {
  const out: FeedItem[] = [];
  for (const e of events) {
    if (e.type === "chat.message" || e.type === "probe.asked") {
      out.push({
        kind: e.type === "probe.asked" ? "probe" : "chat",
        seq: e.seq,
        author: (e.participant_id && names.get(e.participant_id)) || "Someone",
        role: e.actor_role,
        text: eventText(e),
        at: e.created_at,
        mine: e.participant_id === myId,
      });
    } else if (e.type === "phase.changed") {
      out.push({ kind: "phase", seq: e.seq, text: phaseMarker(String(e.payload.to)), at: e.created_at });
    } else if (e.type === "participant.joined") {
      out.push({ kind: "system", seq: e.seq, text: `${String(e.payload.display_name)} joined`, at: e.created_at });
    } else if (e.type === "session.started") {
      out.push({ kind: "system", seq: e.seq, text: "Interview started", at: e.created_at });
    }
  }
  return out;
}

export function InterviewRoom({
  session,
  participants: initialParticipants,
  me,
  companyName,
  candidateEmail = null,
  emailEnabled = false,
  events,
  privateNotes,
  guide,
  serverNow,
}: Props) {
  const round = roundOf(session.round_type);
  const rubric = sessionRubric(session);
  const centreIsChat = round.workspace === "conversation";
  const [offset] = useState(() => new Date(serverNow).getTime() - Date.now());
  const now = useServerNow(offset);
  const [participants, setParticipants] = useState(initialParticipants);
  const names = useMemo(() => new Map(participants.map((p) => [p.id, p.display_name])), [participants]);
  const [live, setLive] = useState<Live>({
    status: session.status,
    phase: session.phase,
    phaseStartedAt: session.phase_started_at,
    startedAt: session.started_at,
    endReason: session.end_reason,
  });
  const [feed, setFeed] = useState<FeedItem[]>(() => toFeed(events, names, me.id));
  const [sharedNotes, setSharedNotes] = useState(session.notes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staged, setStaged] = useState<{ id: number; text: string } | null>(null);
  const [boardSave, setBoardSave] = useState<SaveState>("idle");
  const [sideTab, setSideTab] = useState<"chat" | "guide" | "notes">(centreIsChat ? "guide" : "chat");
  const [codeSave, setCodeSave] = useState<CodeSaveState>("idle");
  const codeEditor = useRef<CodeEditorHandle | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const board = useRef<WhiteboardHandle | null>(null);
  const flushNotes = useRef<(() => Promise<void>) | null>(null);
  const flushPrivate = useRef<(() => Promise<void>) | null>(null);
  const pendingBoard = useRef<BoardElement[]>([]);
  const namesRef = useRef(names);
  useEffect(() => {
    namesRef.current = names;
  }, [names]);

  const isCandidate = me.role === "candidate";
  // Interviewers run the clock and the phases.
  const isController = !isCandidate;
  const running = live.status === "in_progress";
  const ended = live.status === "completed" || live.status === "cancelled";
  const plan = session.phase_plan;

  const refreshParticipants = useCallback(async () => {
    const { data } = await createClient()
      .from("session_participants")
      .select("*")
      .eq("session_id", session.id)
      .order("joined_at");
    if (data) setParticipants(data);
  }, [session.id]);

  const applyBoard = useCallback((elements: BoardElement[]) => {
    if (board.current) board.current.applyRemote(elements);
    else pendingBoard.current.push(...elements); // board still loading
  }, []);

  const onEvents = useCallback(
    (incoming: SessionEvent[]) => {
      let joined = false;
      for (const e of incoming) {
        switch (e.type) {
          case "session.started":
            setLive((l) => ({ ...l, status: "in_progress", startedAt: e.created_at }));
            break;
          case "phase.changed":
            setLive((l) => ({ ...l, phase: String(e.payload.to), phaseStartedAt: e.created_at }));
            break;
          case "session.ended": {
            const reason = String(e.payload.reason);
            setLive((l) => ({ ...l, status: reason === "cancelled" ? "cancelled" : "completed", endReason: reason }));
            break;
          }
          case "notes.updated":
            if (!isCandidate) setSharedNotes(eventText(e));
            break;
          case "board.updated":
            applyBoard((e.payload.elements as BoardElement[]) ?? []);
            break;
          case "code.updated":
            if (!isCandidate) codeEditor.current?.applyRemote(String(e.payload.text ?? ""), String(e.payload.language ?? ""));
            break;
          case "participant.joined":
            joined = true;
            break;
        }
      }
      if (joined) void refreshParticipants();
      const items = toFeed(incoming, namesRef.current, me.id);
      if (items.length) setFeed((f) => [...f, ...items.filter((i) => !f.some((x) => x.seq === i.seq))]);
    },
    [isCandidate, me.id, applyBoard, refreshParticipants],
  );

  const { connection, online, record, sendLiveBoard, sendLiveCode, rpc } = useSessionChannel({
    sessionId: session.id,
    role: me.role,
    participantId: me.id,
    displayName: me.display_name,
    initialSeq: session.last_seq,
    onEvents,
    onLiveBoard: applyBoard,
    onLiveCode: ({ text, language }) => {
      if (!isCandidate) codeEditor.current?.applyRemote(text, language);
    },
  });

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(sessionErrorMessage(err as { code?: string; message?: string }));
    } finally {
      setBusy(false);
    }
  };

  const endSession = () =>
    run(async () => {
      // Save everything pending first: once ended, the log is closed.
      await Promise.allSettled([board.current?.flush(), codeEditor.current?.flush(), flushNotes.current?.(), flushPrivate.current?.()]);
      await rpc("end_session", {});
      setConfirmEnd(false);
    });

  // Cancelling from the lobby goes through the server, which also withdraws the calendar invite.
  const cancelFromLobby = () =>
    run(async () => {
      const res = await cancelInterview(session.id);
      if (res.status === "error") throw new Error(res.message);
      setLive((l) => ({ ...l, status: "cancelled", endReason: "cancelled" }));
    });

  const onBoardReady = useCallback((handle: WhiteboardHandle) => {
    board.current = handle;
    if (pendingBoard.current.length) {
      handle.applyRemote(pendingBoard.current);
      pendingBoard.current = [];
    }
  }, []);

  const present = participants.filter((p) => p.joined_at);
  const interviewers = present.filter((p) => p.role === "interviewer");
  const candidateJoined = present.some((p) => p.role === "candidate");
  const connectionLabel = { connecting: "Connecting…", live: "Live", reconnecting: "Reconnecting…", offline: "Offline" }[connection];

  // ── Lobby ────────────────────────────────────────────────────────────────
  if (live.status === "lobby") {
    return (
      <div className="page grid gap-8 py-10 lg:grid-cols-[1.4fr_1fr]">
        <section className="grid content-start gap-4">
          <p className="faint">
            {companyName} · {round.label} interview · Lobby
          </p>
          <h1 className="text-[2rem]!">{session.problem_title}</h1>
          <p className="lede">{session.problem_snapshot.prompt}</p>
          {session.meeting_url ? (
            <p>
              <a href={session.meeting_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
                Join the video call ↗
              </a>
            </p>
          ) : null}
          <p className="notice notice-info">
            {isCandidate
              ? `This interview is recorded: ${round.workspace === "board" ? "the whiteboard, " : round.workspace === "code" ? "your code, " : ""}your notes, the chat and timings. Your interviewer starts the clock when you're both ready.`
              : `Everything in this interview is recorded: ${round.workspace === "board" ? "the whiteboard, " : round.workspace === "code" ? "the code, " : ""}notes, chat, your questions and timings. Your guide and private notes are only visible to interviewers.`}
          </p>
        </section>
        <aside className="panel grid content-start gap-5">
          <div className="grid gap-2">
            <h2 className="text-[1.2rem]!">Who&apos;s here</h2>
            <ul className="grid gap-1.5">
              {participants.map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  <span className={`inline-block size-2.5 rounded-full ${online.includes(p.id) ? "bg-pass" : "bg-grid"}`} aria-hidden="true" />
                  <span className="font-medium">{p.display_name}</span>
                  <span className="faint">
                    {p.role}
                    {p.id === me.id ? " (you)" : ""}
                    {!p.joined_at ? " · not joined yet" : ""}
                  </span>
                </li>
              ))}
              {!candidateJoined ? (
                <li className="flex items-center gap-2">
                  <span className="inline-block size-2.5 rounded-full bg-grid" aria-hidden="true" />
                  <span className="faint">Candidate · waiting for them to open their link</span>
                </li>
              ) : null}
            </ul>
          </div>
          {isController ? (
            <CandidateLinkPanel
              sessionId={session.id}
              candidateJoined={candidateJoined}
              candidateEmail={candidateEmail}
              emailEnabled={emailEnabled}
            />
          ) : null}
          {isController ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !candidateJoined}
              onClick={() => run(() => rpc("start_session", {}))}
            >
              {busy ? "Starting…" : candidateJoined ? "Start the interview" : "Start once the candidate joins"}
            </button>
          ) : (
            <p className="muted">
              {interviewers.length ? "Waiting for your interviewer to start." : "Waiting for your interviewer to join."}
            </p>
          )}
          {isController && session.scheduled_at ? (
            <a href={`/interview/${session.id}/invite.ics`} className="link justify-self-start text-[0.95rem]">
              Add to my calendar (.ics)
            </a>
          ) : null}
          {isController ? (
            <button type="button" className="btn btn-ghost justify-self-start" disabled={busy} onClick={cancelFromLobby}>
              Cancel this interview
            </button>
          ) : null}
          {error ? <p role="alert" className="notice notice-error">{error}</p> : null}
          <p className="faint">Connection: {connectionLabel}</p>
        </aside>
      </div>
    );
  }

  // ── Ended ────────────────────────────────────────────────────────────────
  if (ended) {
    if (isCandidate) {
      return (
        <div className="page-narrow grid gap-4 py-16 text-center">
          <h1 className="text-[2rem]!">{live.status === "cancelled" ? "This interview was cancelled" : "That's the end of the interview"}</h1>
          <p className="lede">
            {live.status === "cancelled"
              ? `${companyName} cancelled it before it started. They'll be in touch if they reschedule.`
              : `Thanks for your time. ${companyName}'s hiring team will follow up with next steps. You can close this tab.`}
          </p>
        </div>
      );
    }
    return (
      <div className="page-narrow grid gap-4 py-16 text-center">
        <h1 className="text-[2rem]!">{live.status === "cancelled" ? "Interview cancelled" : "Interview finished"}</h1>
        <p className="lede">
          {live.status === "cancelled"
            ? "Nothing was started, so there's nothing to review."
            : "Everything was recorded. Write your scorecard while it's fresh; other scorecards unlock once you submit."}
        </p>
        <div className="flex justify-center gap-3">
          {live.status === "completed" ? (
            <Link href={`/interview/${session.id}/review`} className="btn btn-primary">
              Write your scorecard
            </Link>
          ) : null}
          <Link href="/interview" className="btn btn-secondary">
            All interviews
          </Link>
        </div>
      </div>
    );
  }

  // ── Running ──────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-[36rem] flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-grid px-4 py-2">
        <div className="grid min-w-0">
          <h1 className="truncate text-[1.05rem]!" title={session.problem_title}>
            {session.problem_title}
          </h1>
          <p className="faint flex items-center gap-2 text-[0.8rem]">
            <span
              className={`inline-block size-2 rounded-full ${connection === "live" ? "bg-pass" : "bg-probe"}`}
              aria-hidden="true"
            />
            <span role="status">{connectionLabel}</span>
            <span aria-hidden="true">·</span>
            <span>Recording</span>
            {session.meeting_url ? (
              <>
                <span aria-hidden="true">·</span>
                <a href={session.meeting_url} target="_blank" rel="noopener noreferrer" className="link">
                  Video call ↗
                </a>
              </>
            ) : null}
            <span aria-hidden="true">·</span>
            <span>
              {present
                .map((p) => `${p.display_name}${online.includes(p.id) ? "" : " (away)"}`)
                .join(", ")}
            </span>
          </p>
        </div>
        <PhaseBar
          phase={live.phase}
          phaseStartedAt={live.phaseStartedAt}
          startedAt={live.startedAt}
          phases={round.phases}
          plan={plan}
          now={now}
          canControl={isController}
          busy={busy}
          onChangePhase={(p) => run(() => rpc("change_session_phase", { p_phase: p }))}
        />
        <div className="flex items-center gap-2">
          {confirmEnd ? (
            <>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={endSession}>
                {isController ? "Yes, end interview" : "Yes, leave"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmEnd(false)}>
                Keep going
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={() => setConfirmEnd(true)}>
              {isController ? "End interview" : "Leave interview"}
            </button>
          )}
        </div>
      </header>
      {error ? (
        <p role="alert" className="notice notice-error mx-4 mt-2">
          {error}
        </p>
      ) : null}

      <div
        className={`grid min-h-0 flex-1 grid-rows-[minmax(22rem,1fr)_auto] lg:grid-rows-1 ${
          centreIsChat && !guide ? "lg:grid-cols-[20rem_1fr]" : "lg:grid-cols-[20rem_1fr_22rem]"
        }`}
      >
        {/* Left: prompt + candidate notes */}
        <aside className="order-2 flex min-h-0 flex-col gap-4 overflow-y-auto border-grid p-4 lg:order-1 lg:border-r">
          <details open className="grid gap-2">
            <summary className="cursor-pointer font-semibold">The problem</summary>
            <p className="mt-2 text-[0.92rem]">{session.problem_snapshot.prompt}</p>
          </details>
          {!isCandidate ? (
            <details className="grid gap-2">
              <summary className="cursor-pointer font-semibold">Candidate link</summary>
              <div className="mt-2">
                <CandidateLinkPanel
                  sessionId={session.id}
                  candidateJoined={candidateJoined}
                  candidateEmail={candidateEmail}
                  emailEnabled={emailEnabled}
                />
              </div>
            </details>
          ) : null}
          {isCandidate ? (
            <AutosaveTextarea
              id="candidate-notes"
              label="Your notes (the interviewer sees these)"
              initial={session.notes}
              placeholder={NOTES_PLACEHOLDER}
              maxLength={20000}
              save={(text) => record("notes.updated", { text })}
              onReady={(f) => (flushNotes.current = f)}
              className="flex-1"
            />
          ) : (
            <div className="grid gap-1.5">
              <h2 className="label">Candidate&apos;s notes</h2>
              <pre className="min-h-40 whitespace-pre-wrap rounded-lg border border-grid bg-board-raised p-3 font-mono text-[0.85rem]">
                {sharedNotes || <span className="faint">Nothing yet.</span>}
              </pre>
            </div>
          )}
        </aside>

        {/* Centre: the round's workspace */}
        <main className="relative order-1 flex min-h-0 flex-col border-grid lg:order-2" aria-label={round.workspace === "board" ? "Shared whiteboard" : round.workspace === "code" ? "Shared code editor" : "Conversation"}>
          {round.workspace === "board" ? (
            <>
              <Whiteboard
                initialElements={session.board as BoardElement[]}
                editable={running}
                onReady={onBoardReady}
                sendLive={sendLiveBoard}
                persist={(elements) => record("board.updated", { elements })}
                onSaveState={setBoardSave}
              />
              <span className="pointer-events-none absolute bottom-2 right-3 text-[0.75rem] text-ink-faint" aria-live="polite">
                {boardSave === "saving" ? "Saving board…" : boardSave === "error" ? "Board not saved yet, retrying…" : ""}
              </span>
            </>
          ) : round.workspace === "code" ? (
            <>
              <CodeEditor
                initialCode={session.code}
                initialLanguage={session.code_language ?? "python"}
                editable={running && isCandidate}
                onReady={(h) => (codeEditor.current = h)}
                sendLive={sendLiveCode}
                persist={(text, language) => record("code.updated", { text, language })}
                onSaveState={setCodeSave}
              />
              <span className="pointer-events-none absolute bottom-2 right-3 text-[0.75rem] text-ink-faint" aria-live="polite">
                {codeSave === "saving" ? "Saving code…" : codeSave === "error" ? "Code not saved yet, retrying…" : ""}
              </span>
            </>
          ) : (
            <ChatPanel
              feed={feed}
              role={me.role}
              canSend={running}
              staged={staged}
              onSend={async (text, asProbe) => {
                try {
                  await record(asProbe ? "probe.asked" : "chat.message", { text });
                } catch (err) {
                  throw new Error(sessionErrorMessage(err as { code?: string; message?: string }));
                }
              }}
            />
          )}
        </main>

        {/* Right: conversation, and for interviewers the guide and private notes */}
        {centreIsChat && !guide ? null : (
        <aside className="order-3 flex min-h-[24rem] flex-col border-t border-grid lg:min-h-0 lg:border-l lg:border-t-0">
          {guide ? (
            <div role="tablist" aria-label="Interviewer tools" className="flex gap-1 border-b border-grid px-2 pt-2">
              {(centreIsChat ? (["guide", "notes"] as const) : (["chat", "guide", "notes"] as const)).map((t) => (
                <button
                  key={t}
                  role="tab"
                  type="button"
                  aria-selected={sideTab === t}
                  className={`tab ${sideTab === t ? "tab-active" : ""}`}
                  onClick={() => setSideTab(t)}
                >
                  {{ chat: "Conversation", guide: "Guide", notes: "Private notes" }[t]}
                </button>
              ))}
            </div>
          ) : null}
          {centreIsChat ? null : (
            <div className={sideTab === "chat" || !guide ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
              <ChatPanel
              feed={feed}
              role={me.role}
              canSend={running}
              staged={staged}
              onSend={async (text, asProbe) => {
                try {
                  await record(asProbe ? "probe.asked" : "chat.message", { text });
                } catch (err) {
                  throw new Error(sessionErrorMessage(err as { code?: string; message?: string }));
                }
              }}
            />
            </div>
          )}
          {guide ? (
            <>
              <div className={sideTab === "guide" ? "min-h-0 flex-1 overflow-y-auto p-4" : "hidden"}>
                <InterviewerGuide
                  guide={guide}
                  phase={live.phase}
                  roundType={session.round_type}
                  rubric={rubric}
                  onPickProbe={(q) => {
                    setStaged((prev) => ({ id: (prev?.id ?? 0) + 1, text: q }));
                    if (!centreIsChat) setSideTab("chat");
                  }}
                />
              </div>
              <div className={sideTab === "notes" ? "flex min-h-0 flex-1 flex-col p-4" : "hidden"}>
                <AutosaveTextarea
                  id="private-notes"
                  label="Only interviewers can see these"
                  initial={privateNotes}
                  placeholder="Evidence for your scorecard, with times…"
                  maxLength={20000}
                  save={(text) => record("interviewer_note.updated", { text })}
                  onReady={(f) => (flushPrivate.current = f)}
                  className="flex-1"
                />
              </div>
            </>
          ) : null}
        </aside>
        )}
      </div>
    </div>
  );
}
