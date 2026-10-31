import { describe, expect, it } from "vitest";
import { authErrorCode, authErrorMessage, callbackErrorCode } from "../auth-errors";
import { configuredSiteUrl, enabledOAuthProviders } from "../env";
import { isCandidatePath, isGuestOnlyPath, isProtectedPath, isWorkspaceFreePath } from "../routes";
import { cleanMultiline, cleanText } from "../text";

describe("route rules", () => {
  it.each(["/dashboard", "/onboarding", "/account", "/candidates/x", "/team", "/team/join/abc", "/problems", "/interview/abc"])(
    "%s is protected",
    (p) => {
      expect(isProtectedPath(p)).toBe(true);
    },
  );
  it.each(["/", "/login", "/auth/callback", "/join/abc", "/dashboards", "/interviews"])("%s is not protected", (p) => {
    expect(isProtectedPath(p)).toBe(false);
  });
  it("candidates (anonymous sessions) only get the interview room", () => {
    expect(isCandidatePath("/interview/123")).toBe(true);
    expect(isCandidatePath("/interview/123/review?x=1")).toBe(true);
    expect(isCandidatePath("/interviews")).toBe(false);
    expect(isCandidatePath("/dashboard")).toBe(false);
    expect(isCandidatePath("/candidates")).toBe(false);
  });
  it("team invites and rooms are reachable before you're in a workspace", () => {
    expect(isWorkspaceFreePath("/team/join/abc")).toBe(true);
    expect(isWorkspaceFreePath("/interview/123")).toBe(true);
    expect(isWorkspaceFreePath("/team")).toBe(false);
    expect(isWorkspaceFreePath("/dashboard?x=1")).toBe(false);
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

describe("text cleanup", () => {
  it("collapses whitespace and strips control characters on one line", () => {
    expect(cleanText("  Ada\t\nLovelace\u0000 ")).toBe("Ada Lovelace");
    expect(cleanText(null)).toBe("");
  });
  it("keeps line breaks in multi-line text", () => {
    expect(cleanMultiline("a\r\nb\n\n\n\nc\u0007")).toBe("a\nb\n\nc");
  });
});
