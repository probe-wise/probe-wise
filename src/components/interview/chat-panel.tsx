"use client";

import { useEffect, useId, useRef, useState } from "react";
import { phaseLabel } from "@/lib/interview/phases";

type Message = { kind: "chat" | "probe"; seq: number; author: string; role: string; text: string; at: string; mine: boolean };
type Marker = { kind: "phase" | "system"; seq: number; text: string; at: string };
export type FeedItem = Message | Marker;

const isMessage = (item: FeedItem): item is Message => item.kind === "chat" || item.kind === "probe";

type Props = {
  feed: FeedItem[];
  role: "candidate" | "interviewer";
  canSend: boolean;
  /** A question picked from the interviewer guide; a new `id` stages it again. */
  staged: { id: number; text: string } | null;
  onSend: (text: string, asProbe: boolean) => Promise<void>;
};

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function ChatPanel({ feed, role, canSend, staged, onSend }: Props) {
  const [text, setText] = useState("");
  const [asProbe, setAsProbe] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  // A probe picked from the guide lands in the box, ready to edit and send.
  const [stagedId, setStagedId] = useState<number | null>(null);
  if (staged && staged.id !== stagedId) {
    setStagedId(staged.id);
    setText(staged.text);
    setAsProbe(true);
  }
  useEffect(() => {
    if (staged) inputRef.current?.focus();
  }, [staged]);

  // Keep the newest message in view unless the reader has scrolled up.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [feed.length]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(body, role === "interviewer" && asProbe);
      setText("");
      setAsProbe(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send. Try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <section aria-labelledby={`${id}-h`} className="flex min-h-0 flex-1 flex-col">
      <h2 id={`${id}-h`} className="sr-only">
        Conversation
      </h2>
      <ol ref={listRef} className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto p-3" aria-live="polite">
        {feed.length === 0 ? <li className="faint">Messages and interviewer questions show up here.</li> : null}
        {feed.map((item) =>
          !isMessage(item) ? (
            <li key={item.seq} className="faint text-center text-[0.8rem]">
              {item.text} · {time(item.at)}
            </li>
          ) : (
            <li
              key={item.seq}
              className={`rounded-lg px-3 py-2 text-[0.93rem] ${
                item.kind === "probe" ? "border-l-3 border-probe bg-probe-wash" : item.mine ? "bg-marker-wash" : "bg-board"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2 text-[0.78rem] text-ink-faint">
                <span className="font-semibold text-ink-soft">
                  {item.kind === "probe" ? <span className="hand text-[1rem] text-probe">Probe · </span> : null}
                  {item.author}
                </span>
                <span>{time(item.at)}</span>
              </div>
              <p className="whitespace-pre-wrap break-words">{item.text}</p>
            </li>
          ),
        )}
      </ol>

      {canSend ? (
        <form
          className="grid gap-2 border-t border-grid p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label htmlFor={`${id}-input`} className="sr-only">
            Message
          </label>
          <textarea
            id={`${id}-input`}
            ref={inputRef}
            className="input min-h-[2.75rem] resize-y text-[0.93rem]"
            rows={2}
            maxLength={asProbe ? 1000 : 2000}
            placeholder={role === "interviewer" ? "Message or follow-up question…" : "Message the interviewer…"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            {role === "interviewer" ? (
              <label className="flex items-center gap-2 text-[0.85rem]">
                <input type="checkbox" checked={asProbe} onChange={(e) => setAsProbe(e.target.checked)} />
                Send as a probe question
              </label>
            ) : (
              <span className="faint text-[0.8rem]">Enter to send · Shift+Enter for a new line</span>
            )}
            <button type="submit" className="btn btn-primary min-h-9 px-3 py-1" disabled={sending || !text.trim()}>
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
          {error ? (
            <p role="alert" className="field-error">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}

export const phaseMarker = (to: string) => `Moved to ${phaseLabel(to)}`;
