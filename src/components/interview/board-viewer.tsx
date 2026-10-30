"use client";

import dynamic from "next/dynamic";
import type { BoardElement } from "@/lib/interview/board";

const Whiteboard = dynamic(() => import("@/components/interview/whiteboard"), {
  ssr: false,
  loading: () => <div className="skeleton h-full w-full" aria-label="Loading the board" />,
});

/** Read-only final board for the review page. */
export function BoardViewer({ elements }: { elements: BoardElement[] }) {
  return (
    <div className="h-[28rem] overflow-hidden rounded-xl border border-grid">
      <Whiteboard initialElements={elements} editable={false} />
    </div>
  );
}
