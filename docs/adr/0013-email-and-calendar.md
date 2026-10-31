# 0013. Configurable email; Google Calendar by default, .ics as the fallback

- Status: Accepted
- Date: 2026-11-01

## Context

Copying links by hand is the clumsiest part of the flow, and interviews need to be on calendars. Companies use
different mail services and calendars.

## Decision

- **Email** is one interface (`src/lib/email`) with two providers chosen by `EMAIL_PROVIDER`: **Resend** (HTTP API)
  or **SMTP** (nodemailer: Postmark, SES, Google Workspace…). Without configuration, email is off and the UI shows
  links to copy, as before. It sends team invites, candidate links (from the lobby, to the address on the candidate
  record), and .ics invites and cancellations.
- **Calendar**, per workspace (`organizations.calendar_provider`, admins):
  - `google` (default): the scheduler connects their Google account once (OAuth, `calendar.events` scope only). Each
    interview becomes an event on their calendar with every interviewer and the candidate invited and a **Meet link**
    attached; Google sends the invites and updates. Cancelling the interview deletes the event. The Meet link is
    stored on the session and shown in the room to everyone.
  - `ics`: an email with an `.ics` invite (`METHOD:REQUEST`, later `CANCEL` with the same UID) to each attendee.
  - `none`: nothing is sent.
  - Google falls back to `.ics` for schedulers who haven't connected, or when the deployment has no Google client.
    Interviewers can always download an interview's `.ics`.
- **Refresh tokens** are encrypted with AES-256-GCM (`CALENDAR_TOKEN_KEY`) before they reach the database, stored
  in `calendar_connections` with no client access, and read and written only with the service key. Users see only
  whether they're connected. Disconnecting revokes the grant at Google.
- Calendar and email failures never undo scheduling; the page says what happened.

## Consequences

- The candidate's link isn't in the calendar invite (it's single-use and short-lived); the invite says it will be
  sent when the interview starts.
- Rescheduling isn't supported yet; cancel and schedule again.
- No reminder emails beyond the calendar's own reminders.

## Alternatives considered

- **One provider only**: forces a vendor on every company.
- **Google sign-in tokens from Supabase Auth**: only available at sign-in, and would tie calendar access to how
  people log in.
- **Calendar sync for every interviewer**: needs every interviewer to connect; one organiser plus attendee invites
  reaches everyone.
