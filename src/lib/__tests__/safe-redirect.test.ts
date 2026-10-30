import { describe, expect, it } from "vitest";
import { safeNextPath } from "../safe-redirect";

describe("safeNextPath", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/profile?tab=account", "/profile?tab=account"],
    ["/onboarding#step-2", "/onboarding#step-2"],
    ["/dashboard/../profile", "/profile"],
  ])("keeps same-origin path %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    [null],
    [undefined],
    [""],
    ["dashboard"],
    ["https://evil.com"],
    ["//evil.com"],
    ["///evil.com"],
    ["/\\evil.com"],
    ["/%2F%2Fevil.com"],
    ["%2F%2Fevil.com"],
    ["/%252F%252Fevil.com"],
    ["/%5Cevil.com"],
    ["javascript:alert(1)"],
    ["/dash\nboard"],
    ["/dash%0Aboard"],
    ["/login"],
    ["/login?next=/dashboard"],
    ["/auth/callback?code=x"],
    ["/%E0%A4%A"],
    ["/" + "a".repeat(600)],
  ])("rejects %s", (input) => {
    expect(safeNextPath(input as string | null | undefined)).toBe("/dashboard");
  });

  it("uses the provided fallback", () => {
    expect(safeNextPath("//evil.com", "/")).toBe("/");
  });

  it("does not block paths that merely start with the same letters", () => {
    expect(safeNextPath("/loginhelp")).toBe("/loginhelp");
    expect(safeNextPath("/authors")).toBe("/authors");
  });
});
