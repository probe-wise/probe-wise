"use client";

import { cpp } from "@codemirror/lang-cpp";
import { go } from "@codemirror/lang-go";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import CodeMirror from "@uiw/react-codemirror";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CODE_LANGUAGES, type CodeLanguage } from "@/lib/interview/rounds";

// The coding round's shared editor (ADR 0010). The candidate types; interviewers watch.
//   live:    every ~150 ms as an ephemeral broadcast, so interviewers see typing as it happens
//   persist: ~1.2 s after typing stops, through record_event('code.updated'), which the log keeps

const LIVE_MS = 150;
const PERSIST_MS = 1200;

export type CodeEditorHandle = { applyRemote: (text: string, language: string) => void; flush: () => Promise<void> };
export type CodeSaveState = "idle" | "saving" | "saved" | "error";

type Props = {
  initialCode: string;
  initialLanguage: string;
  editable: boolean;
  onReady?: (handle: CodeEditorHandle) => void;
  sendLive?: (text: string, language: string) => void;
  persist?: (text: string, language: string) => Promise<unknown>;
  onSaveState?: (state: CodeSaveState) => void;
};

const EXTENSIONS: Record<CodeLanguage, () => ReturnType<typeof python>> = {
  python: () => python(),
  javascript: () => javascript(),
  typescript: () => javascript({ typescript: true }),
  java: () => java(),
  cpp: () => cpp(),
  go: () => go(),
};

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");
const subscribeTheme = (cb: () => void) => {
  const q = darkQuery();
  q.addEventListener("change", cb);
  return () => q.removeEventListener("change", cb);
};

export default function CodeEditor({ initialCode, initialLanguage, editable, onReady, sendLive, persist, onSaveState }: Props) {
  const dark = useSyncExternalStore(subscribeTheme, () => darkQuery().matches, () => false);
  const [code, setCode] = useState(initialCode);
  const [language, setLanguage] = useState<CodeLanguage>((CODE_LANGUAGES.find((l) => l.value === initialLanguage)?.value ?? "python") as CodeLanguage);
  const latest = useRef({ code: initialCode, language: initialLanguage });
  const saved = useRef({ code: initialCode, language: initialLanguage });
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const props = useRef({ sendLive, persist, onSaveState });
  const retry = useRef<() => void>(() => {});
  useEffect(() => {
    props.current = { sendLive, persist, onSaveState };
  });

  const save = useCallback(async (): Promise<void> => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (inflight.current) await inflight.current;
    const { code: text, language: lang } = latest.current;
    if (text === saved.current.code && lang === saved.current.language) return;
    const persistFn = props.current.persist;
    if (!persistFn) return;
    props.current.onSaveState?.("saving");
    inflight.current = (async () => {
      try {
        await persistFn(text, lang);
        saved.current = { code: text, language: lang };
        props.current.onSaveState?.("saved");
      } catch {
        props.current.onSaveState?.("error");
        saveTimer.current = setTimeout(() => retry.current(), PERSIST_MS * 3);
      } finally {
        inflight.current = null;
      }
    })();
    await inflight.current;
  }, []);

  useEffect(() => {
    retry.current = () => void save();
  }, [save]);

  const changed = useCallback(
    (text: string, lang: string) => {
      latest.current = { code: text, language: lang };
      liveTimer.current ??= setTimeout(() => {
        liveTimer.current = null;
        props.current.sendLive?.(latest.current.code, latest.current.language);
      }, LIVE_MS);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void save(), PERSIST_MS);
    },
    [save],
  );

  useEffect(() => {
    onReady?.({
      applyRemote: (text, lang) => {
        // Only the read-only side applies remote code; the candidate's editor is the source.
        latest.current = { code: text, language: lang };
        saved.current = { code: text, language: lang };
        setCode(text);
        const known = CODE_LANGUAGES.find((l) => l.value === lang);
        if (known) setLanguage(known.value);
      },
      flush: save,
    });
  }, [onReady, save]);

  // Save on tab hide / close so the last keystrokes reach the record.
  useEffect(() => {
    if (!editable) return;
    const flush = () => void save();
    const hidden = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [editable, save]);

  const extensions = useMemo(() => [EXTENSIONS[language]()], [language]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-grid px-3 py-1.5">
        {editable ? (
          <label className="flex items-center gap-2 text-[0.85rem]">
            <span className="faint">Language</span>
            <select
              className="input py-1! text-[0.85rem]"
              value={language}
              onChange={(e) => {
                const lang = e.target.value as CodeLanguage;
                setLanguage(lang);
                changed(latest.current.code, lang);
              }}
            >
              {CODE_LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="faint text-[0.85rem]">
            {CODE_LANGUAGES.find((l) => l.value === language)?.label} · the candidate is typing here (read-only for you)
          </span>
        )}
        <span className="faint text-[0.8rem]">Code isn&apos;t run. Talk through it with examples.</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <CodeMirror
          value={code}
          height="100%"
          className="h-full text-[0.9rem]"
          theme={dark ? "dark" : "light"}
          extensions={extensions}
          editable={editable}
          readOnly={!editable}
          basicSetup={{ foldGutter: false, autocompletion: false }}
          onChange={(text) => {
            setCode(text);
            changed(text, latest.current.language);
          }}
          aria-label="Code editor"
        />
      </div>
    </div>
  );
}
