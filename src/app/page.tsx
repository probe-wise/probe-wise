import Link from "next/link";
import { Suspense } from "react";
import { WhiteboardSketch } from "@/components/whiteboard-sketch";
import { DOMAINS } from "@/lib/profile-options";
import { getSeatsRemaining } from "@/lib/seats";

const SEAT_CAP = 100;

const PHASES = [
  { title: "Clarify requirements", body: "Pin down users, scale and what's out of scope before drawing anything." },
  { title: "Estimate capacity", body: "Back-of-envelope traffic, storage and bandwidth, with the math shown." },
  { title: "Define the API and data model", body: "Endpoints, entities and the access patterns they have to serve." },
  { title: "Sketch the high-level design", body: "The main components and how a request moves through them." },
  { title: "Deep dive", body: "The interviewer picks the weakest part and keeps asking until it holds up." },
  { title: "Defend the trade-offs", body: "Consistency, cost, failure modes: why this design and not another." },
];

const LEVELS = [
  { level: "Mid-level", expectation: "A working design with sensible components, and help when you get stuck." },
  { level: "Senior", expectation: "You lead. Trade-offs and failure modes come up without being asked." },
  { level: "Staff and above", expectation: "Scope across teams and systems, migrations, and the cost of being wrong." },
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
          <h1>System design interviews that ask the next question.</h1>
          <p className="lede mt-5">
            Probewise runs a full system design round tailored to the role, level and domain you&apos;re interviewing
            for. Then it keeps probing your design, the way a real interviewer does.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/login" className="btn btn-primary">
              Claim a seat
            </Link>
            <a href="#how-it-works" className="btn btn-secondary">
              How a session works
            </a>
          </div>
          <p className="mt-4 text-sm text-ink-faint" aria-live="polite">
            <Suspense fallback={<>Early access is limited to {SEAT_CAP} candidates.</>}>
              <SeatLine />
            </Suspense>
          </p>
        </div>
        <WhiteboardSketch />
      </section>

      <section id="how-it-works" className="scroll-mt-8 border-t border-grid py-16">
        <div className="page">
          <h2>How a session runs</h2>
          <p className="muted measure mt-3">
            Every session follows the structure interviewers at most large tech companies use, so you practise the pacing
            as well as the content.
          </p>
          <ol className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {PHASES.map((phase, i) => (
              <li key={phase.title} className="grid grid-cols-[2rem_1fr] gap-x-3">
                <span className="text-lg font-semibold text-marker tabular-nums" aria-hidden="true">
                  {i + 1}
                </span>
                <div>
                  <h3>{phase.title}</h3>
                  <p className="muted mt-1">{phase.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t border-grid py-16">
        <div className="page grid gap-10 lg:grid-cols-[1fr_2fr]">
          <div>
            <h2>Problems from the domain you&apos;re hiring into</h2>
            <p className="muted mt-3">
              A payments team asks about idempotency. A streaming team asks about CDNs. Pick up to three domains and your
              problems come from there.
            </p>
          </div>
          <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {DOMAINS.map((d) => (
              <div key={d.value} className="border-l-2 border-grid pl-4">
                <dt className="font-semibold">{d.label}</dt>
                <dd className="mt-0.5 text-[0.95rem] text-ink-faint">{d.hint}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="border-t border-grid py-16">
        <div className="page">
          <h2>Calibrated to the level you&apos;re targeting</h2>
          <dl className="mt-8 grid gap-6 md:grid-cols-3">
            {LEVELS.map((l) => (
              <div key={l.level}>
                <dt className="font-semibold">{l.level}</dt>
                <dd className="muted mt-1">{l.expectation}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="border-t border-grid py-16">
        <div className="page flex flex-col items-start gap-5 md:flex-row md:items-center md:justify-between">
          <div className="measure">
            <h2>Start with a profile</h2>
            <p className="muted mt-2">
              Sign in with email, Google or GitHub, tell us the role and domain you&apos;re preparing for, and your first
              problem set is ready.
            </p>
          </div>
          <Link href="/login" className="btn btn-primary">
            Claim a seat
          </Link>
        </div>
      </section>
    </>
  );
}

async function SeatLine() {
  const left = await getSeatsRemaining();
  if (left === null) return <>Early access is limited to {SEAT_CAP} candidates.</>;
  if (left === 0) return <>All early-access seats are taken. Sign up to join the waitlist.</>;
  return <>{left === 1 ? "1 early-access seat left." : `${left} early-access seats left.`}</>;
}

async function AccountDeletedNotice({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  if (params.account !== "deleted") return null;
  return (
    <div className="page pt-6">
      <p className="notice notice-success" role="status">
        Your account and profile were deleted. Your seat has been released.
      </p>
    </div>
  );
}
