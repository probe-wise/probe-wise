import type { Metadata } from "next";
import { Suspense } from "react";
import { renameWorkspace } from "@/app/actions/org";
import { MemberActions, RevokeInviteButton } from "@/components/workspace/member-actions";
import { TeamInviteForm } from "@/components/workspace/team-invite-form";
import { CalendarProviderForm } from "@/components/workspace/calendar-settings";
import { TextFieldForm } from "@/components/workspace/text-field-form";
import { isGoogleCalendarConfigured } from "@/lib/calendar/google";
import { isEmailConfigured } from "@/lib/email";
import { requireMember } from "@/lib/dal";
import { orgRoleLabel } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Team" };

const date = (iso: string) => new Date(iso).toLocaleDateString([], { dateStyle: "medium" });

export default function TeamPage() {
  return (
    <div className="page-narrow max-w-3xl! grid gap-10 py-12">
      <Suspense fallback={<div className="skeleton h-96" aria-hidden="true" />}>
        <Team />
      </Suspense>
    </div>
  );
}

async function Team() {
  const { org, member: me } = await requireMember("/team");
  const isAdmin = me.role === "admin";
  const supabase = await createClient();
  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase.from("org_members").select("*").eq("org_id", org.id).order("joined_at"),
    isAdmin
      ? supabase
          .from("org_invites")
          .select("id, org_id, email, role, created_at, expires_at, accepted_at, revoked_at")
          .eq("org_id", org.id)
          .is("accepted_at", null)
          .is("revoked_at", null)
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  return (
    <>
      <header className="grid gap-2">
        <h1 className="text-[2.2rem]!">{org.name}</h1>
        <p className="lede">Everyone here can add candidates, schedule interviews and see submitted scorecards.</p>
      </header>

      <section aria-labelledby="members-h" className="grid gap-3">
        <h2 id="members-h" className="text-[1.3rem]!">
          People ({members?.length ?? 0})
        </h2>
        <ul className="grid gap-2">
          {(members ?? []).map((m) => (
            <li key={m.user_id} className="panel flex flex-wrap items-center justify-between gap-3 py-3!">
              <div className="grid">
                <span className="font-semibold">
                  {m.display_name}
                  {m.user_id === me.user_id ? " (you)" : ""}
                </span>
                <span className="faint">
                  {orgRoleLabel(m.role)} · {m.email ?? "no email"} · joined {date(m.joined_at)}
                </span>
              </div>
              {isAdmin && m.user_id !== me.user_id ? <MemberActions userId={m.user_id} role={m.role} name={m.display_name} /> : null}
            </li>
          ))}
        </ul>
      </section>

      {isAdmin ? (
        <>
          <section aria-labelledby="invite-h" className="grid gap-3">
            <h2 id="invite-h" className="text-[1.3rem]!">
              Invite a teammate
            </h2>
            <TeamInviteForm />
            {invites?.length ? (
              <div className="grid gap-2">
                <h3 className="label">Pending invites</h3>
                <ul className="grid gap-1.5">
                  {invites.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-grid py-1.5">
                      <span>
                        {i.email} <span className="faint">· {orgRoleLabel(i.role)} · expires {date(i.expires_at)}</span>
                      </span>
                      <RevokeInviteButton inviteId={i.id} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section aria-labelledby="cal-h" className="grid gap-3 border-t border-grid pt-8">
            <h2 id="cal-h" className="text-[1.3rem]!">
              Calendar invites
            </h2>
            <CalendarProviderForm
              current={org.calendar_provider}
              googleAvailable={isGoogleCalendarConfigured()}
              emailAvailable={isEmailConfigured()}
            />
            <p className="faint">
              Email {isEmailConfigured() ? "is set up: invites and candidate links can be emailed." : "isn't set up on this deployment: links are copied by hand."}
            </p>
          </section>

          <section aria-labelledby="ws-h" className="grid gap-3 border-t border-grid pt-8">
            <h2 id="ws-h" className="text-[1.3rem]!">
              Workspace name
            </h2>
            <TextFieldForm
              action={renameWorkspace}
              name="company"
              label="Company"
              defaultValue={org.name}
              maxLength={100}
              buttonLabel="Rename"
              hint="Candidates see this on their interview link."
            />
          </section>
        </>
      ) : (
        <p className="muted">Ask an admin to invite more people.</p>
      )}
    </>
  );
}
