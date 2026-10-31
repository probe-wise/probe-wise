"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardElement } from "@/lib/interview/board";
import type { ClientEventType, ParticipantRole, SessionEvent } from "@/lib/interview/events";
import { createClient } from "@/lib/supabase/client";

// Live connection to a session (ADR 0002):
//   • 'event' broadcasts come from the database after an event is committed. They carry a
//     per-session seq; anything out of order or missing triggers a catch-up read from the log.
//   • 'board.live' and 'code.live' broadcasts are ephemeral, between browsers, while
//     drawing or typing. What's recorded goes through record_event.
//   • Presence says who has the room open.
// Interviewers also listen on the private ':interviewers' topic.

export type ConnectionState = "connecting" | "live" | "reconnecting" | "offline";

type Options = {
  sessionId: string;
  role: ParticipantRole;
  participantId: string;
  displayName: string;
  initialSeq: number;
  onEvents: (events: SessionEvent[]) => void;
  onLiveBoard: (elements: BoardElement[]) => void;
  onLiveCode?: (code: { text: string; language: string }) => void;
};

export function useSessionChannel({
  sessionId,
  role,
  participantId,
  displayName,
  initialSeq,
  onEvents,
  onLiveBoard,
  onLiveCode,
}: Options) {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [online, setOnline] = useState<string[]>([]);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastSeq = useRef(initialSeq);
  const catchingUp = useRef<Promise<void> | null>(null);
  const handlers = useRef({ onEvents, onLiveBoard, onLiveCode });
  useEffect(() => {
    handlers.current = { onEvents, onLiveBoard, onLiveCode };
  });

  const supabase = () => (supabaseRef.current ??= createClient());

  /**
   * Read everything after the last seq we applied. RLS returns only what we may see.
   * Calls during a running catch-up schedule one more pass, so nothing committed
   * after the first read started is missed.
   */
  const rerun = useRef(false);
  const catchUp = useCallback(async () => {
    if (catchingUp.current) {
      rerun.current = true;
      return catchingUp.current;
    }
    catchingUp.current = (async () => {
      try {
        do {
          rerun.current = false;
          for (;;) {
            const { data, error } = await supabase()
              .from("session_events")
              .select("seq, type, participant_id, actor_role, visibility, phase, payload, created_at")
              .eq("session_id", sessionId)
              .gt("seq", lastSeq.current)
              .order("seq")
              .limit(500);
            if (error || !data?.length) break;
            const events = data as unknown as SessionEvent[];
            lastSeq.current = events[events.length - 1].seq;
            handlers.current.onEvents(events);
            if (data.length < 500) break;
          }
        } while (rerun.current);
      } finally {
        catchingUp.current = null;
      }
    })();
    return catchingUp.current;
  }, [sessionId]);

  const receive = useCallback(
    (event: SessionEvent) => {
      if (event.seq <= lastSeq.current) return; // duplicate (both topics, or already caught up)
      if (event.seq === lastSeq.current + 1) {
        lastSeq.current = event.seq;
        handlers.current.onEvents([event]);
        return;
      }
      // A gap: either a dropped message or an event we're not allowed to see.
      // The log is the authority, so read it rather than guess.
      void catchUp();
    },
    [catchUp],
  );

  useEffect(() => {
    let cancelled = false;
    const client = supabase();
    const channels: RealtimeChannel[] = [];

    (async () => {
      // Private channels authorise with the user's JWT.
      await client.realtime.setAuth();
      if (cancelled) return;

      const main = client.channel(`session:${sessionId}`, {
        config: { private: true, broadcast: { self: false }, presence: { key: participantId } },
      });
      main
        .on("broadcast", { event: "event" }, ({ payload }) => receive(payload as SessionEvent))
        .on("broadcast", { event: "board.live" }, ({ payload }) => {
          const elements = (payload as { elements?: BoardElement[] }).elements;
          if (Array.isArray(elements)) handlers.current.onLiveBoard(elements);
        })
        .on("broadcast", { event: "code.live" }, ({ payload }) => {
          const p = payload as { text?: unknown; language?: unknown };
          if (typeof p.text === "string" && typeof p.language === "string") {
            handlers.current.onLiveCode?.({ text: p.text, language: p.language });
          }
        })
        .on("presence", { event: "sync" }, () => setOnline(Object.keys(main.presenceState())))
        .subscribe((status) => {
          if (cancelled) return;
          if (status === "SUBSCRIBED") {
            setConnection("live");
            void main.track({ name: displayName, role });
            void catchUp(); // anything missed while connecting or disconnected
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            setConnection("reconnecting");
          } else if (status === "CLOSED") {
            setConnection("offline");
          }
        });
      channels.push(main);
      channelRef.current = main;

      if (role === "interviewer") {
        const priv = client.channel(`session:${sessionId}:interviewers`, { config: { private: true } });
        priv.on("broadcast", { event: "event" }, ({ payload }) => receive(payload as SessionEvent)).subscribe();
        channels.push(priv);
      }
    })();

    // Back online or tab visible again: make sure nothing was missed.
    const resync = () => {
      if (document.visibilityState === "visible") void catchUp();
    };
    window.addEventListener("online", resync);
    document.addEventListener("visibilitychange", resync);

    return () => {
      cancelled = true;
      window.removeEventListener("online", resync);
      document.removeEventListener("visibilitychange", resync);
      for (const ch of channels) void client.removeChannel(ch);
      channelRef.current = null;
    };
  }, [sessionId, role, participantId, displayName, receive, catchUp]);

  /** Record an action through the database (durable, authorised, then broadcast). */
  const record = useCallback(
    async (type: ClientEventType, payload: Record<string, unknown>) => {
      const { data, error } = await supabase().rpc("record_event", {
        p_session: sessionId,
        p_type: type,
        p_payload: payload as never,
        p_client_ts: new Date().toISOString(),
      });
      if (error) throw error;
      return data;
    },
    [sessionId],
  );

  /** Ephemeral, low-latency board deltas to the other participants (not stored). */
  const sendLiveBoard = useCallback((elements: BoardElement[]) => {
    const ch = channelRef.current;
    if (!ch || !elements.length) return;
    void ch.send({ type: "broadcast", event: "board.live", payload: { elements } });
  }, []);

  /** Ephemeral, low-latency code updates (the full text; code files are small). */
  const sendLiveCode = useCallback((text: string, language: string) => {
    const ch = channelRef.current;
    if (!ch) return;
    void ch.send({ type: "broadcast", event: "code.live", payload: { text, language } });
  }, []);

  const rpc = useCallback(
    async (fn: "start_session" | "end_session" | "change_session_phase", args: Record<string, string>) => {
      const { error } = await supabase().rpc(fn, { p_session: sessionId, ...args } as never);
      if (error) throw error;
    },
    [sessionId],
  );

  return { connection, online, record, sendLiveBoard, sendLiveCode, rpc, catchUp };
}
