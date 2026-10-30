import { createHash, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAdmin, asAnon, asUser, createAuthUser, createMember, createTestDb } from "./helpers";

let db: PGlite;

beforeEach(async () => {
  db = await createTestDb();
});

const PLAN = { requirements: 5, estimation: 5, api_data_model: 7, high_level_design: 12, deep_dive: 12, tradeoffs: 4 };
const SNAPSHOT = { summary: "Design a payment ledger", prompt: "You're building…" };

async function createSession(userId: string, mode: "solo" | "peer" = "peer") {
  const { rows } = await asUser<{ id: string }>(
    db,
    userId,
    `select public.create_session($1, 'payment-ledger', 1, 'Design a payment ledger', $2, $3, 'Ada', true) as id`,
    [mode, SNAPSHOT, PLAN],
  );
  return rows[0].id;
}

function newToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}

async function invite(candidate: string, session: string) {
  const { hash } = newToken();
  await asUser(db, candidate, "select public.create_session_invite($1, $2)", [session, hash]);
  return hash;
}

async function join(user: string, hash: string, name = "Grace") {
  const { rows } = await asUser<{ id: string }>(db, user, "select public.accept_session_invite($1, $2, true) as id", [
    hash,
    name,
  ]);
  return rows[0].id;
}

/** A running peer session with a candidate and one interviewer. */
async function runningPeerSession() {
  const candidate = await createMember(db);
  const interviewer = await createAuthUser(db); // no seat needed (ADR 0005)
  const session = await createSession(candidate);
  await join(interviewer, await invite(candidate, session));
  await asUser(db, interviewer, "select public.start_session($1)", [session]);
  return { candidate, interviewer, session };
}

const record = (user: string, session: string, type: string, payload: unknown) =>
  asUser<{ seq: number | null }>(db, user, "select public.record_event($1, $2, $3) as seq", [session, type, payload]);

const events = async (session: string) =>
  (
    await asAdmin<{ seq: number; type: string; actor_role: string; visibility: string; phase: string | null }>(
      db,
      "select seq, type, actor_role, visibility, phase from public.session_events where session_id = $1 order by seq",
      [session],
    )
  ).rows;

const sessionRow = async (session: string) =>
  (await asAdmin<Record<string, unknown>>(db, "select * from public.interview_sessions where id = $1", [session]))
    .rows[0];

const verify = async (user: string, session: string) =>
  (
    await asUser<{ ok: boolean; event_count: number; first_bad_seq: number | null }>(
      db,
      user,
      "select * from public.verify_session_log($1)",
      [session],
    )
  ).rows[0];

