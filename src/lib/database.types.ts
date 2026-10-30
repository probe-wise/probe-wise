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
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
