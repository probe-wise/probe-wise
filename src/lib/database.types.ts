// Hand-written to match supabase/migrations. Once a Supabase project exists you can
// regenerate with: npx supabase gen types typescript --project-id <id> > src/lib/database.types.ts

export type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  target_role: string | null;
  seniority: string | null;
  domains: string[];
  target_companies: string[];
  years_experience: number | null;
  weak_areas: string[];
  interview_date: string | null;
  onboarding_completed_at: string | null;
  seat_claimed_at: string;
  created_at: string;
  updated_at: string;
};

export type ProfileUpdate = Partial<
  Pick<
    ProfileRow,
    | "full_name"
    | "target_role"
    | "seniority"
    | "domains"
    | "target_companies"
    | "years_experience"
    | "weak_areas"
    | "interview_date"
    | "onboarding_completed_at"
  >
>;

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type SessionMode = "solo" | "peer";
export type SessionStatus = "lobby" | "in_progress" | "completed" | "cancelled";

export type InterviewSessionRow = {
  id: string;
  candidate_id: string;
  mode: SessionMode;
  status: SessionStatus;
  problem_slug: string;
  problem_version: number;
  problem_title: string;
  problem_snapshot: { summary: string; prompt: string; focus?: string };
  phase_plan: Record<string, number>;
  phase: string | null;
  phase_started_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  end_reason: "completed" | "ended_early" | "cancelled" | null;
  board: Json[];
  notes: string;
  last_seq: number;
  last_hash: string;
  created_at: string;
  updated_at: string;
};

export type SessionParticipantRow = {
  id: string;
  session_id: string;
  user_id: string | null;
  role: "candidate" | "interviewer";
  display_name: string;
  consented_at: string;
  joined_at: string;
};

export type SessionEventRow = {
  session_id: string;
  seq: number;
  participant_id: string | null;
  actor_role: "candidate" | "interviewer" | "system";
  type: string;
  visibility: "all" | "interviewers";
  phase: string | null;
  payload: { [key: string]: Json | undefined };
  client_ts: string | null;
  created_at: string;
  prev_hash: string;
  hash: string;
};

export type SessionEvaluationRow = {
  id: string;
  session_id: string;
  participant_id: string;
  kind: "scorecard" | "self";
  scores: { [phase: string]: { score: number | null; evidence?: string } };
  recommendation: string | null;
  summary: string;
  rubric_version: number;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
};

type ReadOnlyTable<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: never;
        Update: ProfileUpdate;
        Relationships: [];
      };
      waitlist: {
        Row: { user_id: string; email: string | null; joined_at: string };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      interview_sessions: ReadOnlyTable<InterviewSessionRow>;
      session_participants: ReadOnlyTable<SessionParticipantRow>;
      session_events: ReadOnlyTable<SessionEventRow>;
      session_evaluations: ReadOnlyTable<SessionEvaluationRow>;
      session_interviewer_notes: ReadOnlyTable<{
        session_id: string;
        participant_id: string;
        body: string;
        updated_at: string;
      }>;
    };
    Views: Record<string, never>;
    Functions: {
      claim_seat: { Args: Record<string, never>; Returns: "member" | "waitlisted" };
      seats_remaining: { Args: Record<string, never>; Returns: number };
      waitlist_status: {
        Args: Record<string, never>;
        Returns: { queue_position: number; total_waiting: number; joined_at: string }[];
      };
      delete_my_account: { Args: Record<string, never>; Returns: undefined };
      create_session: {
        Args: {
          p_mode: SessionMode;
          p_problem_slug: string;
          p_problem_version: number;
          p_problem_title: string;
          p_problem_snapshot: Json;
          p_phase_plan: Json;
          p_display_name: string;
          p_consent: boolean;
        };
        Returns: string;
      };
      create_session_invite: { Args: { p_session: string; p_token_hash: string; p_ttl_hours?: number }; Returns: string };
      revoke_session_invites: { Args: { p_session: string }; Returns: number };
      session_invite_preview: {
        Args: { p_token_hash: string };
        Returns: {
          session_id: string;
          problem_title: string;
          candidate_name: string;
          mode: SessionMode;
          session_status: SessionStatus;
          expires_at: string;
          invite_state: "valid" | "expired" | "revoked" | "used" | "closed";
          my_role: "candidate" | "interviewer" | null;
        }[];
      };
      accept_session_invite: {
        Args: { p_token_hash: string; p_display_name: string; p_consent: boolean };
        Returns: string;
      };
      start_session: { Args: { p_session: string }; Returns: undefined };
      change_session_phase: { Args: { p_session: string; p_phase: string }; Returns: undefined };
      end_session: { Args: { p_session: string }; Returns: string };
      record_event: {
        Args: { p_session: string; p_type: string; p_payload: Json; p_client_ts?: string };
        Returns: number | null;
      };
      save_evaluation: {
        Args: {
          p_session: string;
          p_scores: Json;
          p_recommendation: string | null;
          p_summary: string;
          p_submit: boolean;
        };
        Returns: string | null;
      };
      verify_session_log: {
        Args: { p_session: string };
        Returns: { ok: boolean; event_count: number; first_bad_seq: number | null; head_hash: string }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