describe("create_session", () => {
  it("creates a lobby session with the candidate and an audit trail", async () => {
    const candidate = await createMember(db);
    const session = await createSession(candidate);
    const row = await sessionRow(session);
    expect(row).toMatchObject({ status: "lobby", mode: "peer", problem_slug: "payment-ledger", last_seq: 3 });
    expect((await events(session)).map((e) => e.type)).toEqual([
      "session.created",
      "participant.joined",
      "consent.given",
    ]);
  });

  it("requires an onboarded member, consent and a valid phase plan", async () => {
    const outsider = await createAuthUser(db);
    await expect(createSession(outsider)).rejects.toThrow(/finished onboarding/);

    const member = await createMember(db);
    await expect(
      asUser(
        db,
        member,
        `select public.create_session('solo', 'x-y', 1, 'T', '{}', $1, 'Ada', false)`,
        [PLAN],
      ),
    ).rejects.toThrow(/consent/);
    await expect(
      asUser(db, member, `select public.create_session('solo', 'x-y', 1, 'T', '{}', $1, 'Ada', true)`, [
        { requirements: 5 },
      ]),
    ).rejects.toThrow(/check constraint/);
  });

  it("caps open sessions per candidate at 3", async () => {
    const member = await createMember(db);
    for (let i = 0; i < 3; i++) await createSession(member, "solo");
    await expect(createSession(member, "solo")).rejects.toThrow(/3 open sessions/);
  });

  it("is not callable anonymously", async () => {
    await expect(
      asAnon(db, `select public.create_session('solo', 'x', 1, 'T', '{}', '{}', 'A', true)`),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("invites", () => {
  it("lets a signed-in non-member join as interviewer, once", async () => {
    const candidate = await createMember(db);
    const session = await createSession(candidate);
    const hash = await invite(candidate, session);
    const interviewer = await createAuthUser(db);

    const preview = await asUser<{ invite_state: string; candidate_name: string; my_role: string | null }>(
      db,
      interviewer,
      "select * from public.session_invite_preview($1)",
      [hash],
    );
    expect(preview.rows[0]).toMatchObject({ invite_state: "valid", candidate_name: "Ada", my_role: null });

    expect(await join(interviewer, hash)).toBe(session);
    // Clicking the link again is harmless.
    expect(await join(interviewer, hash)).toBe(session);

    // Single use: a third person can't reuse it.
    const other = await createAuthUser(db);
    await expect(join(other, hash)).rejects.toThrow(/expired or was already used/);
  });

  it("rejects self-invites, expired, revoked and unknown links", async () => {
    const candidate = await createMember(db);
    const session = await createSession(candidate);
    const hash = await invite(candidate, session);
    await expect(join(candidate, hash)).rejects.toThrow(/interview yourself/);

    const someone = await createAuthUser(db);
    await expect(join(someone, "0".repeat(64))).rejects.toThrow(/isn't valid/);

    await asAdmin(
      db,
      `update public.session_invites set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
       where token_hash = $1`,
      [hash],
    );
    await expect(join(someone, hash)).rejects.toThrow(/expired/);

    const second = await invite(candidate, session);
    await asUser(db, candidate, "select public.revoke_session_invites($1)", [session]);
    await expect(join(someone, second)).rejects.toThrow(/expired or was already used/);
  });

  it("making a new invite revokes the previous one", async () => {
    const candidate = await createMember(db);
    const session = await createSession(candidate);
    const first = await invite(candidate, session);
    await invite(candidate, session);
    await expect(join(await createAuthUser(db), first)).rejects.toThrow(/already used/);
  });

  it("allows at most 2 interviewers and only in peer mode", async () => {
    const candidate = await createMember(db);
    const session = await createSession(candidate);
    await join(await createAuthUser(db), await invite(candidate, session));
    await join(await createAuthUser(db), await invite(candidate, session));
    await expect(invite(candidate, session)).rejects.toThrow(/2 interviewers/);

    const solo = await createSession(candidate, "solo");
    await expect(invite(candidate, solo)).rejects.toThrow(/Solo sessions/);
  });

  it("only the candidate can invite", async () => {
    const { interviewer, session } = await runningPeerSession();
    await expect(invite(interviewer, session)).rejects.toThrow(/Only the candidate/);
  });

  it("invite tokens are not readable by clients", async () => {
    const candidate = await createMember(db);
    await invite(candidate, await createSession(candidate));
    await expect(asUser(db, candidate, "select * from public.session_invites")).rejects.toThrow(/permission denied/);
  });
});

describe("lifecycle and phases", () => {
  it("in peer mode only the interviewer starts and changes phases", async () => {
    const candidate = await createMember(db);
    const interviewer = await createAuthUser(db);
    const session = await createSession(candidate);
    await join(interviewer, await invite(candidate, session));

    await expect(asUser(db, candidate, "select public.start_session($1)", [session])).rejects.toThrow(
      /Only the interviewer/,
    );
    await asUser(db, interviewer, "select public.start_session($1)", [session]);
    expect(await sessionRow(session)).toMatchObject({ status: "in_progress", phase: "requirements" });

    await expect(
      asUser(db, candidate, "select public.change_session_phase($1, 'estimation')", [session]),
    ).rejects.toThrow(/Only the interviewer/);
    await asUser(db, interviewer, "select public.change_session_phase($1, 'estimation')", [session]);
    await expect(
      asUser(db, interviewer, "select public.change_session_phase($1, 'lunch')", [session]),
    ).rejects.toThrow(/Unknown phase/);

    const log = await events(session);
    const last = log[log.length - 1];
    expect(last).toMatchObject({ type: "phase.changed", phase: "estimation" });
  });

  it("in solo mode the candidate controls everything", async () => {
    const candidate = await createMember(db);
    const session = await createSession(candidate, "solo");
    await asUser(db, candidate, "select public.start_session($1)", [session]);
    await asUser(db, candidate, "select public.change_session_phase($1, 'deep_dive')", [session]);
    const reason = await asUser<{ r: string }>(db, candidate, "select public.end_session($1) as r", [session]);
    expect(reason.rows[0].r).toBe("completed");
  });

  it("ending: lobby cancels, controller completes, the other side ends early; idempotent", async () => {
    const candidate = await createMember(db);
    const lobby = await createSession(candidate);
    const r1 = await asUser<{ r: string }>(db, candidate, "select public.end_session($1) as r", [lobby]);
    expect(r1.rows[0].r).toBe("cancelled");

    const { candidate: c2, interviewer, session } = await runningPeerSession();
    const r2 = await asUser<{ r: string }>(db, c2, "select public.end_session($1) as r", [session]);
    expect(r2.rows[0].r).toBe("ended_early");
    const r3 = await asUser<{ r: string }>(db, interviewer, "select public.end_session($1) as r", [session]);
    expect(r3.rows[0].r).toBe("ended_early");
    expect((await events(session)).filter((e) => e.type === "session.ended")).toHaveLength(1);
  });

  it("nothing can be recorded on the board after the session ends", async () => {
    const { candidate, interviewer, session } = await runningPeerSession();
    await asUser(db, interviewer, "select public.end_session($1)", [session]);
    await expect(record(candidate, session, "notes.updated", { text: "late edit" })).rejects.toThrow(/isn't running/);
    await expect(record(candidate, session, "chat.message", { text: "hi" })).rejects.toThrow(/has ended/);
  });
});

describe("record_event permission matrix", () => {
  it("chat: anyone, also in the lobby", async () => {
    const candidate = await createMember(db);
    const session = await createSession(candidate);
    const { rows } = await record(candidate, session, "chat.message", { text: "  ready when you are  " });
    expect(rows[0].seq).toBe(4);
    await expect(record(candidate, session, "chat.message", { text: "   " })).rejects.toThrow(/1–2,000/);
  });

  it("probes: interviewer only", async () => {
    const { candidate, interviewer, session } = await runningPeerSession();
    await record(interviewer, session, "probe.asked", { text: "What happens if the ledger write times out?" });
    await expect(record(candidate, session, "probe.asked", { text: "?" })).rejects.toThrow(/Only interviewers/);
  });

  it("notes: candidate only, skips unchanged text", async () => {
    const { candidate, interviewer, session } = await runningPeerSession();
    const first = await record(candidate, session, "notes.updated", { text: "QPS: 10k" });
    expect(first.rows[0].seq).not.toBeNull();
    const again = await record(candidate, session, "notes.updated", { text: "QPS: 10k" });
    expect(again.rows[0].seq).toBeNull();
    await expect(record(interviewer, session, "notes.updated", { text: "x" })).rejects.toThrow(/Only the candidate/);
    expect((await sessionRow(session)).notes).toBe("QPS: 10k");
  });

  it("board: anyone; merges by version and ignores stale deltas", async () => {
    const { candidate, interviewer, session } = await runningPeerSession();
    const el = (id: string, version: number, nonce: number, x = 0) => ({
      id,
      type: "rectangle",
      version,
      versionNonce: nonce,
      x,
    });
    await record(candidate, session, "board.updated", { elements: [el("a", 1, 5), el("b", 1, 5)] });
    await record(interviewer, session, "board.updated", { elements: [el("a", 3, 9, 100)] });
    // A stale echo of an older version changes nothing and records nothing.
    const stale = await record(candidate, session, "board.updated", { elements: [el("a", 2, 1)] });
    expect(stale.rows[0].seq).toBeNull();

    const board = (await sessionRow(session)).board as { id: string; version: number; x: number }[];
    expect(board.map((e) => [e.id, e.version, e.x])).toEqual([
      ["a", 3, 100],
      ["b", 1, 0],
    ]);
  });

  it("board: rejects malformed elements and images", async () => {
    const { candidate, session } = await runningPeerSession();
    await expect(record(candidate, session, "board.updated", { elements: [] })).rejects.toThrow(/1–500/);
    await expect(record(candidate, session, "board.updated", { elements: [{ id: "a" }] })).rejects.toThrow(
      /Invalid board element/,
    );
    await expect(
      record(candidate, session, "board.updated", {
        elements: [{ id: "a", type: "image", version: 1, versionNonce: 1 }],
      }),
    ).rejects.toThrow(/Invalid board element/);
  });

  it("stores only validated fields", async () => {
    const { candidate, session } = await runningPeerSession();
    await record(candidate, session, "chat.message", { text: "hi", injected: "<script>" });
    const { rows } = await asAdmin<{ payload: Record<string, unknown> }>(
      db,
      "select payload from public.session_events where session_id = $1 and type = 'chat.message'",
      [session],
    );
    expect(rows[0].payload).toEqual({ text: "hi" });
  });

  it("rejects system-only and unknown event types", async () => {
    const { candidate, session } = await runningPeerSession();
    await expect(record(candidate, session, "session.ended", {})).rejects.toThrow(/system-only/);
    await expect(record(candidate, session, "evaluation.submitted", {})).rejects.toThrow(/system-only/);
  });

  it("non-participants can't record", async () => {
    const { session } = await runningPeerSession();
    const stranger = await createMember(db, "Mallory");
    await expect(record(stranger, session, "chat.message", { text: "hi" })).rejects.toThrow(/not part of this session/);
  });
});

describe("row-level security", () => {
  it("non-participants see nothing", async () => {
    const { session } = await runningPeerSession();
    const stranger = await createMember(db, "Mallory");
    for (const table of [
      "interview_sessions",
      "session_participants",
      "session_events",
      "session_evaluations",
      "session_interviewer_notes",
    ]) {
      const { rows } = await asUser(db, stranger, `select * from public.${table}`);
      expect(rows, table).toHaveLength(0);
    }
    await expect(asUser(db, stranger, "select * from public.verify_session_log($1)", [session])).rejects.toThrow(
      /not part/,
    );
  });

  it("private interviewer notes never reach the candidate", async () => {
    const { candidate, interviewer, session } = await runningPeerSession();
    await record(interviewer, session, "interviewer_note.updated", { text: "Missed idempotency entirely" });

    const candidateEvents = await asUser<{ type: string }>(db, candidate, "select type from public.session_events");
    expect(candidateEvents.rows.map((r) => r.type)).not.toContain("interviewer_note.updated");
    const candidateNotes = await asUser(db, candidate, "select * from public.session_interviewer_notes");
    expect(candidateNotes.rows).toHaveLength(0);

    const mine = await asUser<{ body: string }>(db, interviewer, "select body from public.session_interviewer_notes");
    expect(mine.rows[0].body).toBe("Missed idempotency entirely");

    // Broadcast went to the interviewers-only topic.
    const { rows } = await asAdmin<{ topic: string }>(
      db,
      "select topic from realtime.messages where payload->>'type' = 'interviewer_note.updated'",
    );
    expect(rows[0].topic).toBe(`session:${session}:interviewers`);
  });

  it("clients can't write tables directly", async () => {
    const { candidate, session } = await runningPeerSession();
    await expect(
      asUser(db, candidate, "update public.interview_sessions set status = 'completed' where id = $1", [session]),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(db, candidate, "delete from public.session_events where session_id = $1", [session])).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asUser(db, candidate, "select public.append_session_event($1, null, 'system', 'chat.message', '{}')", [session]),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("realtime authorisation", () => {
  const canUse = async (user: string, topic: string, send: boolean) =>
    (
      await asUser<{ ok: boolean }>(db, user, "select public.realtime_topic_allowed($1, $2) as ok", [topic, send])
    ).rows[0].ok;

  it("routes topics by role and session state", async () => {
    const { candidate, interviewer, session } = await runningPeerSession();
    const stranger = await createMember(db, "Mallory");
    const main = `session:${session}`;
    const priv = `session:${session}:interviewers`;

    expect(await canUse(candidate, main, false)).toBe(true);
    expect(await canUse(candidate, main, true)).toBe(true);
    expect(await canUse(candidate, priv, false)).toBe(false);
    expect(await canUse(interviewer, priv, false)).toBe(true);
    expect(await canUse(interviewer, priv, true)).toBe(false);
    expect(await canUse(stranger, main, false)).toBe(false);
    expect(await canUse(candidate, "session:not-a-uuid", false)).toBe(false);

    await asUser(db, interviewer, "select public.end_session($1)", [session]);
    expect(await canUse(candidate, main, true)).toBe(false); // no live edits after the end
    expect(await canUse(candidate, main, false)).toBe(true);
  });

  it("broadcasts each recorded event to the session topic", async () => {
    const { candidate, session } = await runningPeerSession();
    await record(candidate, session, "chat.message", { text: "hello" });
    const { rows } = await asAdmin<{ topic: string; event: string; payload: { seq: number; type: string } }>(
      db,
      "select topic, event, payload from realtime.messages order by id desc limit 1",
    );
    expect(rows[0]).toMatchObject({ topic: `session:${session}`, event: "event" });
    expect(rows[0].payload.type).toBe("chat.message");
    const head = (await sessionRow(session)).last_seq;
    expect(rows[0].payload.seq).toBe(Number(head));
  });
});

describe("audit log integrity", () => {
  it("verifies an untouched chain", async () => {
    const { candidate, interviewer, session } = await runningPeerSession();
    await record(candidate, session, "notes.updated", { text: "users: 50M" });
    await record(interviewer, session, "probe.asked", { text: "Why Postgres?" });
    const result = await verify(candidate, session);
    expect(result.ok).toBe(true);
    expect(Number(result.event_count)).toBe((await events(session)).length);
  });

  it("rejects updates even from the database owner", async () => {
    const { session } = await runningPeerSession();
    await expect(
      asAdmin(db, "update public.session_events set payload = '{}' where session_id = $1", [session]),
    ).rejects.toThrow(/append-only/);
    await expect(asAdmin(db, "truncate public.session_events")).rejects.toThrow(/append-only/);
  });

  it("detects a rewritten payload", async () => {
    const { candidate, session } = await runningPeerSession();
    await record(candidate, session, "chat.message", { text: "I'd use Kafka" });
    // Simulate tampering by someone who bypasses the trigger.
    await asAdmin(db, "alter table public.session_events disable trigger session_events_no_update");
    await asAdmin(
      db,
      `update public.session_events set payload = '{"text":"I''d use a queue"}'
       where session_id = $1 and type = 'chat.message'`,
      [session],
    );
    const result = await verify(candidate, session);
    expect(result.ok).toBe(false);
    const tampered = (await events(session)).find((e) => e.type === "chat.message")!;
    expect(Number(result.first_bad_seq)).toBe(tampered.seq);
  });

  it("detects events removed from the end", async () => {
    const { candidate, session } = await runningPeerSession();
    await record(candidate, session, "chat.message", { text: "last words" });
    await asAdmin(
      db,
      "delete from public.session_events where session_id = $1 and seq = (select max(seq) from public.session_events where session_id = $1)",
      [session],
    );
    expect((await verify(candidate, session)).ok).toBe(false);
  });

  it("assigns gap-free sequence numbers and records the phase", async () => {
    const { candidate, interviewer, session } = await runningPeerSession();
    await asUser(db, interviewer, "select public.change_session_phase($1, 'high_level_design')", [session]);
    await record(candidate, session, "notes.updated", { text: "LB → API → DB" });
    const log = await events(session);
    expect(log.map((e) => e.seq)).toEqual(log.map((_, i) => i + 1));
    expect(log[log.length - 1].phase).toBe("high_level_design");
  });
});

describe("evaluations", () => {
  const scores = { requirements: { score: 3, evidence: "Asked about scale early" }, deep_dive: { score: 2 } };
  const save = (user: string, session: string, rec: string | null, submit: boolean, s: unknown = scores) =>
    asUser(db, user, "select public.save_evaluation($1, $2, $3, $4, $5)", [session, s, rec, "Solid overall", submit]);

  it("drafts during the session, submits only after it ends, then is immutable", async () => {
    const { candidate, interviewer, session } = await runningPeerSession();
    await save(interviewer, session, "yes", false);
    await expect(save(interviewer, session, "yes", true)).rejects.toThrow(/once the session has ended/);

    await asUser(db, interviewer, "select public.end_session($1)", [session]);
    await save(interviewer, session, "yes", true);
    await expect(save(interviewer, session, "no", false)).rejects.toThrow(/already submitted/);
    await expect(
      asAdmin(db, "update public.session_evaluations set recommendation = 'no' where session_id = $1", [session]),
    ).rejects.toThrow(/can't be changed/);

    const log = await events(session);
    expect(log[log.length - 1]).toMatchObject({ type: "evaluation.submitted", actor_role: "interviewer" });
    // Candidate still sees the result.
    const { rows } = await asUser<{ recommendation: string }>(
      db,
      candidate,
      "select recommendation from public.session_evaluations",
    );
    expect(rows[0].recommendation).toBe("yes");
  });

  it("validates scores and required fields", async () => {
    const { candidate, interviewer, session } = await runningPeerSession();
    await asUser(db, interviewer, "select public.end_session($1)", [session]);
    await expect(save(interviewer, session, "yes", false, { lunch: { score: 3 } })).rejects.toThrow(/Invalid scores/);
    await expect(save(interviewer, session, "yes", false, { requirements: { score: 5 } })).rejects.toThrow(
      /Invalid scores/,
    );
    await expect(save(interviewer, session, null, true)).rejects.toThrow(/recommendation and a summary/);
    await expect(save(interviewer, session, "yes", true, {})).rejects.toThrow(/at least one phase/);
    await expect(save(candidate, session, "yes", false)).rejects.toThrow(/self-assessment/);
  });

  it("releases scorecards without anchoring (ADR 0006)", async () => {
    const candidate = await createMember(db);
    const [i1, i2] = [await createAuthUser(db), await createAuthUser(db)];
    const session = await createSession(candidate);
    await join(i1, await invite(candidate, session), "Grace");
    await join(i2, await invite(candidate, session), "Barbara");
    await asUser(db, i1, "select public.start_session($1)", [session]);
    await asUser(db, i1, "select public.end_session($1)", [session]);

    const visible = async (user: string) =>
      (await asUser<{ kind: string }>(db, user, "select kind from public.session_evaluations")).rows.length;

    await save(i1, session, "yes", false); // draft
    expect(await visible(candidate)).toBe(0); // drafts are private
    await save(i1, session, "yes", true);
    expect(await visible(candidate)).toBe(1);
    expect(await visible(i2)).toBe(0); // i2 hasn't submitted yet → can't see i1's

    await save(candidate, session, null, true); // self-assessment
    expect(await visible(i2)).toBe(0);
    await save(i2, session, "strong_yes", true);
    expect(await visible(i2)).toBe(3);
    expect(await visible(candidate)).toBe(3);
  });
});

describe("account deletion", () => {
  it("an interviewer deleting their account anonymises them but keeps the log verifiable", async () => {
    const { candidate, interviewer, session } = await runningPeerSession();
    await record(interviewer, session, "probe.asked", { text: "How do you shard?" });
    await asAdmin(db, "delete from auth.users where id = $1", [interviewer]);
    const { rows } = await asUser<{ display_name: string; user_id: string | null }>(
      db,
      candidate,
      "select display_name, user_id from public.session_participants where role = 'interviewer'",
    );
    expect(rows[0]).toEqual({ display_name: "Deleted user", user_id: null });
    expect((await verify(candidate, session)).ok).toBe(true);
  });

  it("the candidate deleting their account removes their sessions", async () => {
    const { candidate, session } = await runningPeerSession();
    await asUser(db, candidate, "select public.delete_my_account()");
    const { rows } = await asAdmin(db, "select 1 from public.interview_sessions where id = $1", [session]);
    expect(rows).toHaveLength(0);
  });
});
