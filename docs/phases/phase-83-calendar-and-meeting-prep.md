# Phase 83 — Calendar Awareness & Meeting Prep

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | 🟨 Built; every check is simulated (injected fakes, loopback fake servers, stores and managers). Core now builds the CalDAV, Google and Graph adapters from config and secrets (macOS: the desktop shell's EventKit reader pushes snapshots to Core; it compiled but never ran against a real calendar or permission prompt), but none was ever run against a real account or server, so the "a real calendar event triggers a reminder and a prep note" criterion is not met |
| Depends on | [Phase 65 — Botless Notetaker](phase-65-botless-notetaker.md), [Phase 35 — Kage Decisions & Action-Item Extraction](phase-35-kage-decisions-and-action-items.md) |
| Unblocks | — |

## Goal

Fawkes knows what is coming up and prepares you for it.

## Tasks

- [ ] Read-only calendar capability (CalDAV, Google, Microsoft, macOS Calendar). Adapters for all four are implemented with injected fake clients (`capabilities/calendar`, [README](../../capabilities/calendar/README.md)); capability id `calendar`, read-only, disabled until enabled, secrets `<provider>_credential`. Core now builds the adapters at read time from config and secrets (real CalDAV `REPORT` transport and iCalendar reader; Google and Graph with an owner-supplied access token, no OAuth flow; macOS: EventKit reader in the desktop shell, see "macOS reader" below). Unticked because nothing was run against a real account or server, tokens cannot be refreshed, EventKit never ran against a real calendar, and timezone, pagination and marker handling are unverified against real Google, Graph or CalDAV.
- [ ] "Meeting in 5 minutes" with a one-click offer to start the notetaker (Phase 65). `GET /api/calendar/upcoming` and the `#/calendar` page show upcoming events; reminder de-duplication is persisted (opaque keys in settings, so a Core restart inside the window does not remind again; fake-calendar tests only). The reminder now becomes a notification (tested against a fake calendar). Unticked because no real calendar was read and the notetaker button only navigates to `#/meetings`; it never starts a recording.
- [ ] Prep note: earlier decisions and open action items with the same people or project. `StoreMeetingPrepQuery` reads accepted reviewed items of prior meetings with matching participants and is gated on `allow_sensitive_meetings`. Simulated. Unticked because project-only matching deliberately returns nothing (meetings have no project field, so a project match would be invented) and no real meetings were used.
- [ ] Deploy-freeze windows from the calendar feed workflow safety (Phase 40). With the calendar config `freeze` on (default false), the `CapabilityManager` `preflight` hook (after approval, before dispatch) refuses side effect `production` commands and `vercel/redeploy` unless the fresh feed shows no freeze window, and fails closed (`SECURITY_POLICY_BLOCKED`) when the feed is missing, stale, unreadable or incomplete or a credential is missing. Simulated. Unticked because **agent permission-request approvals (AgentApprovals) and other external side effects (n8n, terminal) are not covered**, and with freeze on and no provider configured (or one failing) every such command is blocked.

## Deliverables

- capabilities/calendar: built (`@phoenix/capability-calendar`, `capabilities/calendar/**`, `core/runtime/src/calendar`, `core/api/src/calendar-routes.ts`, [calendar-awareness.md](../calendar-awareness.md)); simulated evidence only.
- Meeting prep view: the `#/calendar` page (Navbar link) with `prep`, `status`, `checkedAt` and `prepComplete`.

## Exit criteria

- [ ] A real calendar event triggers a reminder and a prep note. **Unmet.** No real calendar was read; adapters are now built from config and secrets in production but only ever ran against loopback fakes; a reminder does become a notification when a (fake) calendar supplies one.

## Implementation notes

### What was built

- **Capability**: read-only `calendar` (Google, Microsoft, CalDAV, macOS adapters behind injected clients), disabled until enabled; freeze markers are a Google private extended property `phoenix.deployFreeze=true` or a `[deploy-freeze]` title prefix by the calendar owner; others use the category `deploy-freeze`.
- **Route**: `GET /api/calendar/upcoming` (authenticated) returns `{enabled, events, prep, status, checkedAt, prepComplete}` with `status` one of ready, unconfigured, unavailable, stale. Stale or unavailable is never shown as an empty calendar. Private events keep a hashed id, the title "Busy" and times only.
- **Deploy freeze**: the `CapabilityManager` gained an optional `preflight` hook; Core refuses `production` side-effect commands and `vercel/redeploy` through it while the freeze is on and the feed is not clean.
- **Web and docs**: Navbar link and `#/calendar` route, `calendar.*` interface strings (English plus nine machine-translated, unreviewed locales). New workspace package `@phoenix/capability-calendar` (GPL, workspace); no new third-party dependency, no migration.

### Deviations

- Reminder de-duplication keys persist across a Core restart (settings key `calendar.reminders.sent`: opaque digest and start time only, bounded, expiring, corrupt data ignored; a storage failure still reminds once). A reminder is turned into a notification (`core/notifications` `ALWAYS_NOTIFY`).
- The notetaker button navigates to `#/meetings` instead of starting a recording.

### Security review

A static read-only review by tools (not a human audit) was followed by fixes, each with tests: a missing credential, dropped or oversized events, offset-less datetimes and pagination now make the feed unavailable instead of silently fresh; the `calendar` source and type are reserved on `POST /api/events`.

### Production adapters

Core builds adapters from the capability's config and secrets at read time (`capabilities/calendar/src/providers.ts`, `caldav.ts`, `ics.ts`): CalDAV (`caldav_url`, `caldav_timezone`, secret `caldav_credential` = `username:password`), Google and Graph (secret = access token, no OAuth, no refresh). All use https (http only to localhost), refuse redirects, bound the answer size and time, and fail closed with fixed secret-free messages. No new third-party dependency (Node `fetch` and `@phoenix/service-kit`). Manifest permissions stay `network` and `external_api`; `data_categories` and secret descriptions disclose the credential use. See [calendar-awareness.md](../calendar-awareness.md).

### macOS reader (EventKit)

The shell reads EventKit and POSTs a bounded snapshot to Core; design, bounds and permission rules are in [calendar-awareness.md](../calendar-awareness.md#macos-calendar). Transport decision: Core cannot call the shell, a standalone helper binary could not hold the app's Calendar permission, and the contract's `calendar-read` seam is a `CalendarRunner`, so the smallest honest design is a shell-to-Core push (`POST /api/calendar/macos`, session token, in-memory, replace-not-append, staleness-stamped by Core's clock) read by the existing `macosCalendar` adapter. The tray item **Share macOS Calendar with Phoenix** (default off, saved as `calendar_share`) is the only thing that asks macOS for access. The `calendar.unconfigured` string names macOS Calendar again because the reader is reachable from the tray.

New crate: `objc2-event-kit 0.3.2` (macOS target only; `Zlib OR Apache-2.0 OR MIT`), the EventKit binding of the same `madsmtm/objc2` 0.3 family as the `objc2`, `objc2-foundation`, `objc2-app-kit` and `objc2-web-kit` crates already in the lockfile; its only dependencies (`objc2`, `objc2-foundation`, `block2`, `bitflags`) were already present, so the lockfile gains exactly one package. Justification: hand-written `msg_send!` for `EKEventStore`, `EKEvent`, `EKParticipant`, authorization enums and a completion block would be larger and less safe than the generated, reviewed bindings. `THIRD_PARTY_NOTICES.md` was regenerated and `--check` passes.

### What was not built

A real run of the macOS Calendar reader (it compiled and is unit-tested only); an OAuth flow and token refresh for Google and Graph; project-based prep matching (decision: meetings have no project field); starting the notetaker from the calendar; freeze coverage for AgentApprovals and other external side effects.

### What was not run

Any adapter against a real Google, Microsoft Graph, CalDAV or macOS calendar account, and any real reminder or prep note. The new transport was only run against loopback fake servers. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.
- Read-only: Phoenix never creates or changes calendar events without approval.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
