import { describe, expect, it } from "vitest";
import { cleanText, parseCompanies, parseProfileForm } from "../profile-schema";

const TODAY = "2026-10-30";

function form(overrides: Record<string, string | string[] | undefined> = {}) {
  const base: Record<string, string | string[]> = {
    full_name: "Ada Lovelace",
    years_experience: "4",
    target_role: "backend_engineer",
    seniority: "senior",
    domains: ["fintech"],
    target_companies: "",
    weak_areas: [],
    interview_date: "",
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...base, ...overrides })) {
    if (v === undefined) continue;
    for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item);
  }
  return fd;
}

const parse = (o: Record<string, string | string[] | undefined> = {}, existingDate: string | null = null) =>
  parseProfileForm(form(o), { today: TODAY, existingDate });

const errorsOf = (o: Record<string, string | string[] | undefined>, existingDate: string | null = null) => {
  const r = parse(o, existingDate);
  return r.success ? {} : r.fieldErrors;
};

describe("parseProfileForm", () => {
  it("accepts a minimal valid profile", () => {
    const r = parse();
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toMatchObject({ years_experience: 4, domains: ["fintech"], interview_date: null });
    }
  });

  it("reports every missing required field at once", () => {
    const e = errorsOf({ full_name: "", years_experience: "", target_role: undefined, seniority: undefined, domains: [] });
    expect(Object.keys(e).sort()).toEqual(["domains", "full_name", "seniority", "target_role", "years_experience"]);
  });

  it("treats a whitespace-only name as missing", () => {
    expect(errorsOf({ full_name: "   \t " }).full_name).toBeDefined();
  });

  it("strips zero-width and control characters from names", () => {
    const r = parse({ full_name: "Ada​  Love\u0007lace" });
    expect(r.success && r.data.full_name).toBe("Ada Love lace");
  });

  it("rejects names over the limit", () => {
    expect(errorsOf({ full_name: "a".repeat(101) }).full_name).toBeDefined();
  });

  it.each(["-1", "4.5", "abc", "100", "1e2"])("rejects years of experience %s", (y) => {
    expect(errorsOf({ years_experience: y }).years_experience).toBeDefined();
  });

  it("accepts 0 years of experience", () => {
    expect(parse({ years_experience: "0" }).success).toBe(true);
  });

  it("rejects values outside the option lists (tampered forms)", () => {
    const e = errorsOf({ target_role: "ceo", seniority: "god", domains: ["crypto"], weak_areas: ["vibes"] });
    expect(Object.keys(e).sort()).toEqual(["domains", "seniority", "target_role", "weak_areas"]);
  });

  it("caps domains at three and de-duplicates them first", () => {
    expect(errorsOf({ domains: ["fintech", "social", "gaming", "adtech"] }).domains).toBeDefined();
    const r = parse({ domains: ["fintech", "fintech", "social", "social"] });
    expect(r.success && r.data.domains).toEqual(["fintech", "social"]);
  });

  it("caps target companies at five", () => {
    expect(errorsOf({ target_companies: "a,b,c,d,e,f" }).target_companies).toBeDefined();
    expect(parse({ target_companies: "a,b,c,d,e" }).success).toBe(true);
  });

  it("rejects an over-long company name", () => {
    expect(errorsOf({ target_companies: "x".repeat(61) }).target_companies).toBeDefined();
  });

  describe("interview date", () => {
    it("accepts today, tomorrow and yesterday (time-zone slack)", () => {
      for (const d of ["2026-10-29", "2026-10-30", "2026-10-31"]) expect(parse({ interview_date: d }).success).toBe(true);
    });
    it("rejects a date that has clearly passed", () => {
      expect(errorsOf({ interview_date: "2026-10-01" }).interview_date).toMatch(/passed/);
    });
    it("rejects dates more than a year out", () => {
      expect(errorsOf({ interview_date: "2027-11-30" }).interview_date).toMatch(/year/);
    });
    it.each(["2026-02-30", "2026-13-01", "next week", "30/10/2026"])("rejects invalid date %s", (d) => {
      expect(errorsOf({ interview_date: d }).interview_date).toBeDefined();
    });
    it("lets a member re-save an already stored date that has since passed", () => {
      expect(parse({ interview_date: "2026-09-01" }, "2026-09-01").success).toBe(true);
    });
    it("treats an empty date as no date", () => {
      const r = parse({ interview_date: "  " });
      expect(r.success && r.data.interview_date).toBeNull();
    });
  });
});

describe("parseCompanies", () => {
  it("splits on commas, semicolons and newlines, trims and de-dupes case-insensitively", () => {
    expect(parseCompanies(" Stripe, google ;Stripe\n\nOpenAI ,, GOOGLE")).toEqual(["Stripe", "google", "OpenAI"]);
  });
  it("returns an empty list for empty input", () => {
    expect(parseCompanies("")).toEqual([]);
    expect(parseCompanies(null)).toEqual([]);
  });
});

describe("cleanText", () => {
  it("normalises unicode so visually equal names compare equal", () => {
    expect(cleanText("José")).toBe("José");
  });
});
