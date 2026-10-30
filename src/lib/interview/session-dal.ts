import "server-only";
import { cache } from "react";
import type {
  InterviewSessionRow,
  SessionEvaluationRow,
  SessionEventRow,
  SessionParticipantRow,
} from "@/lib/database.types";
import { getViewer } from "@/lib/dal";
import type { SessionEvent } from "@/lib/interview/events";
import { createClient } from "@/lib/supabase/server";

// Session reads for the signed-in user. Every query runs as that user, so RLS decides
// what comes back: a non-participant gets null, a candidate never gets private events.

export type SessionView = {
  session: InterviewSessionRow;
  participants: SessionParticipantRow[];
  me: SessionParticipantRow;
  isController: boolean;
};

export const getSessionView = cache(async (sessionId: string): Promise<SessionView | null> => {
  if (!/^[0-9a-f-]{36}$/.test(sessionId)) return null;
  const viewer = await getViewer();
  if (!viewer) return null;
  const supabase = await createClient();

  const [{ data: session, error }, { data: participants }] = await Promise.all([
    supabase.from("interview_sessions").select("*").eq("id", sessionId).maybeSingle(),
    supabase.from("session_participants").select("*").eq("session_id", sessionId).order("joined_at"),
  ]);
  if (error) throw new Error("We couldn't load this session. Please refresh.");
  if (!session || !participants) return null;

  const me = participants.find((p) => p.user_id === viewer.id);
  if (!me) return null;
  const controllerRole = session.mode === "solo" ? "candidate" : "interviewer";
  return { session, participants, me, isController: me.role === controllerRole };
});

/** Every event this viewer may see, in order. Board deltas are the bulk; callers can skip them. */
export async function getSessionEvents(sessionId: string, { includeBoard = true } = {}): Promise<SessionEvent[]> {
  const supabase = await createClient();
  const out: SessionEvent[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from("session_events")
      .select("seq, type, participant_id, actor_role, visibility, phase, payload, created_at")
      .eq("session_id", sessionId)
      .order("seq")
      .range(from, from + pageSize - 1);
    if (!includeBoard) query = query.neq("type", "board.updated");
    const { data, error } = await query;
    if (error) throw new Error("We couldn't load the session record. Please refresh.");
    out.push(...(data as unknown as SessionEvent[]));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

/** Board events without their (large) payloads: enough for metrics and the timeline. */
export async function getBoardEventMeta(sessionId: string): Promise<SessionEvent[]> {
  const supabase = await createClient();
  const out: SessionEvent[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("session_events")
      .select("seq, type, participant_id, actor_role, visibility, phase, created_at")
      .eq("session_id", sessionId)
      .eq("type", "board.updated")
      .order("seq")
      .range(from, from + pageSize - 1);
    if (error) throw new Error("We couldn't load the session record. Please refresh.");
    out.push(...(data ?? []).map((e) => ({ ...e, payload: {} }) as unknown as SessionEvent));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

export async function getMyInterviewerNotes(sessionId: string, participantId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("session_interviewer_notes")
    .select("body")
    .eq("session_id", sessionId)
    .eq("participant_id", participantId)
    .maybeSingle();
  return data?.body ?? "";
}

/** Evaluations this viewer may read (ADR 0006 release rules are enforced by RLS). */
export async function getEvaluations(sessionId: string): Promise<SessionEvaluationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("session_evaluations").select("*").eq("session_id", sessionId);
  if (error) throw new Error("We couldn't load the evaluations. Please refresh.");
  return data ?? [];
}

export async function verifySessionLog(sessionId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("verify_session_log", { p_session: sessionId });
  if (error || !data?.[0]) return null;
  return data[0];
}

export type SessionListItem = Pick<
  InterviewSessionRow,
  "id" | "mode" | "status" | "problem_title" | "problem_slug" | "created_at" | "started_at" | "ended_at" | "end_reason"
> & { my_role: SessionParticipantRow["role"] };

/** Sessions the viewer takes part in, newest first. */
export async function listMySessions(limit = 50): Promise<SessionListItem[]> {
  const viewer = await getViewer();
  if (!viewer) return [];
  const supabase = await createClient();
  // Name the FK: session_interviewer_notes gives PostgREST a second path between these tables (PGRST201).
  const { data, error } = await supabase
    .from("session_participants")
    .select(
      "role, interview_sessions!session_participants_session_id_fkey!inner(id, mode, status, problem_title, problem_slug, created_at, started_at, ended_at, end_reason)",
    )
    .eq("user_id", viewer.id)
    .order("joined_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("listMySessions failed", error);
    return [];
  }
  type Joined = { role: SessionParticipantRow["role"]; interview_sessions: Omit<SessionListItem, "my_role"> };
  return ((data ?? []) as unknown as Joined[]).map((r) => ({ ...r.interview_sessions, my_role: r.role }));
}

export type { SessionEventRow };
