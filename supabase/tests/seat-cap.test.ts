import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAdmin, asAnon, asUser, claim, createAuthUser, createTestDb, setCap } from "./helpers";

let db: PGlite;

beforeEach(async () => {
  db = await createTestDb();
});

const seatsRemaining = async () =>
  (await asAnon<{ seats_remaining: number }>(db, "select public.seats_remaining()")).rows[0].seats_remaining;

const profileCount = async () =>
  Number((await asAdmin<{ n: number }>(db, "select count(*) as n from public.profiles")).rows[0].n);

describe("claim_seat", () => {
  it("gives a seat to the first users and is idempotent", async () => {
    await setCap(db, 2);
    const a = await createAuthUser(db);
    expect(await claim(db, a)).toBe("member");
    expect(await claim(db, a)).toBe("member");
    expect(await profileCount()).toBe(1);
    expect(await seatsRemaining()).toBe(1);
  });

  it("copies the auth email onto the profile", async () => {
    const a = await createAuthUser(db, undefined, "ada@example.com");
    await claim(db, a);
    const { rows } = await asUser<{ email: string }>(db, a, "select email from public.profiles");
    expect(rows[0].email).toBe("ada@example.com");
  });

  it("waitlists users once the cap is reached and never exceeds it", async () => {
    await setCap(db, 2);
    const users = [];
    for (let i = 0; i < 5; i++) users.push(await createAuthUser(db));
    const results = [];
    for (const u of users) results.push(await claim(db, u));
    expect(results).toEqual(["member", "member", "waitlisted", "waitlisted", "waitlisted"]);
    expect(await profileCount()).toBe(2);
    expect(await seatsRemaining()).toBe(0);
    // Calling again while still full keeps them waitlisted without duplicates.
    expect(await claim(db, users[2])).toBe("waitlisted");
    const n = await asAdmin<{ n: number }>(db, "select count(*) as n from public.waitlist");
    expect(Number(n.rows[0].n)).toBe(3);
  });

  it("hands freed seats to the waitlist in join order, not to newcomers", async () => {
    await setCap(db, 1);
    const member = await createAuthUser(db);
    const first = await createAuthUser(db);
    const second = await createAuthUser(db);
    await claim(db, member);
    expect(await claim(db, first)).toBe("waitlisted");
    expect(await claim(db, second)).toBe("waitlisted");

    // Member deletes their account → one seat frees up.
    await asUser(db, member, "select public.delete_my_account()");
    expect(await profileCount()).toBe(0);

    // A brand-new user can't jump the queue.
    const newcomer = await createAuthUser(db);
    expect(await claim(db, newcomer)).toBe("waitlisted");
    // The second-in-line can't take it either.
    expect(await claim(db, second)).toBe("waitlisted");
    // The first-in-line gets it.
    expect(await claim(db, first)).toBe("member");
    expect(await profileCount()).toBe(1);
  });

  it("admits waitlisted users when the cap is raised", async () => {
    await setCap(db, 1);
    const a = await createAuthUser(db);
    const b = await createAuthUser(db);
    await claim(db, a);
    expect(await claim(db, b)).toBe("waitlisted");
    await setCap(db, 2);
    expect(await claim(db, b)).toBe("member");
    const w = await asAdmin<{ n: number }>(db, "select count(*) as n from public.waitlist");
    expect(Number(w.rows[0].n)).toBe(0);
  });

  it("handles a cap lowered below the current member count", async () => {
    await setCap(db, 3);
    for (let i = 0; i < 3; i++) await claim(db, await createAuthUser(db));
    await setCap(db, 1);
    expect(await seatsRemaining()).toBe(0);
    expect(await claim(db, await createAuthUser(db))).toBe("waitlisted");
  });

  it("rejects anonymous callers", async () => {
    await expect(asAnon(db, "select public.claim_seat()")).rejects.toThrow(/permission denied/);
  });
});

describe("waitlist_status", () => {
  it("reports the caller's position", async () => {
    await setCap(db, 0);
    const a = await createAuthUser(db);
    const b = await createAuthUser(db);
    await claim(db, a);
    await claim(db, b);
    const { rows } = await asUser<{ queue_position: number; total_waiting: number }>(
      db,
      b,
      "select * from public.waitlist_status()",
    );
    expect(rows[0]).toMatchObject({ queue_position: 2, total_waiting: 2 });
  });

  it("returns nothing for members", async () => {
    const a = await createAuthUser(db);
    await claim(db, a);
    const { rows } = await asUser(db, a, "select * from public.waitlist_status()");
    expect(rows).toHaveLength(0);
  });
});

