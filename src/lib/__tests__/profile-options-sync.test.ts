import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DOMAINS, LIMITS, SENIORITY_LEVELS, TARGET_ROLES, WEAK_AREAS, values } from "../profile-options";

const dir = join(process.cwd(), "supabase", "migrations");
const sql = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(dir, f), "utf8"))
  .join("\n");

/** Pull the quoted values out of the CHECK constraint that follows `marker`. */
function listAfter(marker: RegExp) {
  const match = marker.exec(sql);
  if (!match) throw new Error(`marker ${marker} not found in migrations`);
  const rest = sql.slice(match.index + match[0].length);
  // The list ends at the first closing bracket/paren after the opening one.
  const end = rest.search(/[\])]/);
  return [...rest.slice(0, end).matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]).sort();
}

describe("profile options match the database constraints", () => {
  it("target roles", () => {
    expect(listAfter(/target_role text check \(target_role in \(/)).toEqual([...values(TARGET_ROLES)].sort());
  });
  it("seniority", () => {
    expect(listAfter(/seniority text check \(seniority in \(/)).toEqual([...values(SENIORITY_LEVELS)].sort());
  });
  it("domains", () => {
    expect(listAfter(/and domains <@ array\[/)).toEqual([...values(DOMAINS)].sort());
  });
  it("weak areas", () => {
    expect(listAfter(/weak_areas <@ array\[/)).toEqual([...values(WEAK_AREAS)].sort());
  });
  it("limits", () => {
    expect(sql).toContain(`cardinality(domains) <= ${LIMITS.maxDomains}`);
    expect(sql).toContain(`cardinality(target_companies) <= ${LIMITS.maxCompanies}`);
    expect(sql).toContain(`text_items_valid(target_companies, ${LIMITS.companyNameMax})`);
    expect(sql).toContain(`years_experience between 0 and ${LIMITS.maxYearsExperience}`);
    expect(sql).toContain(`between 1 and ${LIMITS.fullNameMax})`);
  });
});
