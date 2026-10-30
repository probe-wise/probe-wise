import { describe, expect, it } from "vitest";
import { PROBLEMS, getProblem } from "../problems/bank";
import { queuedProblems, rankProblems, toPromptSnapshot, toSummary } from "../problems/catalog";
import { DOMAINS, SENIORITY_LEVELS, TARGET_ROLES, values } from "../profile-options";

describe("problem bank", () => {
  it("has about 30 problems with unique, URL-safe slugs", () => {
    expect(PROBLEMS.length).toBeGreaterThanOrEqual(30);
    const slugs = PROBLEMS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("covers every domain with at least two problems", () => {
    for (const d of values(DOMAINS)) expect(PROBLEMS.filter((p) => p.domain === d).length, d).toBeGreaterThanOrEqual(2);
  });

  it("uses only known levels and roles", () => {
    const levels = new Set<string>(values(SENIORITY_LEVELS));
    const roles = new Set<string>(values(TARGET_ROLES));
    for (const p of PROBLEMS) {
      expect(p.levels.length, p.slug).toBeGreaterThan(0);
      for (const l of p.levels) expect(levels.has(l), `${p.slug}: ${l}`).toBe(true);
      for (const r of p.roles) expect(roles.has(r), `${p.slug}: ${r}`).toBe(true);
    }
  });

  it("every problem has a complete interviewer guide", () => {
    for (const p of PROBLEMS) {
      const g = p.guide;
      expect(p.version, p.slug).toBeGreaterThanOrEqual(1);
      expect(p.title.length, p.slug).toBeLessThanOrEqual(200);
      expect(g.clarifications.length, p.slug).toBeGreaterThanOrEqual(2);
      expect(g.scale.length, p.slug).toBeGreaterThanOrEqual(1);
      expect(g.probes.length, p.slug).toBeGreaterThanOrEqual(3);
      expect(g.strongSignals.length, p.slug).toBeGreaterThanOrEqual(1);
      expect(g.pitfalls.length, p.slug).toBeGreaterThanOrEqual(1);
      expect(g.reference.length, p.slug).toBeGreaterThanOrEqual(2);
    }
  });

  it("snapshots fit the database limit and never include the guide", () => {
    for (const p of PROBLEMS) {
      const snap = JSON.stringify(toPromptSnapshot(p));
      expect(snap.length).toBeLessThan(32768);
      expect(snap).not.toContain(p.guide.reference[0]);
      expect(JSON.stringify(toSummary(p))).not.toContain(p.guide.probes[0]);
    }
  });

  it("looks problems up by slug", () => {
    expect(getProblem("payment-ledger")?.domain).toBe("fintech");
    expect(getProblem("nope")).toBeNull();
  });
});

describe("ranking", () => {
  const profile = { domains: ["gaming", "fintech"], seniority: "senior", target_role: "ml_engineer" };

  it("puts the member's domains first", () => {
    const top = rankProblems(profile).slice(0, 4);
    expect(top.every((p) => p.domain === "gaming" || p.domain === "fintech")).toBe(true);
  });

  it("queues each chosen domain before repeating one", () => {
    expect(queuedProblems(profile).map((p) => p.domain)).toEqual(["gaming", "fintech", "gaming", "fintech"]);
  });

  it("fills up from the rest of the bank and ignores unknown domains", () => {
    const picks = queuedProblems({ domains: ["nope"], seniority: "entry", target_role: null }, 3);
    expect(picks).toHaveLength(3);
  });
});
