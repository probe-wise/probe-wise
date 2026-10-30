"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { sendEmailCode, verifyEmailCode, type EmailAuthState } from "@/app/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { configuredSiteUrl, type OAuthProvider } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";

const RESEND_COOLDOWN_S = 60;
const idle: EmailAuthState = { status: "idle" };

const PROVIDER_LABEL: Record<OAuthProvider, string> = { google: "Continue with Google", github: "Continue with GitHub" };

type Props = { next: string; initialError: string | null; providers: OAuthProvider[] };

export function LoginForm({ next, initialError, providers }: Props) {
  const [sendState, sendAction] = useActionState(sendEmailCode, idle);
  const [verifyState, verifyAction] = useActionState(verifyEmailCode, idle);
  // "Use a different email" dismisses the current send result (compared by identity,
  // so a fresh send shows the code step again).
  const [dismissed, setDismissed] = useState<EmailAuthState | null>(null);

  const codeStepActive =
    dismissed !== sendState &&
    (sendState.status === "sent" || (sendState.status === "error" && sendState.step === "code"));
  const email = sendState.status !== "idle" ? sendState.email : undefined;

  // Show the URL error (?error=…) only until the user does something.
  const urlError = sendState.status === "idle" && verifyState.status === "idle" ? initialError : null;

  return (
    <div className="grid gap-6">
      {urlError ? (
        <p className="notice notice-error" role="alert">
          {urlError}
        </p>
      ) : null}

      {codeStepActive && email ? (
        <CodeStep
          email={email}
          next={next}
          sendState={sendState}
          verifyState={verifyState}
          sendAction={sendAction}
          verifyAction={verifyAction}
          onChangeEmail={() => setDismissed(sendState)}
        />
      ) : (
        <EmailStep next={next} state={sendState} sendAction={sendAction} defaultEmail={email} />
      )}

      {providers.length > 0 && !codeStepActive ? (
        <>
          <div className="flex items-center gap-3 text-sm text-ink-faint" aria-hidden="true">
            <span className="h-px flex-1 bg-grid" />
            or
            <span className="h-px flex-1 bg-grid" />
          </div>
          <OAuthButtons providers={providers} next={next} />
        </>
      ) : null}
    </div>
  );
}

function EmailStep({
  next,
  state,
  sendAction,
  defaultEmail,
}: {
  next: string;
  state: EmailAuthState;
  sendAction: (fd: FormData) => void;
  defaultEmail?: string;
}) {
  const id = useId();
  // Controlled, because React resets uncontrolled forms after an action and an
  // error would otherwise wipe what the user typed.
  const [value, setValue] = useState(defaultEmail ?? "");
  const error = state.status === "error" && state.step === "email" ? state.message : null;
  return (
    <form action={sendAction} className="grid gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <div className="field">
        <label className="label" htmlFor={`${id}-email`}>
          Email
        </label>
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={254}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="input"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-email-error` : undefined}
        />
        {error ? (
          <p id={`${id}-email-error`} className="field-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <SubmitButton className="btn btn-primary btn-block" pendingLabel="Sending…">
        Email me a sign-in link
      </SubmitButton>
    </form>
  );
}

function CodeStep({
  email,
  next,
  sendState,
  verifyState,
  sendAction,
  verifyAction,
  onChangeEmail,
}: {
  email: string;
  next: string;
  sendState: EmailAuthState;
  verifyState: EmailAuthState;
  sendAction: (fd: FormData) => void;
  verifyAction: (fd: FormData) => void;
  onChangeEmail: () => void;
}) {
  const id = useId();
  const sentAt = sendState.status === "sent" ? sendState.sentAt : undefined;
  const resendError = sendState.status === "error" && sendState.step === "code" ? sendState.message : null;
  const verifyError =
    verifyState.status === "error" && verifyState.step === "code" && verifyState.email === email
      ? verifyState.message
      : null;

  return (
    <div className="grid gap-5">
      <div className="notice notice-info" role="status">
        <p>
          We sent a sign-in link and a one-time code to <strong className="break-all">{email}</strong>. Open the link on
          this device, or type the code below.
        </p>
        <p className="mt-1 text-sm text-ink-soft">It can take a minute. Check spam if it doesn&apos;t arrive.</p>
      </div>

      <form action={verifyAction} className="grid gap-4" noValidate>
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="next" value={next} />
        <div className="field">
          <label className="label" htmlFor={`${id}-code`}>
            One-time code
          </label>
          <input
            id={`${id}-code`}
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 -]*"
            maxLength={14}
            required
            className="input text-lg tracking-[0.3em] tabular-nums"
            aria-invalid={verifyError ? true : undefined}
            aria-describedby={verifyError ? `${id}-code-error` : undefined}
          />
          {verifyError ? (
            <p id={`${id}-code-error`} className="field-error" role="alert">
              {verifyError}
            </p>
          ) : null}
        </div>
        <SubmitButton className="btn btn-primary btn-block" pendingLabel="Checking…">
          Sign in with code
        </SubmitButton>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ResendForm email={email} next={next} sentAt={sentAt} sendAction={sendAction} />
        <button type="button" className="btn btn-ghost" onClick={onChangeEmail}>
          Use a different email
        </button>
      </div>
      {resendError ? (
        <p className="field-error" role="alert">
          {resendError}
        </p>
      ) : null}
    </div>
  );
}

function ResendForm({
  email,
  next,
  sentAt,
  sendAction,
}: {
  email: string;
  next: string;
  sentAt?: number;
  sendAction: (fd: FormData) => void;
}) {
  // Starts at sentAt (a full cooldown) and ticks every second; avoids reading the clock during render.
  const [now, setNow] = useState(() => sentAt ?? 0);
  const waitS = sentAt ? Math.max(0, Math.ceil((sentAt + RESEND_COOLDOWN_S * 1000 - now) / 1000)) : 0;

  useEffect(() => {
    if (!sentAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [sentAt]);

  return (
    <form action={sendAction}>
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="intent" value="resend" />
      <SubmitButton className="btn btn-ghost" pendingLabel="Sending…" disabled={waitS > 0}>
        {waitS > 0 ? `Resend in ${waitS}s` : "Resend email"}
      </SubmitButton>
    </form>
  );
}

function OAuthButtons({ providers, next }: { providers: OAuthProvider[]; next: string }) {
  const [pending, setPending] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(provider: OAuthProvider) {
    setPending(provider);
    setError(null);
    try {
      const origin = configuredSiteUrl() ?? window.location.origin;
      const { error: oauthError } = await createClient().auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
      });
      // On success the browser navigates away; we only get here on failure.
      if (oauthError) throw oauthError;
    } catch {
      setError("That sign-in method isn't available right now. Try email instead.");
      setPending(null);
    }
  }

  return (
    <div className="grid gap-3">
      {providers.map((p) => (
        <button
          key={p}
          type="button"
          className="btn btn-secondary btn-block"
          disabled={pending !== null}
          onClick={() => start(p)}
        >
          {pending === p ? "Redirecting…" : PROVIDER_LABEL[p]}
        </button>
      ))}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
