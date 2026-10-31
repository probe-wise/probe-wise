// Hand-written to match supabase/migrations. Once a Supabase project exists you can
// regenerate with: npx supabase gen types typescript --project-id <id> > src/lib/database.types.ts

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type OrgRole = "admin" | "interviewer";

export type CalendarProvider = "google" | "ics" | "none";

export type OrganizationRow = {
  id: string;
  name: string;
  calendar_provider: CalendarProvider;
  created_at: string;
  updated_at: string;
};

export type OrgMemberRow = {
  org_id: string;
  user_id: string;
  role: OrgRole;
  display_name: string;
  email: string | null;
  joined_at: string;
};

export type OrgInviteRow = {
  id: string;
  org_id: string;
  email: string;
  role: OrgRole;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};

export type CandidateRow = {
  id: string;
  org_id: string;
  full_name: string;
  email: string | null;
  role_title: string | null;
  seniority: string | null;
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CandidateInsert = Pick<CandidateRow, "org_id" | "full_name"> &
  Partial<Pick<CandidateRow, "email" | "role_title" | "seniority" | "notes">>;
export type CandidateUpdate = Partial<Pick<CandidateRow, "full_name" | "email" | "role_title" | "seniority" | "notes">>;

export type RoundTypeValue = "system_design" | "coding" | "behavioural";

export type ProblemRow = {
  id: string;
  org_id: string;
  round_type: RoundTypeValue;
  title: string;
  summary: string;
  prompt: string;
  focus: string;
  levels: string[];
  language: string | null;
  starter_code: string;
  guide: Json;
  version: number;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type ProblemContent = Pick<ProblemRow, "title" | "summary" | "prompt" | "focus" | "levels" | "language" | "starter_code" | "guide">;
export type ProblemInsert = Pick<ProblemRow, "org_id" | "round_type"> & ProblemContent;
export type ProblemUpdate = Partial<ProblemContent & Pick<ProblemRow, "archived_at">>;

export type RubricAspectJson = { key: string; label: string; assesses: string; solid: string[] };

export type RubricRow = {
  id: string;
  org_id: string;
  round_type: RoundTypeValue;
  name: string;
  aspects: RubricAspectJson[];
  is_default: boolean;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type LoopRow = {
  id: string;
  org_id: string;
  candidate_id: string;
  name: string;
  created_by: string | null;
  created_at: string;
};

export type SessionStatus = "lobby" | "in_progress" | "completed" | "cancelled";

export type InterviewSessionRow = {
  id: string;
  org_id: string;
  candidate_id: string;
  created_by: string | null;
  scheduled_at: string | null;
  status: SessionStatus;
  round_type: RoundTypeValue;
  problem_id: string | null;
  /** The rubric snapshot this interview is graded on; null on older sessions (built-in default). */
  rubric: { name: string; aspects: RubricAspectJson[] } | null;
  loop_id: string | null;
  code: string;
  code_language: string | null;
  calendar_event_id: string | null;
  calendar_owner: string | null;
  meeting_url: string | null;
  problem_slug: string;
  problem_version: number;
  problem_title: string;
  problem_snapshot: { summary: string; prompt: string; focus?: string; language?: string; starter_code?: string };
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
  /** null while an interviewer is assigned but hasn't joined yet */
  consented_at: string | null;
  joined_at: string | null;
  created_at: string;
};

export type SessionEventRow = {
  session_id: string;
  seq: number;
  participant_id: string | null;
  actor_role: "candidate" | "interviewer" | "member" | "system";
  type: string;
  visibility: "all" | "interviewers";
  phase: string | null;
  payload: { [key: string]: Json | undefined };
  client_ts: string | null;
  created_at: string;
  prev_hash: string;
  hash: string;
};

export type AspectScores = { [aspect: string]: { score: number | null; evidence?: string } };

export type SessionEvaluationRow = {
  id: string;
  session_id: string;
  participant_id: string;
  scores: AspectScores;
  recommendation: string | null;
  summary: string;
  rubric_version: number;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AiAssessmentRow = {
  session_id: string;
  status: "running" | "completed" | "failed";
  model: string | null;
  scores: AspectScores;
  recommendation: string | null;
  summary: string;
  strengths: string[];
  concerns: string[];
  error: string | null;
  rubric_version: number;
  requested_by: string | null;
  requested_at: string;
  completed_at: string | null;
};

type ReadOnlyTable<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };

type SessionFn<Args> = { Args: Args; Returns: undefined };

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: OrganizationRow;
        Insert: never;
        Update: Partial<Pick<OrganizationRow, "name" | "calendar_provider">>;
        Relationships: [];
      };
      problems: { Row: ProblemRow; Insert: ProblemInsert; Update: ProblemUpdate; Relationships: [] };
      rubrics: {
        Row: RubricRow;
        Insert: Pick<RubricRow, "org_id" | "round_type" | "name" | "aspects">;
        Update: Partial<Pick<RubricRow, "name" | "aspects" | "archived_at">>;
        Relationships: [];
      };
      interview_loops: {
        Row: LoopRow;
        Insert: Pick<LoopRow, "org_id" | "candidate_id" | "name">;
        Update: Partial<Pick<LoopRow, "name">>;
        Relationships: [];
      };
      org_members: ReadOnlyTable<OrgMemberRow>;
      org_invites: ReadOnlyTable<OrgInviteRow>;
      candidates: { Row: CandidateRow; Insert: CandidateInsert; Update: CandidateUpdate; Relationships: [] };
      interview_sessions: ReadOnlyTable<InterviewSessionRow>;
      session_participants: ReadOnlyTable<SessionParticipantRow>;
      session_events: ReadOnlyTable<SessionEventRow>;
      session_evaluations: ReadOnlyTable<SessionEvaluationRow>;
      session_ai_assessments: ReadOnlyTable<AiAssessmentRow>;
      session_interviewer_notes: ReadOnlyTable<{
        session_id: string;
        participant_id: string;
        body: string;
        updated_at: string;
      }>;
    };
    Views: Record<string, never>;
    Functions: {
      create_organization: { Args: { p_name: string; p_display_name: string }; Returns: string };
      update_my_display_name: SessionFn<{ p_display_name: string }>;
      create_org_invite: { Args: { p_email: string; p_role: OrgRole; p_token_hash: string }; Returns: string };
      revoke_org_invite: SessionFn<{ p_invite: string }>;
      org_invite_preview: {
        Args: { p_token_hash: string };
        Returns: {
          org_name: string;
          email: string;
          role: OrgRole;
          invite_state: "valid" | "expired" | "revoked" | "used";
          email_matches: boolean;
          already_member: boolean;
        }[];
      };
      accept_org_invite: { Args: { p_token_hash: string; p_display_name: string }; Returns: string };
      set_org_member_role: SessionFn<{ p_user: string; p_role: OrgRole }>;
      remove_org_member: SessionFn<{ p_user: string }>;
      delete_my_account: SessionFn<Record<string, never>>;
      create_session: {
        Args: {
          p_candidate: string;
          p_round_type: RoundTypeValue;
          p_problem_slug: string;
          p_problem_id: string | null;
          p_problem_version: number;
          p_problem_title: string;
          p_problem_snapshot: Json;
          p_phase_plan: Json;
          p_rubric: Json;
          p_interviewers: string[];
          p_scheduled_at?: string | null;
          p_loop?: string | null;
        };
        Returns: string;
      };
      join_session: SessionFn<{ p_session: string; p_consent: boolean }>;
      create_candidate_link: { Args: { p_session: string; p_token_hash: string; p_ttl_hours?: number }; Returns: string };
      revoke_candidate_links: { Args: { p_session: string }; Returns: number };
      candidate_link_preview: {
        Args: { p_token_hash: string };
        Returns: {
          session_id: string;
          org_name: string;
          candidate_name: string;
          scheduled_at: string | null;
          session_status: SessionStatus;
          link_state: "valid" | "expired" | "revoked" | "used" | "closed";
          my_role: "candidate" | "interviewer" | null;
          is_staff: boolean;
        }[];
      };
      accept_candidate_link: {
        Args: { p_token_hash: string; p_display_name: string; p_consent: boolean };
        Returns: string;
      };
      start_session: SessionFn<{ p_session: string }>;
      change_session_phase: SessionFn<{ p_session: string; p_phase: string }>;
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
      begin_ai_assessment: SessionFn<{ p_session: string; p_requested_by: string }>;
      complete_ai_assessment: SessionFn<{
        p_session: string;
        p_model: string;
        p_scores: Json;
        p_recommendation: string;
        p_summary: string;
        p_strengths: string[];
        p_concerns: string[];
      }>;
      fail_ai_assessment: SessionFn<{ p_session: string; p_error: string }>;
      set_default_rubric: SessionFn<{ p_round_type: RoundTypeValue; p_rubric: string | null }>;
      my_calendar_connection: {
        Args: Record<string, never>;
        Returns: { provider: string; account_email: string | null; connected_at: string }[];
      };
      save_calendar_connection: SessionFn<{ p_user: string; p_email: string | null; p_ciphertext: string }>;
      get_calendar_connection: {
        Args: { p_user: string };
        Returns: { account_email: string | null; refresh_token_ciphertext: string }[];
      };
      delete_calendar_connection: SessionFn<{ p_user: string }>;
      set_session_calendar: SessionFn<{
        p_session: string;
        p_owner: string | null;
        p_event_id: string | null;
        p_meeting_url: string | null;
      }>;
      verify_session_log: {
        Args: { p_session: string };
        Returns: { ok: boolean; event_count: number; first_bad_seq: number | null; head_hash: string }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
