import "server-only";
import { cache } from "react";
import type {
  AiAssessmentRow,
  CandidateRow,
  InterviewSessionRow,
  SessionEvaluationRow,
  SessionEventRow,
  SessionParticipantRow,
} from "@/lib/database.types";
import { getMembership, getViewer } from "@/lib/dal";
import type { SessionEvent } from "@/lib/interview/events";
import { createClient } from "@/lib/supabase/server";

// Session reads for the signed-in user. Every query runs as that user, so RLS decides
// what comes back: other workspaces get null, a candidate never gets private events,
// candidate records or scorecards.

export type SessionView = {
  session: InterviewSessionRow;
  /** Joined participants and, for the hiring team, assigned interviewers who haven't joined yet. */
  participants: SessionParticipantRow[];
  /** The viewer's row once they've joined; null for a teammate looking in from the workspace. */
  me: SessionParticipantRow | null;
  /** The viewer belongs to the workspace that owns the interview. */
  isStaff: boolean;
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

  const mine = participants.find((p) => p.user_id === viewer.id && p.joined_at);
  const membership = await getMembership();
  const isStaff = membership?.org.id === session.org_id;
  if (!mine && !isStaff) return null;
  return { session, participants, me: mine ?? null, isStaff };
});

/** The candidate record behind a session (hiring team only; RLS hides it from candidates). */
export async function getSessionCandidate(candidateId: string): Promise<CandidateRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("candidates").select("*").eq("id", candidateId).maybeSingle();
  return data;
}

/** The AI assessment, if one exists and the viewer may see it yet (ADR 0009). */
export async function getAiAssessment(sessionId: string): Promise<AiAssessmentRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("session_ai_assessments").select("*").eq("session_id", sessionId).maybeSingle();
  return data;
}

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

/** Scorecards this viewer may read (ADR 0006 release rules are enforced by RLS). */
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
  | "id"
  | "status"
  | "round_type"
  | "loop_id"
  | "problem_title"
  | "problem_slug"
  | "scheduled_at"
  | "created_at"
  | "started_at"
  | "ended_at"
  | "end_reason"
> & {
  candidate: Pick<CandidateRow, "id" | "full_name" | "role_title"> | null;
  interviewers: { user_id: string | null; display_name: string; joined: boolean }[];
};

type ListFilter = {
  candidateId?: string;
  loopId?: string;
  status?: InterviewSessionRow["status"][];
  mineOnly?: boolean;
  limit?: number;
};

/** Interviews in the viewer's workspace, newest first. */
export async function listWorkspaceSessions({ candidateId, loopId, status, mineOnly, limit = 50 }: ListFilter = {}): Promise<
  SessionListItem[]
> {
  const membership = await getMembership();
  if (!membership) return [];
  const supabase = await createClient();
  // Name the FK: session_interviewer_notes and session_evaluations give PostgREST more paths (PGRST201).
  let query = supabase
    .from("interview_sessions")
    .select(
      `id, status, round_type, loop_id, problem_title, problem_slug, scheduled_at, created_at, started_at, ended_at, end_reason,
       candidate:candidates!interview_sessions_candidate_id_fkey(id, full_name, role_title),
       participants:session_participants!session_participants_session_id_fkey(user_id, role, display_name, joined_at)`,
    )
    .eq("org_id", membership.org.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (candidateId) query = query.eq("candidate_id", candidateId);
  if (loopId) query = query.eq("loop_id", loopId);
  if (status?.length) query = query.in("status", status);
  if (mineOnly) {
    const { data: mine } = await supabase
      .from("session_participants")
      .select("session_id")
      .eq("user_id", membership.member.user_id)
      .eq("role", "interviewer");
    query = query.in("id", (mine ?? []).map((p) => p.session_id));
  }
  const { data, error } = await query;
  if (error) {
    console.error("listWorkspaceSessions failed", error);
    return [];
  }
  type Joined = Omit<SessionListItem, "interviewers"> & {
    participants: Pick<SessionParticipantRow, "user_id" | "role" | "display_name" | "joined_at">[];
  };
  return ((data ?? []) as unknown as Joined[]).map(({ participants, ...s }) => ({
    ...s,
    interviewers: participants
      .filter((p) => p.role === "interviewer")
      .map((p) => ({ user_id: p.user_id, display_name: p.display_name, joined: Boolean(p.joined_at) })),
  }));
}

export type { SessionEventRow };
