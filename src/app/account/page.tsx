import type { Metadata } from "next";
import { Suspense } from "react";
import { updateDisplayName } from "@/app/actions/org";
import { DeleteAccountForm } from "@/components/delete-account-form";
import { DisconnectCalendarButton } from "@/components/workspace/calendar-settings";
import { TextFieldForm } from "@/components/workspace/text-field-form";
import { isGoogleCalendarConfigured } from "@/lib/calendar/google";
import { getMembership, requireViewer } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { orgRoleLabel } from "@/lib/org";

export const metadata: Metadata = { title: "Account" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const CALENDAR_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Google Calendar connected. Interviews you schedule now go on your calendar." },
  denied: { ok: false, text: "Google Calendar wasn't connected: access was declined." },
  scope: { ok: false, text: "Calendar permission wasn't granted. Connect again and tick the calendar box." },
  unavailable: { ok: false, text: "Google Calendar isn't set up for this deployment yet." },
  failed: { ok: false, text: "Connecting Google Calendar failed. Please try again." },
};

export default function AccountPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="page-narrow max-w-3xl! py-14">
      <h1 className="text-[2rem]!">Your account</h1>
      <Suspense fallback={<div className="skeleton mt-10 h-64 w-full" aria-hidden="true" />}>
        <Account searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Account({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requireViewer("/account");
  const membership = await getMembership();
  const params = await searchParams;
  const message = typeof params.calendar === "string" ? CALENDAR_MESSAGES[params.calendar] : undefined;
  const connection = membership ? (await (await createClient()).rpc("my_calendar_connection")).data?.[0] : undefined;
  const consequence = membership
    ? "Your account will be removed. Interviews you took part in keep your scorecards, shown as “Deleted user”. If you're the last person in the workspace, it's deleted with all its candidates and interviews."
    : "Your account will be removed.";

  return (
    <div className="mt-10 grid gap-12">
      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="label">Signed in as</dt>
          <dd className="muted mt-1 break-all">{viewer.email ?? "Unknown email"}</dd>
        </div>
        {membership ? (
          <div>
            <dt className="label">Workspace</dt>
            <dd className="muted mt-1">
              {membership.org.name} · {orgRoleLabel(membership.member.role)}
            </dd>
          </div>
        ) : null}
      </dl>

      {membership ? (
        <TextFieldForm
          action={updateDisplayName}
          name="display_name"
          label="Your name"
          defaultValue={membership.member.display_name}
          maxLength={80}
          buttonLabel="Save"
          hint="Shown to candidates and teammates in new interviews."
        />
      ) : null}

      {message ? (
        <p className={`notice ${message.ok ? "notice-success" : "notice-error"}`} role="status">
          {message.text}
        </p>
      ) : null}

      {membership ? (
        <section className="grid gap-3" aria-labelledby="calendar-h">
          <h2 id="calendar-h" className="text-[1.2rem]!">
            Google Calendar
          </h2>
          {connection ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="muted">
                Connected{connection.account_email ? ` as ${connection.account_email}` : ""}. Interviews you schedule are added
                to your calendar, with a Meet link, and everyone is invited.
              </p>
              <DisconnectCalendarButton />
            </div>
          ) : isGoogleCalendarConfigured() ? (
            <div className="grid gap-2">
              <p className="muted">
                Connect your Google Calendar so interviews you schedule are created there, with a Meet link and invites to
                the interviewers and the candidate. Probewise only gets access to calendar events.
              </p>
              <div>
                {/* A plain link: the route redirects to Google's consent screen. */}
                <a href="/calendar/google/connect" className="btn btn-secondary">
                  Connect Google Calendar
                </a>
              </div>
            </div>
          ) : (
            <p className="muted">Google Calendar isn&apos;t set up for this deployment. Invites go out as .ics files instead, if email is set up.</p>
          )}
        </section>
      ) : null}

      <section className="panel grid gap-3 border-probe/40!" aria-labelledby="delete-h">
        <h2 id="delete-h" className="text-[1.2rem]!">
          Delete account
        </h2>
        <p className="muted">{consequence}</p>
        <div>
          <DeleteAccountForm buttonLabel="Delete account" consequence={consequence} />
        </div>
      </section>
    </div>
  );
}
