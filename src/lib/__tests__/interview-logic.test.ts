import { describe, expect, it } from "vitest";
import { BoardDeltaTracker, chunkDeltas, mergeBoard, type BoardElement } from "../interview/board";
import { GENERIC_SESSION_ERROR, sessionErrorMessage } from "../interview/errors";
import type { SessionEvent } from "../interview/events";
import { hashInviteToken, generateInviteToken, isWellFormedToken } from "../interview/invite-token";
import { computeMetrics, formatDuration } from "../interview/metrics";
import { phasePlanFor } from "../interview/phases";
import { averageScore, evaluationSchema } from "../interview/rubric";

const el = (id: string, version: number, versionNonce: number, extra: Partial<BoardElement> = {}): BoardElement => ({
  id,
  version,
  versionNonce,
  ...extra,
});

describe("mergeBoard (must match SQL merge_board)", () => {
  it("keeps the highest version and existing positions; appends new ids", () => {
    const merged = mergeBoard([el("a", 1, 5), el("b", 2, 5)], [el("c", 1, 1), el("a", 3, 9), el("b", 1, 1)]);
    expect(merged.map((e) => [e.id, e.version])).toEqual([
      ["a", 3],
      ["b", 2],
      ["c", 1],
    ]);
  });
  it("breaks version ties with the lower nonce, in any order", () => {
    const x = el("a", 2, 10, { x: 1 });
    const y = el("a", 2, 3, { x: 2 });
    expect(mergeBoard([x], [y])[0].x).toBe(2);
    expect(mergeBoard([y], [x])[0].x).toBe(2);
  });
  it("is idempotent", () => {
    const board = mergeBoard([], [el("a", 1, 1), el("b", 1, 1)]);
    expect(mergeBoard(board, board)).toEqual(board);
  });
});

describe("BoardDeltaTracker", () => {
  it("returns only elements that changed since last sent", () => {
    const t = new BoardDeltaTracker([el("a", 1, 1)]);
    const next = [el("a", 1, 1), el("b", 1, 1)];
    expect(t.changed(next).map((e) => e.id)).toEqual(["b"]);
    t.markSent(next);
    expect(t.changed([el("a", 2, 7), el("b", 1, 1)]).map((e) => e.id)).toEqual(["a"]);
  });
});

describe("chunkDeltas", () => {
  it("respects the count and size limits", () => {
    const many = Array.from({ length: 1201 }, (_, i) => el(`e${i}`, 1, 1));
    expect(chunkDeltas(many).map((c) => c.length)).toEqual([500, 500, 201]);
    const big = Array.from({ length: 3 }, (_, i) => el(`e${i}`, 1, 1, { text: "x".repeat(120_000) }));
    expect(chunkDeltas(big)).toHaveLength(3);
  });
});

describe("invite tokens", () => {
  it("are 256-bit base64url and hash to hex sha256", () => {
    const { token, hash } = generateInviteToken();
    expect(isWellFormedToken(token)).toBe(true);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(token)).toBe(hash);
    expect(generateInviteToken().token).not.toBe(token);
  });
  it("rejects malformed tokens", () => {
    for (const bad of ["", "abc", "x".repeat(44), "../../etc/passwd/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]) {
      expect(isWellFormedToken(bad)).toBe(false);
    }
  });
});

describe("session error mapping", () => {
  it("passes through our own messages", () => {
    expect(sessionErrorMessage({ code: "22023", message: "This session has ended" })).toBe("This session has ended");
  });
  it("hides internals", () => {
    expect(sessionErrorMessage({ code: "23505", message: "duplicate key value violates unique constraint" })).toBe(
      GENERIC_SESSION_ERROR,
    );
    expect(sessionErrorMessage({ code: "42501", message: "permission denied for table x" })).toBe(GENERIC_SESSION_ERROR);
    expect(sessionErrorMessage(null)).toBe(GENERIC_SESSION_ERROR);
  });
});

