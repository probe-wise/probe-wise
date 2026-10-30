import type { Metadata } from "next";
import { Suspense } from "react";
import { updateProfile } from "@/app/actions/profile";
import { DeleteAccountForm } from "@/components/delete-account-form";
import { ProfileForm } from "@/components/profile-form";
import { requireMember } from "@/lib/dal";
import { toFormValues } from "@/lib/profile-form-values";
import { isoDate, shiftDays } from "@/lib/profile-schema";

export const metadata: Metadata = { title: "Profile" };

const dateFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" });

export default function ProfilePage() {
  return (
    <div className="page-narrow max-w-3xl! py-14">
      <h1 className="text-[2rem]!">Your profile</h1>
      <p className="muted mt-3">Changes apply to the next interview you start.</p>
      <Suspense fallback={<div className="skeleton mt-10 h-96 w-full" aria-hidden="true" />}>
        <ProfileContent />
      </Suspense>
    </div>
  );
}

async function ProfileContent() {
  const { viewer, profile } = await requireMember("/profile");
  return (
    <>
      <div className="mt-10">
        <ProfileForm mode="edit" initial={toFormValues(profile)} minInterviewDate={shiftDays(isoDate(new Date()), -1)} action={updateProfile} />
      </div>

      <section className="mt-16 grid gap-6 border-t border-grid pt-10" aria-labelledby="account-heading">
        <h2 id="account-heading" className="text-[1.3rem]!">
          Account
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="label">Signed in as</dt>
            <dd className="muted mt-1 break-all">{viewer.email ?? profile.email ?? "Unknown email"}</dd>
          </div>
          <div>
            <dt className="label">Early-access member since</dt>
            <dd className="muted mt-1">{dateFmt.format(new Date(profile.seat_claimed_at))}</dd>
          </div>
        </dl>
        <div className="panel grid gap-3 border-probe/40!">
          <h3>Delete account</h3>
          <p className="muted">
            Deletes your account and profile, and releases your seat to the next person on the waitlist.
          </p>
          <div>
            <DeleteAccountForm
              buttonLabel="Delete account"
              consequence="Your account, profile and seat will be removed."
            />
          </div>
        </div>
      </section>
    </>
  );
}
