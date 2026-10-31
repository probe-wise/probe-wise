import { describe, expect, it } from "vitest";
import { buildAssessmentPrompt, normalizeOutput, type AssessmentInput } from "../interview/ai-assessment";
import { describeBoard, type BoardElement } from "../interview/board";
import type { SessionEvent } from "../interview/events";
import { phasePlanFor } from "../interview/phases";
import { getProblem } from "../problems/bank";

const el = (id: string, type: string, extra: Record<string, unknown> = {}): BoardElement => ({
  id,
  type,
  version: 1,
  versionNonce: 1,
  ...extra,
});

describe("describeBoard", () => {
  it("reads labelled shapes, the arrows between them and loose text", () => {
    const board = [
      el("api", "rectangle"),
      el("api-label", "text", { containerId: "api", text: "API\ngateway" }),
      el("db", "ellipse"),
      el("db-label", "text", { containerId: "db", text: "Postgres" }),
      el("a1", "arrow", { startBinding: { elementId: "api" }, endBinding: { elementId: "db" } }),
      el("note", "text", { text: "10k QPS peak" }),
      el("gone", "rectangle", { isDeleted: true }),
      el("scribble", "freedraw"),
    ];
    const text = describeBoard(board);
    expect(text).toContain("Components (2):\n- API gateway\n- Postgres");
    expect(text).toContain("API gateway → Postgres");
    expect(text).toContain("- 10k QPS peak");
    expect(text).toContain("1 freehand stroke");
    expect(text).not.toContain("gone");
  });
  it("says so when the board is empty", () => {
    expect(describeBoard([])).toBe("The board was empty.");
    expect(describeBoard([el("x", "rectangle", { isDeleted: true })])).toBe("The board was empty.");
  });
});

const t = (s: number) => new Date(Date.UTC(2026, 9, 31, 10, 0, s)).toISOString();
let seq = 0;
const ev = (type: SessionEvent["type"], at: number, extra: Partial<SessionEvent> = {}): SessionEvent => ({
  seq: ++seq,
  type,
  participant_id: null,
  actor_role: "interviewer",
  visibility: "all",
  phase: null,
  payload: {},
  created_at: t(at),
  ...extra,
});

describe("buildAssessmentPrompt", () => {
  const problem = getProblem("payment-ledger") ?? null;
  const input: AssessmentInput = {
    session: {
      problem_title: "Design a payment ledger",
      problem_snapshot: { summary: "s", prompt: "Build a ledger for payouts." },
      phase_plan: phasePlanFor("senior"),
      notes: "QPS ~ 2k",
      board: [el("r", "rectangle"), el("l", "text", { containerId: "r", text: "Ledger DB" })] as AssessmentInput["session"]["board"],
      ended_at: t(90),
      end_reason: "completed" as const,
      code: "",
      code_language: null,
    },
    candidate: { role_title: "Backend engineer", seniority: "senior" },
    events: [
      ev("session.started", 0),
      ev("phase.changed", 0, { payload: { to: "requirements" } }),
      ev("chat.message", 30, { actor_role: "candidate", payload: { text: "Is it multi-currency?" } }),
      ev("probe.asked", 65, { payload: { text: "How do you make writes idempotent?" } }),
      ev("session.ended", 90),
    ],
    problem,
  };

  it("includes the rubric, timeline, transcript with times, notes and board", () => {
    const prompt = buildAssessmentPrompt(input);
    expect(prompt).toContain("<role>Backend engineer, Senior level</role>");
    expect(prompt).toContain("communication (Communication)");
    expect(prompt).toContain("[0:30] Candidate: Is it multi-currency?");
    expect(prompt).toContain("[1:05] Interviewer (follow-up question): How do you make writes idempotent?");
    expect(prompt).toContain("QPS ~ 2k");
    expect(prompt).toContain("- Ledger DB");
    if (problem) expect(prompt).toContain(problem.guide.reference[0]);
  });

  it("says when there was no chat, rather than leaving the model to guess", () => {
    const prompt = buildAssessmentPrompt({ ...input, events: [ev("session.started", 0)] });
    expect(prompt).toContain("No messages were exchanged");
  });
});

describe("normalizeOutput", () => {
  it("keys scores by aspect, keeps the first of duplicates and clips to the database limits", () => {
    const out = normalizeOutput({
      aspects: [
        { aspect: "requirements", score: 3, evidence: "x".repeat(3000) },
        { aspect: "requirements", score: 1, evidence: "dupe" },
        { aspect: "communication", score: null, evidence: "" },
      ],
      recommendation: "yes",
      summary: "  Good.  ",
      strengths: ["a", " ", "b", "c", "d", "e", "f"],
      concerns: [],
    });
    expect(out.scores.requirements?.score).toBe(3);
    expect(out.scores.requirements?.evidence.length).toBe(2000);
    expect(out.scores.communication).toEqual({ score: null, evidence: "" });
    expect(out.summary).toBe("Good.");
    expect(out.strengths).toEqual(["a", "b", "c", "d", "e"]);
  });
});
