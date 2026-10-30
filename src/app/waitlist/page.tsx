import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { checkForSeat } from "@/app/actions/profile";
import { DeleteAccountForm } from "@/components/delete-account-form";
import { SubmitButton } from "@/components/submit-button";
import { authErrorMessage } from "@/lib/auth-errors";
import { getMyProfile, requireViewer } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Waitlist" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function WaitlistPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="page-narrow py-14">
      <Suspense fallback={<div className="skeleton h-48 w-full" aria-hidden="true" />}>
        <WaitlistContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function WaitlistContent({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requireViewer("/waitlist");
  // Members don't belong here (e.g. a stale tab or a bookmarked URL).
  const profile = await getMyProfile();
  if (profile) redirect(profile.onboarding_completed_at ? "/dashboard" : "/onboarding");

  const params = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("waitlist_status");
  const status = !error && Array.isArray(data) ? data[0] : undefined;

  const seatCheckFailed = params.error === "seat_check_failed" || Boolean(error);
  const justChecked = params.checked === "1";

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-[2rem]!">
          {status ? "You're on the waitlist" : "Let's check for a seat"}
        </h1>
        {status ? (
          <p className="lede mt-4">
            All early-access seats are taken right now. You&apos;re{" "}
            <strong className="text-ink">number {status.queue_position}</strong> in line
            {status.total_waiting > 1 ? ` of ${status.total_waiting} people waiting` : ""}.
          </p>
        ) : (
          <p className="lede mt-4">
            You&apos;re signed in as <strong className="break-all text-ink">{viewer.email ?? "your account"}</strong>, but
            we haven&apos;t been able to assign you a seat or a place in line yet.
          </p>
        )}
      </div>

      {seatCheckFailed ? (
        <p className="notice notice-error" role="alert">
          {authErrorMessage("seat_check_failed")}
        </p>
      ) : justChecked && status ? (
        <p className="notice notice-info" role="status">
          Still full. Nothing changed since you last checked.
        </p>
      ) : null}

      {status ? (
        <div className="panel grid gap-3">
          <h2 className="text-[1.15rem]!">How seats open up</h2>
          <p className="muted">
            Seats free up when a member deletes their account or when we add more. People are admitted in the order they
            joined, so nobody behind you can take your place. When it&apos;s your turn, you get the seat the next time
            you sign in or check below.
          </p>
        </div>
      ) : null}

      <form action={checkForSeat}>
        <SubmitButton pendingLabel="Checking…">Check for a seat</SubmitButton>
      </form>

      {status ? (
        <div className="border-t border-grid pt-8">
          <h2 className="text-[1.15rem]!">Not interested any more?</h2>
          <p className="muted mt-2 mb-4">Leaving deletes your account and gives your place in line to the next person.</p>
          <DeleteAccountForm
            buttonLabel="Leave the waitlist"
            consequence="Your account will be deleted and you'll lose your place in line."
          />
        </div>
      ) : null}
    </div>
  );
}