describe("row-level security and grants", () => {
  it("only lets users read their own profile", async () => {
    const a = await createAuthUser(db);
    const b = await createAuthUser(db);
    await claim(db, a);
    await claim(db, b);
    const { rows } = await asUser<{ id: string }>(db, a, "select id from public.profiles");
    expect(rows.map((r) => r.id)).toEqual([a]);
  });

  it("silently ignores updates to someone else's profile", async () => {
    const a = await createAuthUser(db);
    const b = await createAuthUser(db);
    await claim(db, a);
    await claim(db, b);
    const res = await asUser(db, a, "update public.profiles set full_name = 'hacked' where id = $1", [b]);
    expect(res.affectedRows).toBe(0);
  });

  it("blocks direct inserts (seats only come from claim_seat)", async () => {
    const a = await createAuthUser(db);
    await expect(asUser(db, a, "insert into public.profiles (id) values ($1)", [a])).rejects.toThrow(
      /permission denied/,
    );
  });

  it("blocks editing read-only columns", async () => {
    const a = await createAuthUser(db);
    await claim(db, a);
    await expect(asUser(db, a, "update public.profiles set email = 'x@y.z'")).rejects.toThrow(/permission denied/);
    await expect(asUser(db, a, "update public.profiles set seat_claimed_at = now()")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("blocks deleting profiles directly", async () => {
    const a = await createAuthUser(db);
    await claim(db, a);
    await expect(asUser(db, a, "delete from public.profiles")).rejects.toThrow(/permission denied/);
  });

  it("hides app_config and waitlist writes from clients", async () => {
    const a = await createAuthUser(db);
    await expect(asUser(db, a, "select * from public.app_config")).rejects.toThrow(/permission denied/);
    await expect(asUser(db, a, "update public.app_config set seat_cap = 1000")).rejects.toThrow(/permission denied/);
    await expect(asUser(db, a, "insert into public.waitlist (user_id) values ($1)", [a])).rejects.toThrow(
      /permission denied/,
    );
    await expect(asAnon(db, "select * from public.profiles")).rejects.toThrow(/permission denied/);
  });
});

describe("profile constraints", () => {
  let a: string;
  beforeEach(async () => {
    a = await createAuthUser(db);
    await claim(db, a);
  });

  const update = (sql: string, params: unknown[] = []) => asUser(db, a, sql, params);

  it("accepts a complete onboarding", async () => {
    const res = await update(
      `update public.profiles set full_name = 'Ada', target_role = 'backend_engineer', seniority = 'senior',
       years_experience = 6, domains = '{fintech,ai_ml}', target_companies = '{Stripe}',
       weak_areas = '{caching}', onboarding_completed_at = now()`,
    );
    expect(res.affectedRows).toBe(1);
  });

  it("refuses to mark onboarding complete with missing fields", async () => {
    await expect(update("update public.profiles set full_name = 'Ada', onboarding_completed_at = now()")).rejects.toThrow(
      /onboarding_complete_requires_fields/,
    );
  });

  it("rejects unknown roles, domains and weak areas", async () => {
    await expect(update("update public.profiles set target_role = 'wizard'")).rejects.toThrow(/check constraint/);
    await expect(update("update public.profiles set domains = '{crypto}'")).rejects.toThrow(/check constraint/);
    await expect(update("update public.profiles set weak_areas = '{vibes}'")).rejects.toThrow(/check constraint/);
  });

  it("enforces list sizes and lengths", async () => {
    await expect(update("update public.profiles set domains = '{fintech,social,gaming,adtech}'")).rejects.toThrow(
      /check constraint/,
    );
    await expect(update("update public.profiles set target_companies = '{a,b,c,d,e,f}'")).rejects.toThrow(
      /check constraint/,
    );
    await expect(update("update public.profiles set target_companies = $1", [["x".repeat(61)]])).rejects.toThrow(
      /check constraint/,
    );
    await expect(update("update public.profiles set target_companies = $1", [["  "]])).rejects.toThrow(
      /check constraint/,
    );
    await expect(update("update public.profiles set years_experience = 51")).rejects.toThrow(/check constraint/);
    await expect(update("update public.profiles set full_name = '   '")).rejects.toThrow(/check constraint/);
  });

  it("bumps updated_at on change", async () => {
    const before = (await update("select updated_at from public.profiles")).rows[0] as { updated_at: Date };
    await new Promise((r) => setTimeout(r, 10));
    await update("update public.profiles set full_name = 'Ada'");
    const after = (await update("select updated_at from public.profiles")).rows[0] as { updated_at: Date };
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
  });
});

describe("account lifecycle", () => {
  it("syncs email changes into the profile and waitlist", async () => {
    await setCap(db, 1);
    const a = await createAuthUser(db, undefined, "old@example.com");
    const b = await createAuthUser(db, undefined, "b-old@example.com");
    await claim(db, a);
    await claim(db, b);
    await asAdmin(db, "update auth.users set email = 'new@example.com' where id = $1", [a]);
    await asAdmin(db, "update auth.users set email = 'b-new@example.com' where id = $1", [b]);
    const p = await asAdmin<{ email: string }>(db, "select email from public.profiles where id = $1", [a]);
    const w = await asAdmin<{ email: string }>(db, "select email from public.waitlist where user_id = $1", [b]);
    expect(p.rows[0].email).toBe("new@example.com");
    expect(w.rows[0].email).toBe("b-new@example.com");
  });

  it("delete_my_account removes the auth user and cascades", async () => {
    const a = await createAuthUser(db);
    await claim(db, a);
    await asUser(db, a, "select public.delete_my_account()");
    const u = await asAdmin<{ n: number }>(db, "select count(*) as n from auth.users where id = $1", [a]);
    expect(Number(u.rows[0].n)).toBe(0);
    expect(await profileCount()).toBe(0);
  });
});
