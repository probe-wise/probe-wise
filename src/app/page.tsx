import Link from "next/link";
import { Suspense } from "react";
import { WhiteboardSketch } from "@/components/whiteboard-sketch";

const STEPS = [
  { title: "Add the candidate", body: "Name, email, the role and level you're hiring for. That's the whole record." },
  { title: "Schedule the interview", body: "Pick a problem from the bank and one or two interviewers from your team." },
  { title: "Send the link when you start", body: "The candidate opens it, no account needed, and lands in a shared room." },
  { title: "Interview on a shared board", body: "A live whiteboard, notes and chat, plus a private guide with follow-ups for you." },
  { title: "Grade every aspect", body: "Each interviewer scores six phases and communication, with evidence, on their own." },
  { title: "Compare with an AI read", body: "Optionally, Claude grades the recorded interview against the same rubric." },
];

const PROMISES = [
  {
    title: "Independent scorecards",
    body: "You see your colleagues' scores, and the AI's, only after you've submitted yours. Submitted scorecards can't be edited.",
  },
  {
    title: "A record you can trust",
    body: "Every board edit, message and phase change goes into a tamper-evident log, so a review is based on what actually happened.",
  },
  {
    title: "Candidates see the interview, not the verdict",
    body: "The candidate gets the problem, the board and the chat. Scorecards, private notes and the interviewer guide stay with your team.",
  },
];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function Home({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <Suspense fallback={null}>
        <AccountDeletedNotice searchParams={searchParams} />
      </Suspense>

      <section className="page grid items-center gap-12 pb-16 pt-12 md:grid-cols-[1fr_1.05fr] md:pt-20">
        <div className="measure">
          <h1>System design interviews your hiring team can calibrate on.</h1>
          <p className="lede mt-5">
            Probewise gives your interviewers a shared room, a problem bank with private interviewer guides, and a
            rubric they grade independently. An AI assessment of the same recording is there when you want a second read.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/login" className="btn btn-primary">
              Create a workspace
            </Link>
            <a href="#how-it-works" className="btn btn-secondary">
              How it works
            </a>
          </div>
          <p className="mt-4 text-sm text-ink-faint">Got an interview link? Just open it. Candidates don&apos;t need an account.</p>
        </div>
        <WhiteboardSketch />
      </section>

      <section id="how-it-works" className="scroll-mt-8 border-t border-grid py-16">
        <div className="page">
          <h2>How it works</h2>
          <ol className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="grid grid-cols-[2rem_1fr] gap-x-3">
                <span className="text-lg font-semibold text-marker tabular-nums" aria-hidden="true">
                  {i + 1}
                </span>
                <div>
                  <h3>{step.title}</h3>
                  <p className="muted mt-1">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t border-grid py-16">
        <div className="page">
          <h2>Built for fair decisions</h2>
          <dl className="mt-8 grid gap-6 md:grid-cols-3">
            {PROMISES.map((p) => (
              <div key={p.title}>
                <dt className="font-semibold">{p.title}</dt>
                <dd className="muted mt-1">{p.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="border-t border-grid py-16">
        <div className="page flex flex-col items-start gap-5 md:flex-row md:items-center md:justify-between">
          <div className="measure">
            <h2>Set up your team</h2>
            <p className="muted mt-2">
              Sign in with your work email, name your workspace, and invite the people who interview with you.
            </p>
          </div>
          <Link href="/login" className="btn btn-primary">
            Create a workspace
          </Link>
        </div>
      </section>
    </>
  );
}

async function AccountDeletedNotice({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  if (params.account !== "deleted") return null;
  return (
    <div className="page pt-6">
      <p className="notice notice-success" role="status">
        Your account was deleted.
      </p>
    </div>
  );
}
