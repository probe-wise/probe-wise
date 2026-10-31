import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SENIORITY_LEVELS, values } from "../profile-options";

const dir = join(process.cwd(), "supabase", "migrations");
const sql = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(dir, f), "utf8"))
  .join("\n");

/** Quoted values in the CHECK list after the last occurrence of `marker` (the current definition). */
function listAfter(marker: string) {
  const start = sql.lastIndexOf(marker);
  if (start < 0) throw new Error(`marker ${marker} not found in migrations`);
  const rest = sql.slice(start + marker.length);
  return [...rest.slice(0, rest.search(/[\])]/)).matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]).sort();
}

describe("option lists match the database constraints", () => {
  it("candidate seniority", () => {
    expect(listAfter("seniority text check (seniority in (")).toEqual([...values(SENIORITY_LEVELS)].sort());
  });
});
