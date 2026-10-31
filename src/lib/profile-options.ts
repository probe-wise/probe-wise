// Shared vocabularies: levels, roles and domains used by the problem bank and candidate
// records. The SQL migration repeats SENIORITY_LEVELS in a CHECK constraint;
// `src/lib/__tests__/profile-options-sync.test.ts` fails if they drift apart.

export const TARGET_ROLES = [
  { value: "backend_engineer", label: "Backend Engineer" },
  { value: "fullstack_engineer", label: "Full-stack Engineer" },
  { value: "frontend_engineer", label: "Frontend Engineer" },
  { value: "mobile_engineer", label: "Mobile Engineer" },
  { value: "ml_engineer", label: "ML / AI Engineer" },
  { value: "data_engineer", label: "Data Engineer" },
  { value: "platform_sre", label: "Platform / SRE" },
  { value: "engineering_manager", label: "Engineering Manager" },
] as const;

export const SENIORITY_LEVELS = [
  { value: "entry", label: "Entry", hint: "0–2 years · guided problems" },
  { value: "mid", label: "Mid-level", hint: "2–5 years · solid fundamentals" },
  { value: "senior", label: "Senior", hint: "5–8 years · drives trade-offs" },
  { value: "staff", label: "Staff", hint: "8+ years · cross-system scope" },
  { value: "principal", label: "Principal", hint: "Org-wide architecture" },
] as const;

export const DOMAINS = [
  { value: "fintech", label: "Fintech & payments", hint: "Ledgers, idempotency, exactly-once" },
  { value: "ecommerce", label: "E-commerce", hint: "Catalog, inventory, checkout" },
  { value: "social", label: "Social & feeds", hint: "Fan-out, ranking, notifications" },
  { value: "media_streaming", label: "Media & streaming", hint: "CDNs, encoding, live video" },
  { value: "mobility_logistics", label: "Mobility & logistics", hint: "Geo-indexing, dispatch, ETAs" },
  { value: "healthcare", label: "Healthcare", hint: "Compliance, audit trails, PHI" },
  { value: "ai_ml", label: "AI / ML systems", hint: "RAG, model serving, feature stores" },
  { value: "adtech", label: "Ad tech", hint: "Real-time bidding, attribution" },
  { value: "b2b_saas", label: "B2B SaaS", hint: "Multi-tenancy, permissions, billing" },
  { value: "gaming", label: "Gaming", hint: "Matchmaking, leaderboards, state sync" },
  { value: "devtools_infra", label: "Dev tools & infra", hint: "CI, storage, observability" },
  { value: "travel_hospitality", label: "Travel & booking", hint: "Reservations, search, pricing" },
] as const;

type Values<T extends readonly { value: string }[]> = T[number]["value"];
export type TargetRole = Values<typeof TARGET_ROLES>;
export type Seniority = Values<typeof SENIORITY_LEVELS>;
export type Domain = Values<typeof DOMAINS>;

export const values = <T extends readonly { value: string }[]>(list: T) =>
  list.map((o) => o.value) as [Values<T>, ...Values<T>[]];

export const labelFor = (list: readonly { value: string; label: string }[], value: string | null | undefined) =>
  list.find((o) => o.value === value)?.label ?? value ?? "";
