import { createHash, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  addCandidate,
  addMember,
  asAdmin,
  asAnon,
  asService,
  asUser,
  createAnonUser,
  createAuthUser,
  createTestDb,
  createWorkspace,
} from "./helpers";

let db: PGlite;

beforeEach(async () => {
  db = await createTestDb();
});

const PLAN = { requirements: 5, estimation: 5, api_data_model: 7, high_level_design: 12, deep_dive: 12, tradeoffs: 4 };
const SNAPSHOT = { summary: "Design a payment ledger", prompt: "You're building…" };

function newToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}

const RUBRIC = {
  name: "System design",
  aspects: ["requirements", "estimation", "api_data_model", "high_level_design", "deep_dive", "tradeoffs", "communication"].map(
    (key) => ({ key, label: key, assesses: "", solid: [] }),
  ),
};

async function schedule(member: string, candidate: string, interviewers: string[]) {
  const { rows } = await asUser<{ id: string }>(
    db,
    member,
    `select public.create_session($1, 'system_design', 'payment-ledger', null, 1, 'Design a payment ledger', $2, $3, $4, $5) as id`,
    [candidate, SNAPSHOT, PLAN, RUBRIC, interviewers],
  );
  return rows[0].id;
}

async function link(user: string, session: string) {
  const { hash } = newToken();
  await asUser(db, user, "select public.create_candidate_link($1, $2)", [session, hash]);
  return hash;
}

async function acceptLink(user: string, hash: string, name = "Cal") {
  const { rows } = await asUser<{ id: string }>(db, user, "select public.accept_candidate_link($1, $2, true) as id", [
    hash,
    name,
  ]);
  return rows[0].id;
}

const joinAsInterviewer = (user: string, session: string) =>
  asUser(db, user, "select public.join_session($1, true)", [session]);

/** A workspace with an admin, an interviewer and a candidate, and a scheduled interview. */
async function scheduled() {
  const { user: admin, org } = await createWorkspace(db);
  const interviewer = await addMember(db, org, "interviewer");
  const candidateRecord = await addCandidate(db, admin, org);
  const session = await schedule(admin, candidateRecord, [interviewer]);
  return { admin, org, interviewer, candidateRecord, session };
}

