import { describe, expect, it } from "vitest";
import { authErrorCode, authErrorMessage, callbackErrorCode } from "../auth-errors";
import { configuredSiteUrl, enabledOAuthProviders } from "../env";
import { daysUntil, joinList } from "../profile-form-values";
import { isGuestOnlyPath, isProtectedPath, isSeatFreePath } from "../routes";

describe("route rules", () => {
  it.each(["/dashboard", "/dashboard/x", "/onboarding", "/profile", "/waitlist", "/problems", "/interview/abc"])("%s is protected", (p) => {
    expect(isProtectedPath(p)).toBe(true);
  });
  it.each(["/", "/login", "/auth/callback", "/dashboards", "/profiles", "/interviews"])("%s is not protected", (p) => {
    expect(isProtectedPath(p)).toBe(false);
  });
  it("interview rooms and invite links don't need a seat", () => {
    expect(isSeatFreePath("/interview/join/abc")).toBe(true);
    expect(isSeatFreePath("/interview/123?x=1")).toBe(true);
    expect(isSeatFreePath("/interview")).toBe(true);
    expect(isSeatFreePath("/interviews")).toBe(false);
    expect(isSeatFreePath("/dashboard")).toBe(false);
    expect(isSeatFreePath("/problems/payment-ledger")).toBe(false);
  });
  it("only /login is guest-only", () => {
    expect(isGuestOnlyPath("/login")).toBe(true);
    expect(isGuestOnlyPath("/loginhelp")).toBe(false);
    expect(isGuestOnlyPath("/dashboard")).toBe(false);
  });
});

describe("auth error mapping", () => {
  it("uses known Supabase error codes", () => {
    expect(authErrorCode({ code: "otp_expired" })).toBe("otp_expired");
  });
  it("maps HTTP 429 to the rate-limit message", () => {
    expect(authErrorCode({ status: 429, message: "slow down" })).toBe("over_request_rate_limit");
  });
  it("falls back to a generic message and never leaks raw errors", () => {
    expect(authErrorMessage({ message: "duplicate key value violates unique constraint" })).toBe(
      authErrorMessage("unknown"),
    );
    expect(authErrorMessage("made_up_code")).toBe(authErrorMessage("unknown"));
  });
  it("normalises OAuth callback errors", () => {
    expect(callbackErrorCode(new URLSearchParams("error=access_denied&error_description=x"))).toBe("access_denied");
    expect(callbackErrorCode(new URLSearchParams("error=server_error"))).toBe("unknown");
    expect(callbackErrorCode(new URLSearchParams("code=abc"))).toBeNull();
  });
});

describe("env parsing", () => {
  it("only enables known OAuth providers", () => {
    expect(enabledOAuthProviders(" GitHub , google,facebook,,")).toEqual(["google", "github"]);
    expect(enabledOAuthProviders("")).toEqual([]);
    expect(enabledOAuthProviders(undefined)).toEqual([]);
  });
  it("reduces the site URL to its origin and ignores junk", () => {
    const original = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "https://probewise.dev/some/path/";
    expect(configuredSiteUrl()).toBe("https://probewise.dev");
    process.env.NEXT_PUBLIC_SITE_URL = "not a url";
    expect(configuredSiteUrl()).toBeNull();
    process.env.NEXT_PUBLIC_SITE_URL = original;
  });
});

describe("display helpers", () => {
  it("counts days across month and DST boundaries", () => {
    expect(daysUntil("2026-11-02", "2026-10-30")).toBe(3);
    expect(daysUntil("2026-10-30", "2026-10-30")).toBe(0);
    expect(daysUntil("2026-10-29", "2026-10-30")).toBe(-1);
  });
  it("joins lists in plain English", () => {
    expect(joinList([])).toBe("");
    expect(joinList(["A"])).toBe("A");
    expect(joinList(["A", "B"])).toBe("A and B");
    expect(joinList(["A", "B", "C"])).toBe("A, B and C");
  });
});
