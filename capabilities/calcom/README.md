# capabilities/calcom

Tells Fawkes about your Cal.com bookings ([Phase 67](../../docs/phases/phase-67-service-integrations.md)). **Strictly read-only**: `GET /v2/bookings` through `ReadOnlyClient` with the fixed `cal-api-version` header. It cannot book, cancel or reschedule; there is no such command and no POST code path (a test asserts the source never imports `ServiceClient`).

| Event                          | When                                                                     | Fawkes                                              |
| ------------------------------ | ------------------------------------------------------------------------ | --------------------------------------------------- |
| `calcom.booking.created`       | a new booking appears                                                    | activity feed                                       |
| `calcom.booking.cancelled`     | a booking becomes cancelled or rejected                                  | activity feed (warning)                             |
| `calcom.booking.rescheduled`   | a booking's start moved, or a new booking replaces an old one            | activity feed                                       |
| `calcom.booking.starting_soon` | an accepted booking starts within `remind_minutes` (once per start time) | WARNING 5 min; **ephemeral**: not stored in history |

Payload: `booking_uid`, `title` (clipped), `status`, `start`/`end`, `attendee_count` (never names or emails), `url` (`https://app.cal.com/booking/<uid>`, built from the validated uid) and `meeting_url` (https only, omitted otherwise). Correlation id `calcom-booking-<uid>`.

## Setup

- Secret `api_key`: a Cal.com API key.
- Config: `poll_ms` (15 000 or more, default 60 000), `remind_minutes` (0–120, default 10; 0 turns reminders off). There is deliberately **no `base_url` setting**: anyone holding the API token could otherwise point the stored key at a host of their choosing, so it only ever goes to `https://api.cal.com`. Tests inject a local mock through the code-only `apiUrl` creation option.
- `status` command (read): upcoming, uncancelled bookings.

## Behaviour

- **History rule.** A booking first seen that was made (or, if cancelled, cancelled) before you enabled the capability is recorded silently; a booking cancelled after you enabled it is announced, even if it was made long before.
- **Pauses when unwatched.** No requests while no window or client is connected to Core. Reminders are checked at each poll, so with the default 60 s interval a reminder can be up to a minute late.
- **Failures.** 401 pauses 5 min; 429 waits `Retry-After`; redirects and responses over 2 MiB are refused. Without a key nothing is called.
- **Untrusted text.** Booking titles are typed by whoever booked: clipped to 200 characters, control characters removed, credential-shaped text redacted, never treated as instructions. Links must be https. The key never appears in a log, event or error.

## Web glance

The Overview shows a read-only glance (`CalComGlance`, apps/web) built from the `status` command only: upcoming bookings' start time, status and attendee count. Booking titles (which can name attendees), attendee names and emails are never shown.

## Not verified

The mock (`testing/mock-calcom.ts`) was written from the Cal.com API v2 reference. **Nothing was tested against the real Cal.com API.** Unconfirmed: that `status=upcoming,unconfirmed,cancelled`, `afterStart` and `sortStart` behave as assumed (a combined status filter, whether cancelled bookings in the past window are returned), the `cal-api-version` value `2024-08-13` for this endpoint, and how rescheduled bookings link to each other (`rescheduledFromUid`/`rescheduledToUid`).
