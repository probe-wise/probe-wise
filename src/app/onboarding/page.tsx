import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { completeOnboarding } from "@/app/actions/profile";
import { ProfileForm } from "@/components/profile-form";
import { requireMember } from "@/lib/dal";
import { toFormValues } from "@/lib/profile-form-values";
import { isoDate, shiftDays } from "@/lib/profile-schema";

export const metadata: Metadata = { title: "Set up your profile" };

export default function OnboardingPage() {
  return (
    <div className="page-narrow max-w-3xl! py-14">
      <h1 className="text-[2rem]!">Set up your interview profile</h1>
      <p className="lede mt-3 measure">
        This decides which problems you get and how hard the interviewer pushes. It takes about two minutes, and you can
        change it any time.
      </p>
      <div className="mt-10">
        <Suspense fallback={<div className="skeleton h-96 w-full" aria-hidden="true" />}>
          <OnboardingForm />
        </Suspense>
      </div>
    </div>
  );
}

async function OnboardingForm() {
  const { profile } = await requireMember("/onboarding", { requireOnboarded: false });
  // Already onboarded (back button, bookmark): editing happens on /profile.
  if (profile.onboarding_completed_at) redirect("/dashboard");
  return <ProfileForm mode="onboarding" initial={toFormValues(profile)} minInterviewDate={shiftDays(isoDate(new Date()), -1)} action={completeOnboarding} />;
}
