"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SaveStatus = "idle" | "saving" | "saved" | "error";

type Props = {
  id: string;
  label: string;
  initial: string;
  placeholder?: string;
  maxLength: number;
  /** Debounce before saving while typing. */
  delayMs?: number;
  save: (text: string) => Promise<unknown>;
  /** Lets the parent flush pending text before the session ends. */
  onReady?: (flush: () => Promise<void>) => void;
  className?: string;
};

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  error: "Couldn't save. Retrying…",
};

/** A textarea that saves itself: debounced while typing, immediately on blur and on flush. */
export function AutosaveTextarea({ id, label, initial, placeholder, maxLength, delayMs = 1500, save, onReady, className }: Props) {
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const lastSaved = useRef(initial);
  const latest = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const saveRef = useRef(save);
  const retryRef = useRef<() => void>(() => {});
  useEffect(() => {
    saveRef.current = save;
  });

  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (inflight.current) await inflight.current;
    const text = latest.current;
    if (text === lastSaved.current) return;
    setStatus("saving");
    inflight.current = (async () => {
      try {
        await saveRef.current(text);
        lastSaved.current = text;
        setStatus(latest.current === text ? "saved" : "saving");
      } catch (err) {
        console.error("autosave failed", err);
        setStatus("error");
        timer.current = setTimeout(() => retryRef.current(), 5000);
      } finally {
        inflight.current = null;
      }
    })();
    await inflight.current;
    // Typed more while saving: save again.
    if (latest.current !== lastSaved.current && !timer.current) retryRef.current();
  }, []);

  useEffect(() => {
    retryRef.current = () => void flush();
  }, [flush]);

  useEffect(() => {
    onReady?.(flush);
  }, [onReady, flush]);

  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      void flush();
    };
  }, [flush]);

  // Warn before closing the tab with unsaved text.
  useEffect(() => {
    if (status !== "saving" && status !== "error") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [status]);

  return (
    <div className={`flex min-h-0 flex-col gap-1.5 ${className ?? ""}`}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="label">
          {label}
        </label>
        <span className={`text-[0.8rem] ${status === "error" ? "text-probe" : "text-ink-faint"}`} aria-live="polite">
          {STATUS_TEXT[status]}
        </span>
      </div>
      <textarea
        id={id}
        className="input min-h-40 flex-1 resize-none font-mono text-[0.88rem] leading-relaxed"
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        spellCheck
        onChange={(e) => {
          setValue(e.target.value);
          latest.current = e.target.value;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => void flush(), delayMs);
        }}
        onBlur={() => void flush()}
      />
      <span className="faint self-end text-[0.75rem] tabular-nums">
        {value.length.toLocaleString()} / {maxLength.toLocaleString()}
      </span>
    </div>
  );
}
