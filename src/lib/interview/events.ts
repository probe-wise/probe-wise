// Event vocabulary for the session audit log. The SQL CHECK on session_events.type
// repeats these values; src/lib/__tests__/interview-sync.test.ts fails if they drift.

import type { Phase } from "@/lib/interview/phases";

export const EVENT_TYPES = [
  "session.created",
  "participant.joined",
  "consent.given",
  "invite.created",
  "invites.revoked",
  "session.started",
  "phase.changed",
  "session.ended",
  "chat.message",
  "probe.asked",
  "notes.updated",
  "board.updated",
  "interviewer_note.updated",
  "evaluation.submitted",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** Types a participant may send through record_event(); the rest are written by the database. */
export type ClientEventType = "chat.message" | "probe.asked" | "notes.updated" | "board.updated" | "interviewer_note.updated";

export type ParticipantRole = "candidate" | "interviewer";
export type ActorRole = ParticipantRole | "system";

export type SessionEvent = {
  seq: number;
  type: EventType;
  participant_id: string | null;
  actor_role: ActorRole;
  visibility: "all" | "interviewers";
  phase: Phase | null;
  payload: Record<string, unknown>;
  created_at: string;
};

const LABELS: Record<EventType, string> = {
  "session.created": "Session created",
  "participant.joined": "Joined",
  "consent.given": "Consented to recording",
  "invite.created": "Invite link created",
  "invites.revoked": "Invite links revoked",
  "session.started": "Interview started",
  "phase.changed": "Phase changed",
  "session.ended": "Session ended",
  "chat.message": "Chat",
  "probe.asked": "Interviewer question",
  "notes.updated": "Notes edited",
  "board.updated": "Board edited",
  "interviewer_note.updated": "Private note edited",
  "evaluation.submitted": "Evaluation submitted",
};

export const eventLabel = (type: string) => LABELS[type as EventType] ?? type;

/** Text carried by chat, probe and note events. */
export const eventText = (event: Pick<SessionEvent, "payload">) =>
  typeof event.payload.text === "string" ? event.payload.text : "";
