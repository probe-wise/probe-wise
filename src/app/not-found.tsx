import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page-narrow py-20">
      <p className="hand text-2xl text-probe">that page doesn&apos;t exist. what did you expect to find?</p>
      <h1 className="mt-4 text-[2rem]!">Page not found</h1>
      <p className="lede mt-4">The link may be old or mistyped.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/" className="btn btn-primary">
          Go to the home page
        </Link>
        <Link href="/dashboard" className="btn btn-secondary">
          Open your dashboard
        </Link>
      </div>
    </div>
  );
}
