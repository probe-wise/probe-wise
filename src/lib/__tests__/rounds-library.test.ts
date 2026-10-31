import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAssessmentPrompt, normalizeOutput } from "../interview/ai-assessment";
import { buildIcs } from "../calendar/ics";
import { aspectKey, rubricSchema } from "../interview/rubric";
import { CODE_LANGUAGES, ROUNDS, ROUND_VALUES, roundPlanFor, sessionRubric } from "../interview/rounds";
import { BEHAVIOURAL_PROBLEMS, CODING_PROBLEMS } from "../problems/bank-rounds";
import { BUILT_IN, getProblem, toPromptSnapshot, toSummary } from "../problems/catalog";
import { open, seal, secretKey } from "../secret-box";

const sql = readdirSync(join(process.cwd(), "supabase", "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(process.cwd(), "supabase", "migrations", f), "utf8"))
  .join("\n");

/** The latest definition of an SQL function. */
const fnBody = (name: string) => {
  const start = sql.lastIndexOf(`function public.${name}(`);
  if (start < 0) throw new Error(`function not found: ${name}`);
  return sql.slice(start, sql.indexOf("$$;", start));
};

/** Quoted values in the SQL array after `marker`, within `body` (default: everything, last match). */
const arrayAfter = (marker: string, body = sql) => {
  const start = body.lastIndexOf(marker);
  if (start < 0) throw new Error(`marker not found: ${marker}`);
  const rest = body.slice(start + marker.length);
  return [...rest.slice(0, rest.indexOf("]")).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
};

describe("round vocabularies match the database", () => {
  it("round types", () => {
    expect(arrayAfter("select array[", fnBody("round_types"))).toEqual([...ROUND_VALUES]);
  });
  it("phases per round (order matters)", () => {
    const phases = fnBody("round_phases");
    expect(arrayAfter("when 'coding' then array[", phases)).toEqual(ROUNDS.coding.phases.map((p) => p.value));
    expect(arrayAfter("when 'behavioural' then array[", phases)).toEqual(ROUNDS.behavioural.phases.map((p) => p.value));
  });
  it("built-in rubric aspects", () => {
    const defaults = fnBody("default_aspects");
    expect(arrayAfter("when 'coding' then array[", defaults)).toEqual(ROUNDS.coding.rubric.aspects.map((a) => a.key));
    expect(arrayAfter("when 'behavioural' then array[", defaults)).toEqual(ROUNDS.behavioural.rubric.aspects.map((a) => a.key));
  });
  it("code languages", () => {
    expect(arrayAfter("select array[", fnBody("code_languages"))).toEqual(CODE_LANGUAGES.map((l) => l.value));
  });
});

describe("rounds", () => {
  it("every round has timings for each level covering every phase, within the database limits", () => {
    for (const r of ROUND_VALUES) {
      for (const level of ["entry", "mid", "senior", "staff", "principal", null]) {
        const plan = roundPlanFor(r, level);
        expect(Object.keys(plan).sort()).toEqual(ROUNDS[r].phases.map((p) => p.value).sort());
        for (const m of Object.values(plan)) expect(m).toBeGreaterThanOrEqual(1);
        for (const m of Object.values(plan)) expect(m).toBeLessThanOrEqual(60);
      }
    }
  });
  it("every built-in rubric is valid and every phase has general follow-ups", () => {
    for (const r of ROUND_VALUES) {
      expect(rubricSchema.safeParse(ROUNDS[r].rubric).success, r).toBe(true);
      for (const p of ROUNDS[r].phases) expect(ROUNDS[r].probes[p.value]?.length, `${r}/${p.value}`).toBeGreaterThan(0);
    }
  });
  it("phase values are unique across rounds (labels are looked up globally)", () => {
    const all = ROUND_VALUES.flatMap((r) => ROUNDS[r].phases.map((p) => p.value));
    expect(new Set(all).size).toBe(all.length);
  });
  it("sessions use their rubric snapshot, falling back to the built-in one", () => {
    const custom = { name: "Ours", aspects: [{ key: "x", label: "X", assesses: "", solid: [] }] };
    expect(sessionRubric({ rubric: custom, round_type: "coding" })).toBe(custom);
    expect(sessionRubric({ rubric: null, round_type: "behavioural" })).toBe(ROUNDS.behavioural.rubric);
  });
});

describe("custom rubrics", () => {
  it("rejects duplicates, empty names and too many aspects", () => {
    const aspect = (key: string) => ({ key, label: key, assesses: "", solid: [] });
    expect(rubricSchema.safeParse({ name: "R", aspects: [aspect("a"), aspect("a")] }).success).toBe(false);
    expect(rubricSchema.safeParse({ name: " ", aspects: [aspect("a")] }).success).toBe(false);
    expect(rubricSchema.safeParse({ name: "R", aspects: Array.from({ length: 13 }, (_, i) => aspect(`a${i}`)) }).success).toBe(false);
  });
  it("derives stable keys from aspect names", () => {
    expect(aspectKey("Code quality & tests")).toBe("code_quality_tests");
    expect(aspectKey("2nd opinion")).toBe("a_2nd_opinion");
    expect(aspectKey("Énergie")).toBe("energie");
  });
});

describe("built-in coding and behavioural banks", () => {
  it("have unique slugs across the whole bank and complete guides", () => {
    const slugs = BUILT_IN.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const p of [...CODING_PROBLEMS, ...BEHAVIOURAL_PROBLEMS]) {
      expect(p.guide.probes.length, p.slug).toBeGreaterThanOrEqual(3);
      expect(p.guide.strongSignals.length, p.slug).toBeGreaterThanOrEqual(1);
      expect(p.guide.reference.length, p.slug).toBeGreaterThanOrEqual(1);
    }
    for (const p of CODING_PROBLEMS) expect(p.starterCode?.length, p.slug).toBeGreaterThan(0);
  });
  it("coding snapshots carry the language and starter code, never the guide", () => {
    const p = getProblem("coding-lru-cache")!;
    const snap = toPromptSnapshot(p);
    expect(snap).toMatchObject({ language: "python" });
    expect(snap.starter_code).toContain("class LRUCache");
    expect(JSON.stringify(snap)).not.toContain(p.guide.reference[0]);
    expect(toSummary(p)).toMatchObject({ roundType: "coding", custom: false });
    expect(JSON.stringify(toSummary(p))).not.toContain("class LRUCache");
  });
});

describe("AI assessment for other rounds", () => {
  const base = {
    problem_title: "LRU cache",
    problem_snapshot: { summary: "", prompt: "Implement an LRU cache." },
    notes: "",
    board: [],
    ended_at: null,
    end_reason: "completed" as const,
  };
  it("coding: grades on the session's rubric and includes the final code", () => {
    const prompt = buildAssessmentPrompt({
      session: {
        ...base,
        round_type: "coding",
        phase_plan: roundPlanFor("coding", "mid"),
        code: "class LRUCache: ...",
        code_language: "python",
        rubric: { name: "Our coding rubric", aspects: [{ key: "speed", label: "Speed", assesses: "How fast", solid: [] }] },
      },
      candidate: { role_title: null, seniority: "mid" },
      events: [],
      problem: getProblem("coding-lru-cache"),
    });
    expect(prompt).toContain("<round>Coding interview</round>");
    expect(prompt).toContain('<rubric name="Our coding rubric">');
    expect(prompt).toContain("speed (Speed): How fast.");
    expect(prompt).toContain('<final_code language="Python">\nclass LRUCache: ...');
    expect(prompt).not.toContain("<final_board>");
    expect(prompt).toContain("Reference approach:");
  });
  it("drops aspects that aren't in the rubric", () => {
    const rubric = { name: "R", aspects: [{ key: "speed", label: "Speed", assesses: "", solid: [] }] };
    const out = normalizeOutput(
      {
        aspects: [
          { aspect: "speed", score: 3, evidence: "ok" },
          { aspect: "made_up", score: 1, evidence: "x" },
        ],
        recommendation: "yes",
        summary: "s",
        strengths: [],
        concerns: [],
      },
      rubric,
    );
    expect(Object.keys(out.scores)).toEqual(["speed"]);
  });
});

describe("calendar invites (.ics)", () => {
  const event = {
    uid: "abc@probewise",
    sequence: 0,
    method: "REQUEST" as const,
    start: new Date("2026-11-05T15:30:00Z"),
    minutes: 45,
    summary: "Coding interview: Ada, Inc.",
    description: "Line one\nLine two; with, punctuation",
    organizer: { name: 'Ivy "the" Interviewer', email: "ivy@acme.com" },
    attendees: [{ name: "Ada", email: "ada@example.com" }, { email: "bob@acme.com" }],
    now: new Date("2026-11-01T00:00:00Z"),
  };
  it("is valid iCalendar: CRLF lines, UTC times, escaped text, every attendee", () => {
    const ics = buildIcs(event);
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("DTSTART:20261105T153000Z");
    expect(unfolded).toContain("DTEND:20261105T161500Z");
    expect(unfolded).toContain("SUMMARY:Coding interview: Ada\\, Inc.");
    expect(unfolded).toContain("DESCRIPTION:Line one\\nLine two\; with\\, punctuation");
    expect(unfolded).toContain(`ORGANIZER;CN="Ivy 'the' Interviewer":mailto:ivy@acme.com`);
    expect(unfolded).toContain("mailto:ada@example.com");
    expect(unfolded).toContain("mailto:bob@acme.com");
    expect(unfolded).toContain("METHOD:REQUEST");
  });
  it("cancellations reuse the UID with a higher sequence", () => {
    const ics = buildIcs({ ...event, method: "CANCEL", sequence: 1 });
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("SEQUENCE:1");
    expect(ics).toContain("UID:abc@probewise");
  });
});

describe("secret box", () => {
  const key = Buffer.alloc(32, 7);
  it("round-trips and detects tampering", () => {
    const sealed = seal("1//refresh-token", key);
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("refresh");
    expect(open(sealed, key)).toBe("1//refresh-token");
    const [v, iv, tag, data] = sealed.split(".");
    const flipped = `${v}.${iv}.${tag}.${data.slice(0, -2)}${data.endsWith("A") ? "B" : "A"}${data.slice(-1)}`;
    expect(() => open(flipped, key)).toThrow();
    expect(() => open(sealed, Buffer.alloc(32, 8))).toThrow();
  });
  it("only accepts a 32-byte base64 key", () => {
    expect(secretKey(Buffer.alloc(32, 1).toString("base64"))).not.toBeNull();
    expect(secretKey("too-short")).toBeNull();
    expect(secretKey(undefined)).toBeNull();
  });
});
