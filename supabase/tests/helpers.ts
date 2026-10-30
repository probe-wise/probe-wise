import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = join(__dirname, "..", "migrations");

/**
 * Minimal stand-in for the parts of Supabase the migrations rely on:
 * the anon/authenticated roles, auth.users and auth.uid().
 */
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

export async function createTestDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  return db;
}

let counter = 0;
export function newUserId() {
  counter += 1;
  return `00000000-0000-4000-8000-${counter.toString().padStart(12, "0")}`;
}

/** Insert an auth user (as the superuser, like Supabase Auth would). */
export async function createAuthUser(db: PGlite, id = newUserId(), email = `${id.slice(-4)}@example.com`) {
  await db.exec("reset role");
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
  return id;
}

/** Run a statement as an authenticated user (RLS and grants apply). */
export async function asUser<T = Record<string, unknown>>(db: PGlite, userId: string, sql: string, params: unknown[] = []) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec("reset role");
  }
}

export async function asAnon<T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await db.exec("set role anon");
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec("reset role");
  }
}

export async function asAdmin<T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []) {
  await db.exec("reset role");
  return db.query<T>(sql, params);
}

export async function claim(db: PGlite, userId: string) {
  const res = await asUser<{ claim_seat: string }>(db, userId, "select public.claim_seat()");
  return res.rows[0].claim_seat;
}

export async function setCap(db: PGlite, cap: number) {
  await asAdmin(db, "update public.app_config set seat_cap = $1", [cap]);
}
