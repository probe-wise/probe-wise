"use client";

import { useActionState, useTransition } from "react";
import { disconnectCalendar, setCalendarProvider } from "@/app/actions/calendar";
import type { FormState } from "@/app/actions/org";
import { SubmitButton } from "@/components/submit-button";

const OPTIONS = [
  {
    value: "google",
    label: "Google Calendar",
    hint: "Events go on the scheduler's Google Calendar with a Meet link; Google sends the invites. Falls back to .ics for people who haven't connected.",
  },
  { value: "ics", label: "Calendar file (.ics) by email", hint: "Works with Google, Outlook and Apple Calendar. Needs email to be set up." },
  { value: "none", label: "Off", hint: "No invites. The interview page still offers an .ics download." },
] as const;

/** Admins: how the workspace sends calendar invites (ADR 0013). */
export function CalendarProviderForm({ current, googleAvailable, emailAvailable }: { current: string; googleAvailable: boolean; emailAvailable: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(setCalendarProvider, { status: "idle" });
  return (
    <form action={action} className="grid gap-3">
      <fieldset className="grid gap-2">
        <legend className="sr-only">Calendar invites</legend>
        {OPTIONS.map((o) => {
          const note =
            o.value === "google" && !googleAvailable
              ? " Not set up on this deployment (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CALENDAR_TOKEN_KEY), so .ics is used."
              : o.value === "ics" && !emailAvailable
                ? " Email isn't set up on this deployment."
                : "";
          return (
            <label key={o.value} className="option">
              <input type="radio" name="calendar_provider" value={o.value} defaultChecked={current === o.value} />
              <span className="option-title">{o.label}</span>
              <span className="option-hint">
                {o.hint}
                {note}
              </span>
            </label>
          );
        })}
      </fieldset>
      {state.status === "error" ? (
        <p role="alert" className="field-error">
          {state.message}
        </p>
      ) : null}
      {state.status === "saved" ? (
        <p role="status" className="text-[0.9rem] text-pass">
          Saved.
        </p>
      ) : null}
      <div>
        <SubmitButton className="btn btn-secondary" pendingLabel="Saving…">
          Save
        </SubmitButton>
      </div>
    </form>
  );
}

export function DisconnectCalendarButton() {
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => start(async () => void (await disconnectCalendar()))}>
      {pending ? "Disconnecting…" : "Disconnect"}
    </button>
  );
}
