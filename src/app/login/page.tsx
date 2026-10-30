import type { Metadata } from "next";
import { Suspense } from "react";
import { SetupNotice } from "@/components/setup-notice";
import { authErrorMessage } from "@/lib/auth-errors";
import { enabledOAuthProviders, isSupabaseConfigured } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-redirect";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="page-narrow max-w-md! py-14">
      <h1 className="text-[2rem]!">Sign in to Probewise</h1>
      <p className="muted mt-3">New here? Signing in creates your account and claims an early-access seat if one is free.</p>
      <div className="mt-8">
        <Suspense fallback={<div className="skeleton h-40 w-full" aria-hidden="true" />}>
          <LoginContent searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

async function LoginContent({ searchParams }: { searchParams: SearchParams }) {
  if (!isSupabaseConfigured()) return <SetupNotice />;
  const params = await searchParams;
  const errorCode = first(params.error);
  return (
    <LoginForm
      next={safeNextPath(first(params.next))}
      initialError={errorCode ? authErrorMessage(errorCode) : null}
      providers={enabledOAuthProviders()}
    />
  );
}
