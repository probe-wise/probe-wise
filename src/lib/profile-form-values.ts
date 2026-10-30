import type { ProfileFormValues } from "@/components/profile-form";
import type { ProfileRow } from "@/lib/database.types";

/** Stored profile → form values (strings everywhere, as inputs expect). */
export function toFormValues(profile: ProfileRow): ProfileFormValues {
  return {
    full_name: profile.full_name ?? "",
    years_experience: profile.years_experience === null ? "" : String(profile.years_experience),
    target_role: profile.target_role ?? "",
    seniority: profile.seniority ?? "",
    domains: profile.domains ?? [],
    target_companies: (profile.target_companies ?? []).join(", "),
    weak_areas: profile.weak_areas ?? [],
    interview_date: profile.interview_date ?? "",
  };
}

/** Whole days from `today` to `date` (both YYYY-MM-DD). Negative if the date has passed. */
export function daysUntil(date: string, today: string) {
  const ms = Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** "A", "A and B", "A, B and C" */
export function joinList(items: string[]) {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
