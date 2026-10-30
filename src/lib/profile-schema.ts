import { z } from "zod";
import { DOMAINS, LIMITS, SENIORITY_LEVELS, TARGET_ROLES, WEAK_AREAS, values } from "@/lib/profile-options";

export type ProfileFieldName =
  | "full_name"
  | "years_experience"
  | "target_role"
  | "seniority"
  | "domains"
  | "target_companies"
  | "weak_areas"
  | "interview_date";

export type ProfileInput = {
  full_name: string;
  years_experience: number;
  target_role: string;
  seniority: string;
  domains: string[];
  target_companies: string[];
  weak_areas: string[];
  interview_date: string | null;
};

export type ParseResult =
  | { success: true; data: ProfileInput }
  | { success: false; fieldErrors: Partial<Record<ProfileFieldName, string>> };

/** Trim, normalise unicode, drop control characters and collapse whitespace. */
export function cleanText(raw: unknown): string {
  return String(raw ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f​-‍﻿]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Stripe, google ,  Stripe\nOpenAI" → ["Stripe", "google", "OpenAI"] (case-insensitive de-dupe). */
export function parseCompanies(raw: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw ?? "").split(/[,\n;]/)) {
    const name = cleanText(part);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

const unique = (items: string[]) => [...new Set(items.map((i) => cleanText(i)).filter(Boolean))];

/** YYYY-MM-DD in UTC. */
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

function isRealDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && isoDate(d) === value;
}

export function shiftDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

const schema = z.object({
  full_name: z
    .string()
    .min(1, "Tell us what to call you.")
    .max(LIMITS.fullNameMax, `Keep it under ${LIMITS.fullNameMax} characters.`),
  years_experience: z
    .string()
    .min(1, "Enter your years of experience.")
    .regex(/^\d{1,2}$/, "Use a whole number, like 4.")
    .transform(Number)
    .pipe(
      z
        .number()
        .int()
        .min(0)
        .max(LIMITS.maxYearsExperience, `That's more than ${LIMITS.maxYearsExperience} years.`),
    ),
  target_role: z.enum(values(TARGET_ROLES), { error: "Pick the role you're interviewing for." }),
  seniority: z.enum(values(SENIORITY_LEVELS), { error: "Pick the level you're targeting." }),
  domains: z
    .array(z.enum(values(DOMAINS), { error: "Unknown domain." }))
    .min(1, "Pick at least one domain.")
    .max(LIMITS.maxDomains, `Pick up to ${LIMITS.maxDomains} domains.`),
  target_companies: z
    .array(z.string().max(LIMITS.companyNameMax, `Company names must be under ${LIMITS.companyNameMax} characters.`))
    .max(LIMITS.maxCompanies, `List up to ${LIMITS.maxCompanies} companies.`),
  weak_areas: z.array(z.enum(values(WEAK_AREAS), { error: "Unknown focus area." })),
  interview_date: z.string().nullable(),
});

/**
 * Validate the onboarding / profile form.
 * @param today          server's current date (YYYY-MM-DD, UTC) — injectable for tests
 * @param existingDate   the stored interview date, which may be in the past and is
 *                       allowed to be re-saved unchanged
 */
export function parseProfileForm(
  formData: FormData,
  { today = isoDate(new Date()), existingDate = null as string | null } = {},
): ParseResult {
  const rawDate = cleanText(formData.get("interview_date"));
  const input = {
    full_name: cleanText(formData.get("full_name")),
    years_experience: cleanText(formData.get("years_experience")),
    target_role: cleanText(formData.get("target_role")) || undefined,
    seniority: cleanText(formData.get("seniority")) || undefined,
    domains: unique(formData.getAll("domains").map(String)),
    target_companies: parseCompanies(formData.get("target_companies")),
    weak_areas: unique(formData.getAll("weak_areas").map(String)),
    interview_date: rawDate || null,
  };

  const result = schema.safeParse(input);
  const fieldErrors: Partial<Record<ProfileFieldName, string>> = {};
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path[0] as ProfileFieldName;
      fieldErrors[field] ??= issue.message;
    }
  }

  // Dates: allow one day of slack for time zones ahead of/behind UTC.
  if (input.interview_date && input.interview_date !== existingDate) {
    if (!isRealDate(input.interview_date)) {
      fieldErrors.interview_date = "Enter a valid date.";
    } else if (input.interview_date < shiftDays(today, -1)) {
      fieldErrors.interview_date = "Pick a date that hasn't passed yet.";
    } else if (input.interview_date > shiftDays(today, LIMITS.interviewDateMaxDaysAhead)) {
      fieldErrors.interview_date = "Pick a date within the next year.";
    }
  }

  if (!result.success || Object.keys(fieldErrors).length > 0) return { success: false, fieldErrors };
  return { success: true, data: result.data };
}
