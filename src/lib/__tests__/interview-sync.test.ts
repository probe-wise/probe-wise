import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EVENT_TYPES } from "../interview/events";
import { PHASES, PHASE_VALUES, phasePlanFor, totalMinutes } from "../interview/phases";
import { RECOMMENDATIONS, RUBRIC } from "../interview/rubric";
import { GENERIC_PROBES } from "../interview/probes";

const dir = join(process.cwd(), "supabase", "migrations");
const sql = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(dir, f), "utf8"))
  .join("\n");

const quotedAfter = (marker: string) => {
  const start = sql.indexOf(marker);
  if (start < 0) throw new Error(`marker not found: ${marker}`);
  const rest = sql.slice(start + marker.length);
  return [...rest.slice(0, rest.search(/\)\)|\]::text\[\]/)).matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]);
};

describe("interview vocabularies match the database", () => {
  it("phases (order matters)", () => {
    expect(quotedAfter("select array[")).toEqual([...PHASE_VALUES]);
  });
  it("event types", () => {
    expect(quotedAfter("type text not null check (type in (").sort()).toEqual([...EVENT_TYPES].sort());
  });
  it("recommendations", () => {
    expect(quotedAfter("recommendation text check (recommendation in (").sort()).toEqual(
      RECOMMENDATIONS.map((r) => r.value).sort(),
    );
  });
});

describe("phases", () => {
  it("every phase has a rubric entry and generic probes", () => {
    for (const p of PHASES) {
      expect(RUBRIC[p.value].solid.length).toBeGreaterThan(0);
      expect(GENERIC_PROBES[p.value].length).toBeGreaterThan(0);
    }
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
