import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CreateWorkspaceForm } from "@/components/workspace/create-workspace-form";
import { getMembership, requireViewer } from "@/lib/dal";

export const metadata: Metadata = { title: "Create your workspace" };

export default function OnboardingPage() {
  return (
    <div className="page-narrow max-w-xl! py-14">
      <h1 className="text-[2rem]!">Create your company&apos;s workspace</h1>
      <p className="lede mt-3 measure">
        Your candidates, interviews and scorecards live here. You&apos;ll be its admin and can invite your team next.
      </p>
      <p className="muted mt-3">
        Joining a team that already uses Probewise? Ask an admin for an invite instead of creating a second workspace.
      </p>
      <div className="mt-10">
        <Suspense fallback={<div className="skeleton h-64 w-full" aria-hidden="true" />}>
          <Onboarding />
        </Suspense>
      </div>
    </div>
  );
}

async function Onboarding() {
  const viewer = await requireViewer("/onboarding");
  if (viewer.anonymous) redirect("/login?next=/onboarding");
  if (await getMembership()) redirect("/dashboard");
  return <CreateWorkspaceForm defaultName={viewer.email?.split("@")[0] ?? ""} />;
}