/** A running interview: the interviewer joined, the candidate came in by link, and it started. */
async function running() {
  const s = await scheduled();
  await joinAsInterviewer(s.interviewer, s.session);
  const candidate = await createAnonUser(db);
  await acceptLink(candidate, await link(s.interviewer, s.session));
  await asUser(db, s.interviewer, "select public.start_session($1)", [s.session]);
  return { ...s, candidate };
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

const count = async (user: string, sql: string, params: unknown[] = []) =>
  Number((await asUser<{ n: number }>(db, user, `select count(*)::int as n from (${sql}) q`, params)).rows[0].n);

describe("workspaces", () => {
  it("signing up creates a workspace with you as its admin", async () => {
    const { user, org } = await createWorkspace(db, "Acme", "Ada");
    const { rows } = await asUser<{ role: string; display_name: string }>(
      db,
      user,
      "select role, display_name from public.org_members where org_id = $1",
      [org],
    );
    expect(rows).toEqual([{ role: "admin", display_name: "Ada" }]);
    await expect(asUser(db, user, "select public.create_organization('Again', 'Ada')")).rejects.toThrow(/already part/);
  });

  it("anonymous (candidate) sessions can't create workspaces", async () => {
    const anon = await createAnonUser(db);
    await expect(asUser(db, anon, "select public.create_organization('X', 'Y')")).rejects.toThrow(/work email/);
  });

  it("teammates join by an email-bound, single-use invite", async () => {
    const { user: admin, org } = await createWorkspace(db);
    const { hash } = newToken();
    await asUser(db, admin, "select public.create_org_invite('ivy@example.com', 'interviewer', $1)", [hash]);

    const wrong = await createAuthUser(db, undefined, "someone@example.com");
    await expect(asUser(db, wrong, "select public.accept_org_invite($1, 'Sam')", [hash])).rejects.toThrow(/ivy@example.com/);

    const ivy = await createAuthUser(db, undefined, "Ivy@Example.com");
    const preview = (await asUser<{ invite_state: string; email_matches: boolean }>(
      db,
      ivy,
      "select * from public.org_invite_preview($1)",
      [hash],
    )).rows[0];
    expect(preview).toMatchObject({ invite_state: "valid", email_matches: true });

    await asUser(db, ivy, "select public.accept_org_invite($1, 'Ivy')", [hash]);
    expect(await count(ivy, "select 1 from public.org_members where org_id = $1", [org])).toBe(2);

    const other = await createAuthUser(db, undefined, "ivy@example.com"); // same address, second account
    await expect(asUser(db, other, "select public.accept_org_invite($1, 'Ivy')", [hash])).rejects.toThrow(/expired or was already used/);
  });

  it("only admins invite, change roles and remove people; a workspace keeps an admin", async () => {
    const { user: admin, org } = await createWorkspace(db);
    const ivy = await addMember(db, org, "interviewer");
    const { hash } = newToken();
    await expect(
      asUser(db, ivy, "select public.create_org_invite('x@example.com', 'interviewer', $1)", [hash]),
    ).rejects.toThrow(/Only admins/);
    await expect(asUser(db, ivy, "select public.remove_org_member($1)", [admin])).rejects.toThrow(/Only admins/);
    await expect(asUser(db, admin, "select public.set_org_member_role($1, 'interviewer')", [admin])).rejects.toThrow(
      /at least one admin/,
    );
    await asUser(db, admin, "select public.set_org_member_role($1, 'admin')", [ivy]);
    await asUser(db, admin, "select public.set_org_member_role($1, 'interviewer')", [admin]);
    await asUser(db, ivy, "select public.remove_org_member($1)", [admin]);
    expect(await count(ivy, "select 1 from public.org_members")).toBe(1);
  });

  it("invite token hashes aren't readable, even by admins", async () => {
    const { user: admin } = await createWorkspace(db);
    const { hash } = newToken();
    await asUser(db, admin, "select public.create_org_invite('x@example.com', 'interviewer', $1)", [hash]);
    expect(await count(admin, "select id, email from public.org_invites")).toBe(1);
    await expect(asUser(db, admin, "select token_hash from public.org_invites")).rejects.toThrow(/permission denied/);
  });
});

describe("candidates", () => {
  it("members add and edit candidates in their own workspace only", async () => {
    const { user: admin, org } = await createWorkspace(db);
    const other = await createWorkspace(db, "Globex", "Gus");
    const id = await addCandidate(db, admin, org, "Cal Candidate");

    await expect(
      asUser(db, other.user, "insert into public.candidates (org_id, full_name) values ($1, 'Sneaky')", [org]),
    ).rejects.toThrow(/row-level security/);
    expect(await count(other.user, "select 1 from public.candidates")).toBe(0);

    await asUser(db, admin, "update public.candidates set role_title = 'Backend engineer' where id = $1", [id]);
    await expect(asUser(db, admin, "update public.candidates set org_id = $2 where id = $1", [id, other.org])).rejects.toThrow(
      /permission denied/,
    );
  });

  it("only admins delete candidates, and their interviews go with them", async () => {
    const s = await scheduled();
    await asUser(db, s.interviewer, "delete from public.candidates where id = $1", [s.candidateRecord]);
    expect(await count(s.admin, "select 1 from public.candidates")).toBe(1); // RLS: nothing deleted
    await asUser(db, s.admin, "delete from public.candidates where id = $1", [s.candidateRecord]);
    expect(await count(s.admin, "select 1 from public.interview_sessions")).toBe(0);
  });

  it("rejects duplicate emails within a workspace", async () => {
    const { user, org } = await createWorkspace(db);
    await addCandidate(db, user, org, "Cal One");
    await expect(
      asUser(db, user, "insert into public.candidates (org_id, full_name, email) values ($1, 'Cal Two', 'CAL@example.com')", [org]),
    ).rejects.toThrow(/duplicate key/);
  });
});

describe("scheduling", () => {
  it("creates a lobby session with assigned (not yet joined) interviewers", async () => {
    const { interviewer, session } = await scheduled();
    expect(await sessionRow(session)).toMatchObject({ status: "lobby", problem_slug: "payment-ledger" });
    const { rows } = await asAdmin<{ user_id: string; role: string; joined_at: string | null }>(
      db,
      "select user_id, role, joined_at from public.session_participants where session_id = $1",
      [session],
    );
    expect(rows).toEqual([{ user_id: interviewer, role: "interviewer", joined_at: null }]);
    expect((await events(session)).map((e) => [e.type, e.actor_role])).toEqual([["session.created", "member"]]);
  });

  it("validates the candidate, interviewers and limits", async () => {
    const { user: admin, org } = await createWorkspace(db);
    const other = await createWorkspace(db, "Globex", "Gus");
    const cand = await addCandidate(db, admin, org);
    const foreign = await addCandidate(db, other.user, other.org);
    await expect(schedule(admin, foreign, [admin])).rejects.toThrow(/isn't in your workspace/);
    await expect(schedule(admin, cand, [])).rejects.toThrow(/one or two/);
    await expect(schedule(admin, cand, [other.user])).rejects.toThrow(/must be in your workspace/);
    const a = await addMember(db, org);
    const b = await addMember(db, org);
    await expect(schedule(admin, cand, [admin, a, b])).rejects.toThrow(/one or two/);
    for (let i = 0; i < 8; i++) await schedule(admin, cand, [admin]);
    await expect(schedule(admin, cand, [admin])).rejects.toThrow(/8 open interviews/);
  });

  it("isn't callable by candidates or anonymously", async () => {
    const { candidateRecord } = await scheduled();
    const anon = await createAnonUser(db);
    await expect(schedule(anon, candidateRecord, [anon])).rejects.toThrow(/not part of a workspace/);
    await expect(
      asAnon(db, "select public.create_session(gen_random_uuid(), 'coding', 'x', null, 1, 'x', '{}', '{}', '{}', '{}')"),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("joining", () => {
  it("assigned interviewers consent to join; other teammates can step in up to two", async () => {
    const s = await scheduled();
    await expect(asUser(db, s.interviewer, "select public.join_session($1, false)", [s.session])).rejects.toThrow(/consent/);
    await joinAsInterviewer(s.interviewer, s.session);
    await joinAsInterviewer(s.interviewer, s.session); // idempotent
    await joinAsInterviewer(s.admin, s.session); // not assigned, steps in
    const third = await addMember(db, s.org);
    await expect(joinAsInterviewer(third, s.session)).rejects.toThrow(/Two interviewers/);
    const outsider = await createWorkspace(db, "Globex", "Gus");
    await expect(joinAsInterviewer(outsider.user, s.session)).rejects.toThrow(/not found/);
    expect((await events(s.session)).filter((e) => e.type === "participant.joined")).toHaveLength(2);
  });

  it("the candidate joins anonymously with their link", async () => {
    const s = await scheduled();
    const hash = await link(s.admin, s.session); // a member who isn't in the room can send it too
    const preview = (await asAnon<{ org_name: string; candidate_name: string; link_state: string }>(
      db,
      "select * from public.candidate_link_preview($1)",
      [hash],
    )).rows[0];
    expect(preview).toMatchObject({ org_name: "Acme", candidate_name: "Cal Candidate", link_state: "valid" });

    const candidate = await createAnonUser(db);
    expect(await acceptLink(candidate, hash)).toBe(s.session);
    expect(await acceptLink(candidate, hash)).toBe(s.session); // twice: fine
    const intruder = await createAnonUser(db);
    await expect(acceptLink(intruder, hash)).rejects.toThrow(/expired or was already used/);
  });

  it("a new link moves the candidate to a new device", async () => {
    const s = await scheduled();
    const first = await createAnonUser(db);
    await acceptLink(first, await link(s.admin, s.session));
    const second = await createAnonUser(db);
    await acceptLink(second, await link(s.admin, s.session), "Cal (laptop)");
    const { rows } = await asAdmin<{ user_id: string; display_name: string }>(
      db,
      "select user_id, display_name from public.session_participants where session_id = $1 and role = 'candidate'",
      [s.session],
    );
    expect(rows).toEqual([{ user_id: second, display_name: "Cal (laptop)" }]);
    expect(await count(first, "select 1 from public.interview_sessions")).toBe(0);
  });

  it("the hiring team can't use a candidate link themselves", async () => {
    const s = await scheduled();
    const hash = await link(s.admin, s.session);
    await expect(acceptLink(s.interviewer, hash)).rejects.toThrow(/private window/);
  });

  it("rejects expired, revoked and replaced links, and links for ended interviews", async () => {
    const s = await scheduled();
    const old = await link(s.admin, s.session);
    const current = await link(s.admin, s.session); // replaces `old`
    const c = await createAnonUser(db);
    await expect(acceptLink(c, old)).rejects.toThrow(/expired or was already used/);
    await asAdmin(db, "update public.candidate_links set created_at = now() - interval '1 hour', expires_at = now() - interval '1 minute' where token_hash = $1", [current]);
    await expect(acceptLink(c, current)).rejects.toThrow(/expired/);
    const fresh = await link(s.admin, s.session);
    await asUser(db, s.admin, "select public.revoke_candidate_links($1)", [s.session]);
    await expect(acceptLink(c, fresh)).rejects.toThrow(/expired/);
    const last = await link(s.admin, s.session);
    await asUser(db, s.admin, "select public.end_session($1)", [s.session]);
    await expect(acceptLink(c, last)).rejects.toThrow(/expired|ended/);
    await expect(acceptLink(c, newToken().hash)).rejects.toThrow(/isn't valid/);
  });

  it("candidates and strangers can't create links", async () => {
    const r = await running();
    const { hash } = newToken();
    await expect(asUser(db, r.candidate, "select public.create_candidate_link($1, $2)", [r.session, hash])).rejects.toThrow(
      /hiring team/,
    );
  });

  it("link tokens are not readable by clients", async () => {
    const r = await running();
    await expect(asUser(db, r.admin, "select * from public.candidate_links")).rejects.toThrow(/permission denied/);
  });
});

describe("lifecycle", () => {
  it("only a joined interviewer starts, and only once the candidate is in", async () => {
    const s = await scheduled();
    await expect(asUser(db, s.interviewer, "select public.start_session($1)", [s.session])).rejects.toThrow(/not part/);
    await joinAsInterviewer(s.interviewer, s.session);
    await expect(asUser(db, s.interviewer, "select public.start_session($1)", [s.session])).rejects.toThrow(
      /hasn't joined/,
    );
    const candidate = await createAnonUser(db);
    await acceptLink(candidate, await link(s.interviewer, s.session));
    await expect(asUser(db, candidate, "select public.start_session($1)", [s.session])).rejects.toThrow(/Only the interviewer/);
    await asUser(db, s.interviewer, "select public.start_session($1)", [s.session]);
    await expect(
      asUser(db, candidate, "select public.change_session_phase($1, 'estimation')", [s.session]),
    ).rejects.toThrow(/Only the interviewer/);
    await asUser(db, s.interviewer, "select public.change_session_phase($1, 'estimation')", [s.session]);
    expect((await sessionRow(s.session)).phase).toBe("estimation");
  });

  it("ending: the team cancels from the lobby, interviewers complete, the candidate ends early", async () => {
    const s = await scheduled();
    const candidate = await createAnonUser(db);
    await acceptLink(candidate, await link(s.admin, s.session));
    await expect(asUser(db, candidate, "select public.end_session($1)", [s.session])).rejects.toThrow(/hiring team/);
    expect((await asUser<{ r: string }>(db, s.admin, "select public.end_session($1) as r", [s.session])).rows[0].r).toBe(
      "cancelled",
    );

    const r1 = await running();
    expect((await asUser<{ r: string }>(db, r1.candidate, "select public.end_session($1) as r", [r1.session])).rows[0].r).toBe(
      "ended_early",
    );
    const r2 = await running();
    await expect(asUser(db, r2.admin, "select public.end_session($1)", [r2.session])).rejects.toThrow(/Join the interview/);
    expect((await asUser<{ r: string }>(db, r2.interviewer, "select public.end_session($1) as r", [r2.session])).rows[0].r).toBe(
      "completed",
    );
    expect((await asUser<{ r: string }>(db, r2.interviewer, "select public.end_session($1) as r", [r2.session])).rows[0].r).toBe(
      "completed",
    );
  });
});

describe("record_event permission matrix", () => {
  it("chat: anyone in the room; probes: interviewers; notes: the candidate", async () => {
    const r = await running();
    expect((await record(r.candidate, r.session, "chat.message", { text: "hi" })).rows[0].seq).toBeGreaterThan(0);
    await expect(record(r.candidate, r.session, "probe.asked", { text: "?" })).rejects.toThrow(/Only interviewers/);
    await record(r.interviewer, r.session, "probe.asked", { text: "How do you shard?" });
    await expect(record(r.interviewer, r.session, "notes.updated", { text: "x" })).rejects.toThrow(/Only the candidate/);
    await record(r.candidate, r.session, "notes.updated", { text: "QPS 10k" });
    expect((await record(r.candidate, r.session, "notes.updated", { text: "QPS 10k" })).rows[0].seq).toBeNull();
  });

  it("board: anyone; merges by version and ignores stale deltas", async () => {
    const r = await running();
    const el = (version: number) => ({ id: "a", type: "rectangle", version, versionNonce: 1 });
    await record(r.candidate, r.session, "board.updated", { elements: [el(2)] });
    expect((await record(r.interviewer, r.session, "board.updated", { elements: [el(1)] })).rows[0].seq).toBeNull();
    await expect(
      record(r.candidate, r.session, "board.updated", { elements: [{ id: "i", type: "image", version: 1, versionNonce: 1 }] }),
    ).rejects.toThrow(/Invalid board element/);
  });

  it("workspace members who aren't in the room can't record", async () => {
    const r = await running();
    await expect(record(r.admin, r.session, "chat.message", { text: "hi" })).rejects.toThrow(/not part of this session/);
  });

  it("rejects system-only and unknown event types", async () => {
    const r = await running();
    await expect(record(r.interviewer, r.session, "session.ended", {})).rejects.toThrow(/system-only/);
  });
});

describe("row-level security", () => {
  it("other workspaces and outsiders see nothing", async () => {
    const r = await running();
    const other = await createWorkspace(db, "Globex", "Gus");
    const anon = await createAnonUser(db);
    for (const user of [other.user, anon]) {
      expect(await count(user, "select 1 from public.interview_sessions")).toBe(0);
      expect(await count(user, "select 1 from public.session_events")).toBe(0);
      expect(await count(user, "select 1 from public.candidates")).toBe(0);
      expect(await count(user, "select 1 from public.organizations where id = $1", [r.org])).toBe(0);
    }
    await expect(verify(other.user, r.session)).rejects.toThrow(/not part/);
  });

  it("the whole hiring team sees the interview; the candidate sees only the room", async () => {
    const r = await running();
    await record(r.interviewer, r.session, "interviewer_note.updated", { text: "Weak on sharding" });
    // Admin isn't in the room but is in the workspace.
    expect(await count(r.admin, "select 1 from public.interview_sessions")).toBe(1);
    expect(await count(r.admin, "select 1 from public.session_events where visibility = 'interviewers'")).toBe(1);
    // The candidate: their session, but no private events, candidate records or workspace.
    expect(await count(r.candidate, "select 1 from public.interview_sessions")).toBe(1);
    expect(await count(r.candidate, "select 1 from public.session_events where visibility = 'interviewers'")).toBe(0);
    expect(await count(r.candidate, "select 1 from public.candidates")).toBe(0);
    expect(await count(r.candidate, "select 1 from public.org_members")).toBe(0);
    // …but they may read the company's name.
    expect((await asUser<{ name: string }>(db, r.candidate, "select name from public.organizations")).rows).toEqual([{ name: "Acme" }]);
    // Private notes: only their author, not even the admin.
    expect(await count(r.interviewer, "select 1 from public.session_interviewer_notes")).toBe(1);
    expect(await count(r.admin, "select 1 from public.session_interviewer_notes")).toBe(0);
    expect(await count(r.candidate, "select 1 from public.session_interviewer_notes")).toBe(0);
  });

  it("clients can't write session tables directly", async () => {
    const r = await running();
    await expect(
      asUser(db, r.interviewer, "update public.interview_sessions set status = 'completed' where id = $1", [r.session]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, r.admin, "select public.append_session_event($1, null, 'system', 'chat.message', '{}')", [r.session]),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("realtime authorisation", () => {
  const canUse = async (user: string, topic: string, send: boolean) =>
    (await asUser<{ ok: boolean }>(db, user, "select public.realtime_topic_allowed($1, $2) as ok", [topic, send])).rows[0]
      .ok;

  it("routes topics by role and session state", async () => {
    const r = await running();
    const main = `session:${r.session}`;
    const priv = `session:${r.session}:interviewers`;
    expect(await canUse(r.candidate, main, true)).toBe(true);
    expect(await canUse(r.candidate, priv, false)).toBe(false);
    expect(await canUse(r.interviewer, priv, false)).toBe(true);
    expect(await canUse(r.interviewer, priv, true)).toBe(false);
    expect(await canUse(r.admin, main, false)).toBe(false); // not in the room
    await asUser(db, r.interviewer, "select public.end_session($1)", [r.session]);
    expect(await canUse(r.candidate, main, true)).toBe(false);
  });
});

describe("audit log integrity", () => {
  it("verifies an untouched chain, for the room and the team", async () => {
    const r = await running();
    await record(r.candidate, r.session, "notes.updated", { text: "users: 50M" });
    const result = await verify(r.admin, r.session);
    expect(result.ok).toBe(true);
    expect(Number(result.event_count)).toBe((await events(r.session)).length);
    expect((await verify(r.candidate, r.session)).ok).toBe(true);
  });

  it("detects a rewritten payload", async () => {
    const r = await running();
    await record(r.candidate, r.session, "chat.message", { text: "I'd use Kafka" });
    await asAdmin(db, "alter table public.session_events disable trigger session_events_no_update");
    await asAdmin(
      db,
      `update public.session_events set payload = '{"text":"I''d use a queue"}' where session_id = $1 and type = 'chat.message'`,
      [r.session],
    );
    expect((await verify(r.interviewer, r.session)).ok).toBe(false);
  });

  it("rejects updates and truncation even from the owner", async () => {
    const r = await running();
    await expect(asAdmin(db, "update public.session_events set payload = '{}' where session_id = $1", [r.session])).rejects.toThrow(
      /append-only/,
    );
    await expect(asAdmin(db, "truncate public.session_events")).rejects.toThrow(/append-only/);
  });
});

describe("scorecards", () => {
  const save = (user: string, session: string, scores: unknown, submit: boolean, rec: string | null = "yes", summary = "Solid") =>
    asUser(db, user, "select public.save_evaluation($1, $2, $3, $4, $5)", [session, scores, rec, summary, submit]);

  it("interviewers only; drafts during, submit after, then immutable", async () => {
    const r = await running();
    await expect(save(r.candidate, r.session, {}, false, null)).rejects.toThrow(/Only interviewers/);
    await save(r.interviewer, r.session, { requirements: { score: 3, evidence: "asked about scale" } }, false);
    await expect(save(r.interviewer, r.session, { requirements: { score: 3 } }, true)).rejects.toThrow(/once the interview has ended/);
    await asUser(db, r.interviewer, "select public.end_session($1)", [r.session]);
    await save(r.interviewer, r.session, { requirements: { score: 3 }, communication: { score: 4 } }, true);
    await expect(save(r.interviewer, r.session, { requirements: { score: 1 } }, false)).rejects.toThrow(/already submitted/);
    await expect(
      asAdmin(db, "update public.session_evaluations set summary = 'edited' where session_id = $1", [r.session]),
    ).rejects.toThrow(/can't be changed/);
  });

  it("validates aspects, scores and required fields", async () => {
    const r = await running();
    await asUser(db, r.interviewer, "select public.end_session($1)", [r.session]);
    await expect(save(r.interviewer, r.session, { vibes: { score: 3 } }, false)).rejects.toThrow(/Invalid scores/);
    await expect(save(r.interviewer, r.session, { requirements: { score: 5 } }, false)).rejects.toThrow(/Invalid scores/);
    await expect(save(r.interviewer, r.session, {}, true)).rejects.toThrow(/at least one aspect/);
    await expect(save(r.interviewer, r.session, { requirements: { score: 2 } }, true, null)).rejects.toThrow(/recommendation/);
  });

  it("are released to the team without anchoring, and never to the candidate", async () => {
    const r = await running();
    await joinAsInterviewer(r.admin, r.session); // a second interviewer
    await asUser(db, r.interviewer, "select public.end_session($1)", [r.session]);
    await save(r.interviewer, r.session, { requirements: { score: 3 } }, true);

    const watcher = await addMember(db, r.org); // teammate who wasn't in the interview
    expect(await count(watcher, "select 1 from public.session_evaluations")).toBe(1);
    expect(await count(r.admin, "select 1 from public.session_evaluations")).toBe(0); // hasn't submitted yet
    expect(await count(r.candidate, "select 1 from public.session_evaluations")).toBe(0);

    await save(r.admin, r.session, { requirements: { score: 2 } }, true, "no", "Mixed");
    expect(await count(r.admin, "select 1 from public.session_evaluations")).toBe(2);
    expect(await count(r.candidate, "select 1 from public.session_evaluations")).toBe(0);
  });
});

describe("AI assessment", () => {
  const begin = (session: string, by: string) => asService(db, "select public.begin_ai_assessment($1, $2)", [session, by]);
  const complete = (session: string, scores: unknown = { requirements: { score: 3, evidence: "Asked about scale" } }) =>
    asService(
      db,
      "select public.complete_ai_assessment($1, 'claude-opus-5-5', $2, 'yes', 'Good', array['clear'], array['vague on caching'])",
      [session, scores],
    );

  it("only the server can write it, after the interview, at the team's request", async () => {
    const r = await running();
    await expect(begin(r.session, r.admin)).rejects.toThrow(/once the interview has ended/);
    await asUser(db, r.interviewer, "select public.end_session($1)", [r.session]);
    await expect(begin(r.session, r.candidate)).rejects.toThrow(/hiring team/);
    await expect(asUser(db, r.admin, "select public.begin_ai_assessment($1, $2)", [r.session, r.admin])).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asUser(db, r.admin, "select public.complete_ai_assessment($1, 'x', '{}', 'yes', '', '{}', '{}')", [r.session]),
    ).rejects.toThrow(/permission denied/);

    await begin(r.session, r.admin);
    await expect(begin(r.session, r.admin)).rejects.toThrow(/already being generated/);
    await expect(complete(r.session, { vibes: { score: 3 } })).rejects.toThrow(/Invalid scores/);
    await complete(r.session);
    await expect(begin(r.session, r.admin)).rejects.toThrow(/already has/);
    const last = (await events(r.session)).at(-1)!;
    expect(last).toMatchObject({ type: "ai_assessment.completed", actor_role: "system", visibility: "interviewers" });
    expect((await verify(r.admin, r.session)).ok).toBe(true);
  });

  it("a failed run can be retried", async () => {
    const r = await running();
    await asUser(db, r.interviewer, "select public.end_session($1)", [r.session]);
    await begin(r.session, r.admin);
    await asService(db, "select public.fail_ai_assessment($1, 'timeout')", [r.session]);
    await begin(r.session, r.admin);
    await complete(r.session);
  });

  it("is released like scorecards: not to the candidate, not before you submit yours", async () => {
    const r = await running();
    await asUser(db, r.interviewer, "select public.end_session($1)", [r.session]);
    await begin(r.session, r.admin);
    await complete(r.session);
    expect(await count(r.admin, "select 1 from public.session_ai_assessments")).toBe(1);
    expect(await count(r.interviewer, "select 1 from public.session_ai_assessments")).toBe(0);
    expect(await count(r.candidate, "select 1 from public.session_ai_assessments")).toBe(0);
    await asUser(db, r.interviewer, "select public.save_evaluation($1, $2, 'yes', 'ok', true)", [
      r.session,
      { requirements: { score: 3 } },
    ]);
    expect(await count(r.interviewer, "select 1 from public.session_ai_assessments")).toBe(1);
  });
});

describe("account deletion", () => {
  it("an interviewer deleting their account is anonymised; the log stays verifiable", async () => {
    const r = await running();
    await asUser(db, r.interviewer, "select public.delete_my_account()");
    const { rows } = await asAdmin<{ display_name: string; user_id: string | null }>(
      db,
      "select display_name, user_id from public.session_participants where session_id = $1 and role = 'interviewer'",
      [r.session],
    );
    expect(rows).toEqual([{ display_name: "Deleted user", user_id: null }]);
    expect((await verify(r.admin, r.session)).ok).toBe(true);
  });

  it("the last admin must hand over; the last person takes the workspace with them", async () => {
    const r = await running();
    await expect(asUser(db, r.admin, "select public.delete_my_account()")).rejects.toThrow(/only admin/);
    await asUser(db, r.interviewer, "select public.delete_my_account()");
    await asUser(db, r.admin, "select public.delete_my_account()");
    expect((await asAdmin(db, "select 1 from public.organizations")).rows).toHaveLength(0);
    expect((await asAdmin(db, "select 1 from public.interview_sessions")).rows).toHaveLength(0);
  });
});
