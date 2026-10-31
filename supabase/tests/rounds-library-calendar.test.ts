import { createHash, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { addCandidate, addMember, asAdmin, asService, asUser, createAnonUser, createTestDb, createWorkspace } from "./helpers";

let db: PGlite;

beforeEach(async () => {
  db = await createTestDb();
});

const PLANS = {
  system_design: { requirements: 5, estimation: 5, api_data_model: 7, high_level_design: 12, deep_dive: 12, tradeoffs: 4 },
  coding: { understand: 5, approach: 8, implement: 20, test: 7, complexity: 5 },
  behavioural: { intro: 5, experience: 20, scenarios: 10, candidate_questions: 10 },
};

const rubric = (keys: string[], name = "Custom") => ({ name, aspects: keys.map((key) => ({ key, label: key, assesses: "", solid: [] })) });
const CODING_RUBRIC = rubric(["problem_solving", "code_quality", "communication"], "Coding");

type Round = keyof typeof PLANS;

async function schedule(
  member: string,
  candidate: string,
  interviewers: string[],
  opts: { round?: Round; problemId?: string | null; rubric?: unknown; loop?: string | null; snapshot?: unknown } = {},
) {
  const round = opts.round ?? "coding";
  const { rows } = await asUser<{ id: string }>(
    db,
    member,
    `select public.create_session($1, $2, $3, $4, 1, 'A problem', $5, $6, $7, $8, null, $9) as id`,
    [
      candidate,
      round,
      opts.problemId ? `custom-${opts.problemId}` : "coding-lru-cache",
      opts.problemId ?? null,
      opts.snapshot ?? { summary: "s", prompt: "p", language: "python", starter_code: "def f():\n    pass\n" },
      PLANS[round],
      opts.rubric ?? CODING_RUBRIC,
      interviewers,
      opts.loop ?? null,
    ],
  );
  return rows[0].id;
}

const newToken = () => createHash("sha256").update(randomBytes(32).toString("base64url")).digest("hex");

/** A running interview of the given round type. */
async function running(round: Round = "coding", rubricOverride?: unknown) {
  const { user: admin, org } = await createWorkspace(db);
  const interviewer = await addMember(db, org);
  const cand = await addCandidate(db, admin, org);
  const session = await schedule(admin, cand, [interviewer], { round, rubric: rubricOverride ?? (round === "coding" ? CODING_RUBRIC : rubric(["communication"])) });
  await asUser(db, interviewer, "select public.join_session($1, true)", [session]);
  const hash = newToken();
  await asUser(db, interviewer, "select public.create_candidate_link($1, $2)", [session, hash]);
  const candidate = await createAnonUser(db);
  await asUser(db, candidate, "select public.accept_candidate_link($1, 'Cal', true)", [hash]);
  await asUser(db, interviewer, "select public.start_session($1)", [session]);
  return { admin, org, interviewer, candidate, session, cand };
}

const record = (user: string, session: string, type: string, payload: unknown) =>
  asUser<{ seq: number | null }>(db, user, "select public.record_event($1, $2, $3) as seq", [session, type, payload]);

const row = async (session: string) =>
  (await asAdmin<Record<string, unknown>>(db, "select * from public.interview_sessions where id = $1", [session])).rows[0];

describe("round types", () => {
  it("coding rounds start on their own first phase, with the starter code in the editor", async () => {
    const r = await running("coding");
    expect(await row(r.session)).toMatchObject({ round_type: "coding", phase: "understand", code_language: "python" });
    expect(String((await row(r.session)).code)).toContain("def f()");
    await expect(asUser(db, r.interviewer, "select public.change_session_phase($1, 'deep_dive')", [r.session])).rejects.toThrow(
      /Unknown phase/,
    );
    await asUser(db, r.interviewer, "select public.change_session_phase($1, 'implement')", [r.session]);
    expect((await row(r.session)).phase).toBe("implement");
  });

  it("the candidate edits code; interviewers can't; unchanged code isn't recorded again", async () => {
    const r = await running("coding");
    const payload = { text: "def f():\n    return 1\n", language: "python" };
    expect((await record(r.candidate, r.session, "code.updated", payload)).rows[0].seq).toBeGreaterThan(0);
    expect((await record(r.candidate, r.session, "code.updated", payload)).rows[0].seq).toBeNull();
    await expect(record(r.interviewer, r.session, "code.updated", payload)).rejects.toThrow(/Only the candidate/);
    await expect(record(r.candidate, r.session, "code.updated", { text: "x", language: "cobol" })).rejects.toThrow(/Unknown language/);
    await expect(record(r.candidate, r.session, "code.updated", { text: "x".repeat(100001), language: "go" })).rejects.toThrow(/100,000/);
    expect(await row(r.session)).toMatchObject({ code: payload.text });
  });

  it("only system design rounds have a whiteboard, only coding rounds an editor", async () => {
    const coding = await running("coding");
    await expect(
      record(coding.candidate, coding.session, "board.updated", { elements: [{ id: "a", type: "rectangle", version: 1, versionNonce: 1 }] }),
    ).rejects.toThrow(/whiteboard/);
    const talk = await running("behavioural");
    expect((await row(talk.session)).phase).toBe("intro");
    await expect(record(talk.candidate, talk.session, "code.updated", { text: "x", language: "go" })).rejects.toThrow(/code editor/);
    expect((await record(talk.candidate, talk.session, "chat.message", { text: "I led the migration" })).rows[0].seq).toBeGreaterThan(0);
  });

  it("validates the round type, phase plan and rubric when scheduling", async () => {
    const { user, org } = await createWorkspace(db);
    const cand = await addCandidate(db, user, org);
    await expect(
      asUser(db, user, "select public.create_session($1, 'trivia', 'x', null, 1, 't', '{}', '{}', $2, $3)", [cand, CODING_RUBRIC, [user]]),
    ).rejects.toThrow(/Unknown round type/);
    await expect(
      asUser(db, user, "select public.create_session($1, 'coding', 'x', null, 1, 't', '{}', $2, $3, $4)", [cand, PLANS.system_design, CODING_RUBRIC, [user]]),
    ).rejects.toThrow(/Invalid timings/);
    for (const bad of [
      { name: "", aspects: [{ key: "a", label: "A" }] },
      { name: "R", aspects: [] },
      { name: "R", aspects: [{ key: "Bad Key", label: "A" }] },
      { name: "R", aspects: [{ key: "a", label: "A" }, { key: "a", label: "B" }] },
    ]) {
      await expect(schedule(user, cand, [user], { rubric: bad })).rejects.toThrow(/Invalid rubric/);
    }
  });
});

describe("scorecards follow the session's rubric snapshot", () => {
  it("accepts the snapshot's aspects and rejects others", async () => {
    const r = await running("coding");
    await asUser(db, r.interviewer, "select public.end_session($1)", [r.session]);
    const save = (scores: unknown) =>
      asUser(db, r.interviewer, "select public.save_evaluation($1, $2, 'yes', 'ok', false)", [r.session, scores]);
    await save({ problem_solving: { score: 3 }, communication: { score: 4 } });
    await expect(save({ requirements: { score: 3 } })).rejects.toThrow(/Invalid scores/);
    await expect(save({ complexity: { score: 3 } })).rejects.toThrow(/Invalid scores/); // built-in coding aspect, not in this snapshot
  });

  it("the AI assessment is validated against the same snapshot", async () => {
    const r = await running("coding");
    await asUser(db, r.interviewer, "select public.end_session($1)", [r.session]);
    await asService(db, "select public.begin_ai_assessment($1, $2)", [r.session, r.admin]);
    await expect(
      asService(db, "select public.complete_ai_assessment($1, 'm', $2, 'yes', 's', '{}', '{}')", [r.session, { requirements: { score: 3 } }]),
    ).rejects.toThrow(/Invalid scores/);
    await asService(db, "select public.complete_ai_assessment($1, 'm', $2, 'yes', 's', '{}', '{}')", [r.session, { code_quality: { score: 2 } }]);
  });

  it("older sessions without a snapshot fall back to the built-in aspects", async () => {
    const r = await running("coding");
    await asAdmin(db, "update public.interview_sessions set rubric = null where id = $1", [r.session]);
    const { rows } = await asAdmin<{ a: string[] }>(db, "select public.session_aspects($1) as a", [r.session]);
    expect(rows[0].a).toEqual(["problem_solving", "code_quality", "correctness", "complexity", "communication"]);
  });
});

describe("custom problems", () => {
  const insert = (user: string, org: string, extra: Record<string, unknown> = {}) =>
    asUser<{ id: string; version: number }>(
      db,
      user,
      `insert into public.problems (org_id, round_type, title, prompt, language, starter_code, guide)
       values ($1, $2, 'Two sum', 'Find two numbers…', $3, $4, $5) returning id, version`,
      [org, extra.round_type ?? "coding", extra.language ?? "python", extra.starter_code ?? "", extra.guide ?? { probes: ["Why a hash map?"] }],
    );

  it("members write their workspace's problems; other workspaces and candidates can't read them", async () => {
    const r = await running("system_design", rubric(["communication"]));
    const { rows } = await insert(r.interviewer, r.org);
    const other = await createWorkspace(db, "Globex", "Gus");
    await expect(insert(other.user, r.org)).rejects.toThrow(/row-level security/);
    const count = async (u: string) => (await asUser(db, u, "select 1 from public.problems")).rows.length;
    expect(await count(r.admin)).toBe(1);
    expect(await count(other.user)).toBe(0);
    expect(await count(r.candidate)).toBe(0); // the guide is confidential
    await expect(asUser(db, r.admin, "delete from public.problems where id = $1", [rows[0].id])).rejects.toThrow(/permission denied/);
  });

  it("editing content bumps the version; the round type can't change", async () => {
    const { user, org } = await createWorkspace(db);
    const { rows } = await insert(user, org);
    await asUser(db, user, "update public.problems set prompt = 'Changed' where id = $1", [rows[0].id]);
    await asUser(db, user, "update public.problems set archived_at = now() where id = $1", [rows[0].id]);
    const after = (await asAdmin<{ version: number }>(db, "select version from public.problems where id = $1", [rows[0].id])).rows[0];
    expect(after.version).toBe(2);
    await expect(asUser(db, user, "update public.problems set round_type = 'behavioural' where id = $1", [rows[0].id])).rejects.toThrow(
      /permission denied/,
    );
  });

  it("only coding problems carry code", async () => {
    const { user, org } = await createWorkspace(db);
    await expect(insert(user, org, { round_type: "behavioural", language: "python" })).rejects.toThrow(/check constraint/);
  });

  it("scheduling checks the problem belongs to the workspace, matches the round and isn't archived", async () => {
    const { user, org } = await createWorkspace(db);
    const cand = await addCandidate(db, user, org);
    const { rows } = await insert(user, org);
    const id = rows[0].id;
    await schedule(user, cand, [user], { problemId: id });
    await expect(schedule(user, cand, [user], { problemId: id, round: "behavioural", rubric: rubric(["communication"]) })).rejects.toThrow(
      /isn't available/,
    );
    await asUser(db, user, "update public.problems set archived_at = now() where id = $1", [id]);
    await expect(schedule(user, cand, [user], { problemId: id })).rejects.toThrow(/isn't available/);
    const other = await createWorkspace(db, "Globex", "Gus");
    const theirs = (await insert(other.user, other.org)).rows[0].id;
    await expect(schedule(user, cand, [user], { problemId: theirs })).rejects.toThrow(/isn't available/);
  });
});

describe("custom rubrics", () => {
  const add = (user: string, org: string, round = "coding", name = "Ours") =>
    asUser<{ id: string }>(db, user, "insert into public.rubrics (org_id, round_type, name, aspects) values ($1, $2, $3, $4) returning id", [
      org,
      round,
      name,
      CODING_RUBRIC.aspects,
    ]);

  it("admins write rubrics; interviewers read them", async () => {
    const { user: admin, org } = await createWorkspace(db);
    const ivy = await addMember(db, org);
    await expect(add(ivy, org)).rejects.toThrow(/row-level security/);
    const { rows } = await add(admin, org);
    expect((await asUser(db, ivy, "select 1 from public.rubrics")).rows).toHaveLength(1);
    await asUser(db, ivy, "update public.rubrics set name = 'Hacked' where id = $1", [rows[0].id]);
    expect((await asAdmin<{ name: string }>(db, "select name from public.rubrics")).rows[0].name).toBe("Ours");
    await expect(
      asUser(db, admin, "insert into public.rubrics (org_id, round_type, name, aspects) values ($1, 'coding', 'Bad', '[]')", [org]),
    ).rejects.toThrow(/check constraint/);
  });

  it("one default per round type, set by admins; archived rubrics can't be the default", async () => {
    const { user: admin, org } = await createWorkspace(db);
    const ivy = await addMember(db, org);
    const a = (await add(admin, org, "coding", "A")).rows[0].id;
    const b = (await add(admin, org, "coding", "B")).rows[0].id;
    const design = (await add(admin, org, "system_design", "D")).rows[0].id;
    await expect(asUser(db, ivy, "select public.set_default_rubric('coding', $1)", [a])).rejects.toThrow(/Only admins/);
    await asUser(db, admin, "select public.set_default_rubric('coding', $1)", [a]);
    await asUser(db, admin, "select public.set_default_rubric('coding', $1)", [b]);
    await expect(asUser(db, admin, "select public.set_default_rubric('coding', $1)", [design])).rejects.toThrow(/isn't available/);
    const defaults = (await asAdmin<{ name: string }>(db, "select name from public.rubrics where is_default")).rows;
    expect(defaults).toEqual([{ name: "B" }]);
    await asUser(db, admin, "select public.set_default_rubric('coding', null)");
    expect((await asAdmin(db, "select 1 from public.rubrics where is_default")).rows).toHaveLength(0);
  });
});

describe("loops", () => {
  it("group a candidate's rounds; a loop must belong to the same workspace and candidate", async () => {
    const { user, org } = await createWorkspace(db);
    const cand = await addCandidate(db, user, org, "Cal One");
    const otherCand = await addCandidate(db, user, org, "Dee Two");
    const loop = (
      await asUser<{ id: string }>(db, user, "insert into public.interview_loops (org_id, candidate_id, name) values ($1, $2, 'Onsite') returning id", [
        org,
        cand,
      ])
    ).rows[0].id;
    const s1 = await schedule(user, cand, [user], { loop });
    const s2 = await schedule(user, cand, [user], { loop, round: "behavioural", rubric: rubric(["communication"]) });
    await expect(schedule(user, otherCand, [user], { loop })).rejects.toThrow(/isn't for this candidate/);
    const other = await createWorkspace(db, "Globex", "Gus");
    const theirCand = await addCandidate(db, other.user, other.org);
    await expect(
      asUser(db, other.user, "insert into public.interview_loops (org_id, candidate_id, name) values ($1, $2, 'x')", [other.org, cand]),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(db, user, "insert into public.interview_loops (org_id, candidate_id, name) values ($1, $2, 'x')", [org, theirCand]),
    ).rejects.toThrow(/row-level security/);
    const rounds = (await asAdmin<{ id: string }>(db, "select id from public.interview_sessions where loop_id = $1 order by created_at", [loop])).rows;
    expect(rounds.map((r) => r.id)).toEqual([s1, s2]);
  });
});

describe("calendar", () => {
  it("tokens are server-only; users only see whether they're connected", async () => {
    const { user, org } = await createWorkspace(db);
    await asService(db, "select public.save_calendar_connection($1, 'ada@gmail.com', 'v1.ciphertext')", [user]);
    await expect(asUser(db, user, "select * from public.calendar_connections")).rejects.toThrow(/permission denied/);
    await expect(asUser(db, user, "select * from public.get_calendar_connection($1)", [user])).rejects.toThrow(/permission denied/);
    await expect(asUser(db, user, "select public.save_calendar_connection($1, 'x', 'y')", [user])).rejects.toThrow(/permission denied/);
    const mine = (await asUser<{ provider: string; account_email: string }>(db, user, "select * from public.my_calendar_connection()")).rows;
    expect(mine).toMatchObject([{ provider: "google", account_email: "ada@gmail.com" }]);
    const ivy = await addMember(db, org);
    expect((await asUser(db, ivy, "select * from public.my_calendar_connection()")).rows).toHaveLength(0);
    await asService(db, "select public.delete_calendar_connection($1)", [user]);
    expect((await asUser(db, user, "select * from public.my_calendar_connection()")).rows).toHaveLength(0);
  });

  it("only admins change the workspace's calendar setting; the event and Meet link are set by the server", async () => {
    const r = await running("coding");
    await asUser(db, r.interviewer, "update public.organizations set calendar_provider = 'ics' where id = $1", [r.org]);
    expect((await asAdmin<{ p: string }>(db, "select calendar_provider as p from public.organizations")).rows[0].p).toBe("google");
    await asUser(db, r.admin, "update public.organizations set calendar_provider = 'ics' where id = $1", [r.org]);
    expect((await asAdmin<{ p: string }>(db, "select calendar_provider as p from public.organizations")).rows[0].p).toBe("ics");
    await expect(
      asUser(db, r.admin, "select public.set_session_calendar($1, $2, 'evt', 'https://meet.google.com/x')", [r.session, r.admin]),
    ).rejects.toThrow(/permission denied/);
    await asService(db, "select public.set_session_calendar($1, $2, 'evt', 'https://meet.google.com/abc')", [r.session, r.admin]);
    // The candidate sees the video link on their session.
    const { rows } = await asUser<{ meeting_url: string }>(db, r.candidate, "select meeting_url from public.interview_sessions");
    expect(rows[0].meeting_url).toBe("https://meet.google.com/abc");
    await expect(asService(db, "select public.set_session_calendar($1, null, null, 'http://evil')", [r.session])).rejects.toThrow(
      /check constraint/,
    );
  });
});