describe("evaluation schema", () => {
  const base = { scores: { requirements: { score: 3, evidence: "Good" } }, recommendation: "yes", summary: "Solid", submit: true };
  it("accepts a complete scorecard", () => {
    expect(evaluationSchema.safeParse(base).success).toBe(true);
  });
  it("requires recommendation and summary to submit a scorecard, but not for drafts", () => {
    expect(evaluationSchema.safeParse({ ...base, recommendation: null }).success).toBe(false);
    expect(evaluationSchema.safeParse({ ...base, summary: "  " }).success).toBe(false);
    expect(evaluationSchema.safeParse({ ...base, recommendation: null, summary: "", submit: false }).success).toBe(true);
  });
  // Which aspects exist depends on the session's rubric snapshot; the database checks that (scores_valid).
  it("rejects malformed aspect keys and out-of-range scores", () => {
    expect(evaluationSchema.safeParse({ ...base, scores: { "Not a key": { score: 3, evidence: "" } } }).success).toBe(false);
    expect(evaluationSchema.safeParse({ ...base, scores: { requirements: { score: 5, evidence: "" } } }).success).toBe(false);
  });
  it("grades communication as well as every phase", () => {
    expect(evaluationSchema.safeParse({ ...base, scores: { communication: { score: 4, evidence: "Clear" } } }).success).toBe(true);
  });
  it("averages only scored phases", () => {
    expect(averageScore({ requirements: { score: 3, evidence: "" }, deep_dive: { score: 2, evidence: "" }, tradeoffs: { score: null, evidence: "" } })).toBe(2.5);
    expect(averageScore({})).toBeNull();
  });
});

describe("computeMetrics", () => {
  const t = (min: number) => new Date(Date.UTC(2026, 9, 30, 10, min)).toISOString();
  let seq = 0;
  const ev = (type: SessionEvent["type"], min: number, extra: Partial<SessionEvent> = {}): SessionEvent => ({
    seq: ++seq,
    type,
    participant_id: "p1",
    actor_role: "interviewer",
    visibility: "all",
    phase: null,
    payload: {},
    created_at: t(min),
    ...extra,
  });

  it("measures time per phase, revisits, probes and the first diagram", () => {
    seq = 0;
    const events = [
      ev("session.created", 0),
      ev("session.started", 1),
      ev("phase.changed", 1, { payload: { to: "requirements" } }),
      ev("probe.asked", 3, { phase: "requirements" }),
      ev("phase.changed", 7, { payload: { to: "high_level_design" } }),
      ev("board.updated", 9, { phase: "high_level_design", participant_id: "p2" }),
      ev("phase.changed", 20, { payload: { to: "requirements" } }),
      ev("chat.message", 21, { phase: "requirements", participant_id: "p2" }),
      ev("session.ended", 22),
    ];
    const m = computeMetrics(events, phasePlanFor("mid"));
    const req = m.phases.find((p) => p.phase === "requirements")!;
    expect(req.actualMs).toBe(8 * 60_000);
    expect(req.visits).toBe(2);
    expect(req.probes).toBe(1);
    expect(m.phases.find((p) => p.phase === "high_level_design")!.actualMs).toBe(13 * 60_000);
    expect(m.path).toEqual(["requirements", "high_level_design", "requirements"]);
    expect(m.durationMs).toBe(21 * 60_000);
    expect(m.firstBoardEditMs).toBe(8 * 60_000);
    expect(m.byParticipant.p2).toMatchObject({ boardEdits: 1, chatMessages: 1 });
    expect(m.plannedMs).toBe(45 * 60_000);
  });

  it("counts a running phase up to now and handles sessions that never started", () => {
    seq = 0;
    const running = [ev("session.started", 0), ev("phase.changed", 0, { payload: { to: "estimation" } })];
    const m = computeMetrics(running, phasePlanFor("mid"), t(4));
    expect(m.phases.find((p) => p.phase === "estimation")!.actualMs).toBe(4 * 60_000);
    expect(computeMetrics([ev("session.created", 0)], phasePlanFor("mid")).durationMs).toBeNull();
  });

  it("formats durations", () => {
    expect(formatDuration(65_000)).toBe("1:05");
    expect(formatDuration(3_725_000)).toBe("1:02:05");
    expect(formatDuration(-30_000)).toBe("-0:30");
  });
});
