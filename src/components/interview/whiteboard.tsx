"use client";

import "@excalidraw/excalidraw/index.css";
import { CaptureUpdateAction, Excalidraw, reconcileElements, restoreElements } from "@excalidraw/excalidraw";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { BoardDeltaTracker, chunkDeltas, type BoardElement } from "@/lib/interview/board";

// Shared whiteboard (ADR 0003). Local edits go out two ways:
//   live:    every ~100 ms as an ephemeral broadcast, so the other side sees strokes as they happen
//   persist: every ~1.5 s through record_event, which is what the audit log keeps
// Remote elements are reconciled by version, so the order they arrive in doesn't matter.

const LIVE_MS = 100;
const PERSIST_MS = 1500;

export type WhiteboardHandle = { applyRemote: (elements: BoardElement[]) => void; flush: () => Promise<void> };
export type SaveState = "idle" | "saving" | "saved" | "error";

type Props = {
  initialElements: BoardElement[];
  editable: boolean;
  onReady?: (handle: WhiteboardHandle) => void;
  sendLive?: (elements: BoardElement[]) => void;
  persist?: (elements: BoardElement[]) => Promise<unknown>;
  onSaveState?: (state: SaveState) => void;
};

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");
const subscribeTheme = (cb: () => void) => {
  const q = darkQuery();
  q.addEventListener("change", cb);
  return () => q.removeEventListener("change", cb);
};

export default function Whiteboard({ initialElements, editable, onReady, sendLive, persist, onSaveState }: Props) {
  const dark = useSyncExternalStore(subscribeTheme, () => darkQuery().matches, () => false);
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const liveTracker = useRef(new BoardDeltaTracker(initialElements));
  const persistTracker = useRef(new BoardDeltaTracker(initialElements));
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persisting = useRef<Promise<void> | null>(null);
  const retryRef = useRef<() => void>(() => {});
  const callbacks = useRef({ sendLive, persist, onSaveState });
  useEffect(() => {
    callbacks.current = { sendLive, persist, onSaveState };
  });

  const allElements = () => (api.current?.getSceneElementsIncludingDeleted() ?? []) as unknown as BoardElement[];

  const flushLive = useCallback(() => {
    liveTimer.current = null;
    const changed = liveTracker.current.changed(allElements());
    if (!changed.length) return;
    liveTracker.current.markSent(changed);
    callbacks.current.sendLive?.(changed);
  }, []);

  const flushPersist = useCallback(async () => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = null;
    if (persisting.current) return persisting.current;
    const save = callbacks.current.persist;
    const changed = persistTracker.current.changed(allElements());
    if (!save || !changed.length) return;
    persisting.current = (async () => {
      callbacks.current.onSaveState?.("saving");
      try {
        for (const chunk of chunkDeltas(changed)) {
          await save(chunk);
          persistTracker.current.markSent(chunk);
        }
        callbacks.current.onSaveState?.("saved");
      } catch (err) {
        console.error("board save failed", err);
        callbacks.current.onSaveState?.("error");
        // Unsaved elements stay "changed" and go out with the next edit or retry.
        persistTimer.current = setTimeout(() => retryRef.current(), PERSIST_MS * 4);
      } finally {
        persisting.current = null;
      }
    })();
    return persisting.current;
  }, []);

  useEffect(() => {
    retryRef.current = () => void flushPersist();
  }, [flushPersist]);

  const onChange = useCallback(() => {
    if (!editable) return;
    liveTimer.current ??= setTimeout(flushLive, LIVE_MS);
    persistTimer.current ??= setTimeout(() => void flushPersist(), PERSIST_MS);
  }, [editable, flushLive, flushPersist]);

  const applyRemote = useCallback((remote: BoardElement[]) => {
    const excalidraw = api.current;
    if (!excalidraw || !remote.length) return;
    const restored = restoreElements(remote as never, null) as unknown as RemoteExcalidrawElement[];
    const merged = reconcileElements(
      excalidraw.getSceneElementsIncludingDeleted(),
      restored,
      excalidraw.getAppState(),
    );
    excalidraw.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });
    // Someone else's edits: don't echo them back or record them as ours.
    const accepted = (merged as unknown as BoardElement[]).filter((el) =>
      remote.some((r) => r.id === el.id && r.version === el.version && r.versionNonce === el.versionNonce),
    );
    liveTracker.current.markSent(accepted);
    persistTracker.current.markSent(accepted);
  }, []);

  useEffect(() => {
    // Best effort: save pending strokes when the tab is hidden or closed.
    const onHide = () => void flushPersist();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      if (liveTimer.current) clearTimeout(liveTimer.current);
      void flushPersist();
    };
  }, [flushPersist]);

  return (
    <div className="h-full w-full">
      <Excalidraw
        excalidrawAPI={(instance) => {
          api.current = instance;
          onReady?.({ applyRemote, flush: flushPersist });
        }}
        initialData={{ elements: initialElements as never, appState: { viewBackgroundColor: "transparent" }, scrollToContent: true }}
        onChange={onChange}
        viewModeEnabled={!editable}
        isCollaborating={editable}
        theme={dark ? "dark" : "light"}
        UIOptions={{
          tools: { image: false },
          canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: false },
        }}
      />
    </div>
  );
}
