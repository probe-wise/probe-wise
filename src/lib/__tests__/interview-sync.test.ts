import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EVENT_TYPES } from "../interview/events";
import { PHASES, PHASE_VALUES, phasePlanFor, totalMinutes } from "../interview/phases";
import { ASPECT_VALUES, RECOMMENDATIONS, RUBRIC } from "../interview/rubric";
import { GENERIC_PROBES } from "../interview/probes";
import { ORG_ROLES } from "../org";

const dir = join(process.cwd(), "supabase", "migrations");
const sql = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(dir, f), "utf8"))
  .join("\n");

// Later migrations redefine some lists, so read the last definition.
const quotedAfter = (marker: string) => {
  const start = sql.lastIndexOf(marker);
  if (start < 0) throw new Error(`marker not found: ${marker}`);
  const rest = sql.slice(start + marker.length);
  return [...rest.slice(0, rest.search(/\)\)|\]::text\[\]/)).matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]);
};

describe("interview vocabularies match the database", () => {
  it("phases (order matters)", () => {
    expect(quotedAfter("function public.interview_phases()\nreturns text[]\nlanguage sql\nimmutable\nset search_path = ''\nas $$\n  select array[")).toEqual([...PHASE_VALUES]);
  });
  it("event types", () => {
    expect(quotedAfter("session_events_type_check check (type in (").sort()).toEqual([...EVENT_TYPES].sort());
  });
  it("scorecard aspects: every phase, then communication", () => {
    expect(sql).toContain("select public.interview_phases() || array['communication']::text[]");
    expect(ASPECT_VALUES).toEqual([...PHASE_VALUES, "communication"]);
  });
  it("workspace roles", () => {
    expect(quotedAfter("-- keep in sync with ORG_ROLES in src/lib/org.ts\n  role text not null check (role in (").sort()).toEqual(ORG_ROLES.map((r) => r.value).sort());
  });
  it("recommendations", () => {
    expect(quotedAfter("recommendation text check (recommendation in (").sort()).toEqual(
      RECOMMENDATIONS.map((r) => r.value).sort(),
    );
  });
});

describe("phases", () => {
  it("every phase has generic probes and every aspect a rubric entry", () => {
    for (const p of PHASES) expect(GENERIC_PROBES[p.value].length).toBeGreaterThan(0);
    for (const a of ASPECT_VALUES) expect(RUBRIC[a].solid.length).toBeGreaterThan(0);
  });
  it("plans fit the database limits and scale with level", () => {
    for (const level of ["entry", "mid", "senior", "staff", "principal", null]) {
      const plan = phasePlanFor(level);
      for (const p of PHASE_VALUES) expect(plan[p]).toBeGreaterThanOrEqual(1);
      for (const p of PHASE_VALUES) expect(plan[p]).toBeLessThanOrEqual(60);
    }
    expect(totalMinutes(phasePlanFor("mid"))).toBe(45);
    expect(totalMinutes(phasePlanFor("staff"))).toBeGreaterThan(totalMinutes(phasePlanFor("senior")));
  });
  it("plans are copies, not shared objects", () => {
    phasePlanFor("mid").requirements = 99;
    expect(phasePlanFor("mid").requirements).toBe(5);
  });
});
