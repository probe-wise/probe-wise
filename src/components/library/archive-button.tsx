"use client";

import { useState, useTransition } from "react";
import type { LibraryState } from "@/app/actions/library";

/** A button that runs a library action and shows its error. */
export function ActionButton({
  run,
  label,
  pendingLabel,
  className = "btn btn-ghost",
}: {
  run: () => Promise<LibraryState>;
  label: string;
  pendingLabel: string;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await run();
            setError(res.status === "error" ? (res.message ?? "Something went wrong.") : null);
          })
        }
      >
        {pending ? pendingLabel : label}
      </button>
      {error ? (
        <span role="alert" className="field-error">
          {error}
        </span>
      ) : null}
    </span>
  );
}
