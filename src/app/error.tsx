"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="page-narrow py-20">
      <h1 className="text-[2rem]!">This page didn&apos;t load</h1>
      <p className="lede mt-4">
        Something failed on our side while loading it. Your profile and data are safe. Try again, and if it keeps
        happening, come back in a few minutes.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <button type="button" className="btn btn-primary" onClick={() => retry()}>
          Try again
        </button>
        <Link href="/" className="btn btn-secondary">
          Go to the home page
        </Link>
      </div>
    </div>
  );
}
