# capabilities/calendar

Read-only calendar awareness: upcoming meetings, a fresh deploy-freeze snapshot and a `calendar.meeting.starting_soon` event with prep from reviewed prior meetings. Disabled until the owner enables it and turns on at least one provider.

## Behaviour

- Manifest permissions are `network` and `external_api` (both in the protocol permission list). The only command, `upcoming`, has side effect `read`. No adapter issues a write.
- Providers (Google, Microsoft Graph, CalDAV, macOS) are code-injected through `createCalendarCapability({ adapters })` and selected by boolean config. **In production `createCalendarCapability()` is called with no adapters (`core/runtime/src/builtins.ts`), so the feed is reported `unconfigured`**; the adapters have only been exercised with injected fake clients. A network provider without its `<provider>_credential` secret is never queried, and the whole feed is then reported unavailable (`<provider> credential missing`) without advancing `checkedAt`; macOS uses an injected, permission-checked runner.
- Recurrences are expanded by the provider (Google `singleEvents`, Graph `calendarView`, CalDAV/macOS expanded objects); the adapters never guess occurrences. Events are normalised by `safeEvent`: a private event keeps no title, attendees or link (Graph `personal` counts as private), private events are reduced to `Busy` with no attendees, link or freeze flag, only https links without credentials survive, and attendees must look like emails.
- `freezeAt` treats a freeze as the half-open window `[start, end)`; only explicitly marked, public, non-cancelled events count. A failed read keeps `error` set and health degraded, so a stale feed is never presented as current.
- Reminders fire once per occurrence id and start time, from five minutes before start until start, never for private or cancelled events. With the `reminderStore` option (Core passes one backed by the settings key `calendar.reminders.sent`) the de-dup keys survive a Core restart: only an opaque SHA-256 digest and the start time are stored, expired after the start, capped at 500, and corrupt stored data is ignored. If the store fails the reminder is still sent once, silently. Without a store, de-duplication is in memory only.
- Prep (`prepareMeeting`, `src/prep.ts`) is pure. It uses only the injected `MeetingPrepQuery`, which Core backs with reviewed meeting items; accepted or edited decisions and open action items only, with no transcripts. `ReviewedItem.closed` is optional; absent means open.

## Evidence

Tests (`test/calendar.test.ts`) use injected fake clients and runner with hand-written payloads shaped from my reading of each provider's documentation. They cover the four adapters, `safeEvent` sanitisation, `freezeAt` boundaries, the reminder book (including persisted keys) and prep filtering. `core/runtime/test/calendar-reminders-restart.test.ts` restarts a real `PhoenixRuntime` on the same database. They are simulated evidence.

## Unmet exit criterion

**Not met: no real calendar has been read.** Nothing here has run against Google, Microsoft Graph, a CalDAV server or macOS Calendar, so real field names, time-zone formats (including Windows zone names from Graph), recurrence/exception shapes, CalDAV XML/ICS parsing and credential/OAuth flows are unverified. The CalDAV and macOS adapters also depend on an injected transport and a `calendar-read` helper that this package does not implement. The exit criterion needs verification against at least one real account per provider before it can be claimed.

## Feed integrity (fail closed)

- A feed is complete or it is unavailable. If any configured provider has no credential, throws, is paginated (`nextPageToken`, `@odata.nextLink`), returns more than 500 events, or returns any non-cancelled event that cannot be read (bad id, date or IANA zone), the capability sets `error`, returns no events and does not advance `checkedAt`. Nothing is silently dropped, because a dropped row could be a deploy freeze.
- Freeze holds may be longer than 31 days; ordinary events are still capped at 31 days.
- Offset-less Graph/CalDAV/macOS date-times and all-day Google dates are read as wall-clock time in the event's own time zone, never the host's.
- `upcoming` is cached; `{ "refresh": true }` re-reads providers when the cache is older than 30 seconds or errored. Core's freeze snapshot always asks for that.

## Marking a deploy freeze

- **Google:** the private extended property `phoenix.deployFreeze=true` on the event, or a title starting with `[deploy-freeze]` on an event you organise. Google Calendar has no `categories` field, and invited events' titles are ignored so a stranger's invitation cannot create a hold.
- **Microsoft Graph / CalDAV:** the category `deploy-freeze`. **macOS:** the runner's `deployFreeze` flag.
- Private events never impose a hold.
