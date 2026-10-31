"use client";

import { useState, useTransition } from "react";
import { saveRubric, type LibraryState, type RubricDraft } from "@/app/actions/library";
import type { Rubric } from "@/lib/interview/rounds";

type Row = { id: number; key?: string; label: string; assesses: string; solid: string };

const toRows = (r: Rubric): Row[] =>
  r.aspects.map((a, i) => ({ id: i, key: a.key, label: a.label, assesses: a.assesses, solid: a.solid.join("\n") }));

/**
 * Admins write their own rubric for a round type (ADR 0011). Aspect keys come from the
 * names and stay fixed once saved, so renaming an aspect never orphans past scores.
 */
export function RubricEditor({ id, round, initial, readOnly = false }: { id: string | null; round: string; initial: Rubric; readOnly?: boolean }) {
  const [name, setName] = useState(initial.name);
  const [rows, setRows] = useState<Row[]>(() => toRows(initial));
  const [nextId, setNextId] = useState(initial.aspects.length);
  const [state, setState] = useState<LibraryState>({ status: "idle" });
  const [pending, start] = useTransition();

  const patch = (rid: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === rid ? { ...r, ...p } : r)));
  const move = (index: number, by: number) =>
    setRows((rs) => {
      const next = [...rs];
      const [row] = next.splice(index, 1);
      next.splice(index + by, 0, row);
      return next;
    });

  const save = () =>
    start(async () => {
      const draft: RubricDraft = { name, aspects: rows.map(({ key, label, assesses, solid }) => ({ key, label, assesses, solid })) };
      setState(await saveRubric(id, round, draft));
    });

  return (
    <div className="grid gap-6">
      <label className="field max-w-md">
        <span className="label">Rubric name</span>
        <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} disabled={readOnly} />
      </label>

      <ol className="grid gap-4">
        {rows.map((r, i) => (
          <li key={r.id} className="grid gap-3 rounded-lg border border-grid p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">Aspect {i + 1}</span>
              {!readOnly ? (
                <span className="flex gap-1">
                  <button type="button" className="btn btn-ghost text-[0.85rem]" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                    ↑
                  </button>
                  <button type="button" className="btn btn-ghost text-[0.85rem]" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                    ↓
                  </button>
                  <button type="button" className="btn btn-ghost text-[0.85rem]" disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}>
                    Remove
                  </button>
                </span>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
              <label className="field">
                <span className="label">Name</span>
                <input className="input" value={r.label} maxLength={60} onChange={(e) => patch(r.id, { label: e.target.value })} disabled={readOnly} />
              </label>
              <label className="field">
                <span className="label">What it assesses</span>
                <input className="input" value={r.assesses} maxLength={300} onChange={(e) => patch(r.id, { assesses: e.target.value })} disabled={readOnly} />
              </label>
            </div>
            <label className="field">
              <span className="label">What a 3 (&ldquo;solid&rdquo;) looks like</span>
              <textarea
                className="input min-h-20"
                value={r.solid}
                onChange={(e) => patch(r.id, { solid: e.target.value })}
                disabled={readOnly}
                placeholder="One signal per line"
              />
            </label>
          </li>
        ))}
      </ol>

      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={rows.length >= 12}
            onClick={() => {
              setRows((rs) => [...rs, { id: nextId, label: "", assesses: "", solid: "" }]);
              setNextId((n) => n + 1);
            }}
          >
            + Add aspect
          </button>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>
            {pending ? "Saving…" : id ? "Save changes" : "Create rubric"}
          </button>
        </div>
      ) : null}
      {state.status === "error" ? (
        <p role="alert" className="notice notice-error">
          {state.message}
        </p>
      ) : null}
      {state.status === "saved" ? (
        <p role="status" className="notice notice-success">
          Saved. Interviews already scheduled keep the version of the rubric they were scheduled with.
        </p>
      ) : null}
    </div>
  );
}
