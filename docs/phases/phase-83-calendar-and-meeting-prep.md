# Phase 83 — Calendar Awareness & Meeting Prep

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | 🟨 Built; every check is simulated (injected fake calendar clients, stores and managers). The four adapters were never run against Google, Microsoft Graph, CalDAV or macOS Calendar, and in production no adapter is wired (the feed is "unconfigured"), so the "a real calendar event triggers a reminder and a prep note" criterion is not met |
| Depends on | [Phase 65 — Botless Notetaker](phase-65-botless-notetaker.md), [Phase 35 — Kage Decisions & Action-Item Extraction](phase-35-kage-decisions-and-action-items.md) |
| Unblocks | — |

## Goal

Fawkes knows what is coming up and prepares you for it.

## Tasks

- [ ] Read-only calendar capability (CalDAV, Google, Microsoft, macOS Calendar). Adapters for all four are implemented with injected fake clients (`capabilities/calendar`, [README](../../capabilities/calendar/README.md)); capability id `calendar`, read-only, disabled until enabled, secrets `<provider>_credential`. Unticked because `createCalendarCapability()` in `core/runtime/src/builtins.ts` is called with **no adapters**, so the production feed is "unconfigured", and timezone, pagination and marker handling are unverified against real Google, Graph or CalDAV.
- [ ] "Meeting in 5 minutes" with a one-click offer to start the notetaker (Phase 65). `GET /api/calendar/upcoming` and the `#/calendar` page show upcoming events; reminder de-duplication is in memory. The reminder now becomes a notification (tested against a fake calendar). Unticked because no real calendar was read and the notetaker button only navigates to `#/meetings`; it never starts a recording.
- [ ] Prep note: earlier decisions and open action items with the same people or project. `StoreMeetingPrepQuery` reads accepted reviewed items of prior meetings with matching participants and is gated on `allow_sensitive_meetings`. Simulated. Unticked because project-only matching returns nothing (meetings have no project field) and no real meetings were used.
- [ ] Deploy-freeze windows from the calendar feed workflow safety (Phase 40). With the calendar config `freeze` on (default false), the `CapabilityManager` `preflight` hook (after approval, before dispatch) refuses side effect `production` commands and `vercel/redeploy` unless the fresh feed shows no freeze window, and fails closed (`SECURITY_POLICY_BLOCKED`) when the feed is missing, stale, unreadable or incomplete or a credential is missing. Simulated. Unticked because **agent permission-request approvals (AgentApprovals) and other external side effects (n8n, terminal) are not covered**, and with freeze on and no adapters wired every such command is blocked.

## Deliverables

- capabilities/calendar: built (`@phoenix/capability-calendar`, `capabilities/calendar/**`, `core/runtime/src/calendar`, `core/api/src/calendar-routes.ts`, [calendar-awareness.md](../calendar-awareness.md)); simulated evidence only.
- Meeting prep view: the `#/calendar` page (Navbar link) with `prep`, `status`, `checkedAt` and `prepComplete`.

## Exit criteria

- [ ] A real calendar event triggers a reminder and a prep note. **Unmet.** No real calendar was read and no adapter is wired in production; a reminder does become a notification when a (fake) calendar supplies one.

## Implementation notes

### What was built

- **Capability**: read-only `calendar` (Google, Microsoft, CalDAV, macOS adapters behind injected clients), disabled until enabled; freeze markers are a Google private extended property `phoenix.deployFreeze=true` or a `[deploy-freeze]` title prefix by the calendar owner; others use the category `deploy-freeze`.
- **Route**: `GET /api/calendar/upcoming` (authenticated) returns `{enabled, events, prep, status, checkedAt, prepComplete}` with `status` one of ready, unconfigured, unavailable, stale. Stale or unavailable is never shown as an empty calendar. Private events keep a hashed id, the title "Busy" and times only.
- **Deploy freeze**: the `CapabilityManager` gained an optional `preflight` hook; Core refuses `production` side-effect commands and `vercel/redeploy` through it while the freeze is on and the feed is not clean.
- **Web and docs**: Navbar link and `#/calendar` route, `calendar.*` interface strings (English plus nine machine-translated, unreviewed locales). New workspace package `@phoenix/capability-calendar` (GPL, workspace); no new third-party dependency, no migration.

### Deviations

- Reminders are de-duplicated in memory only. A reminder is turned into a notification (`core/notifications` `ALWAYS_NOTIFY`).
- The notetaker button navigates to `#/meetings` instead of starting a recording.

### Security review

A static read-only review by tools (not a human audit) was followed by fixes, each with tests: a missing credential, dropped or oversized events, offset-less datetimes and pagination now make the feed unavailable instead of silently fresh; the `calendar` source and type are reserved on `POST /api/events`.

### What was not built

Starting the notetaker from the calendar; project-based prep matching; freeze coverage for AgentApprovals and other external side effects.

### What was not run

Any adapter against a real Google, Microsoft Graph, CalDAV or macOS calendar account, and any real reminder or prep note. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.
- Read-only: Phoenix never creates or changes calendar events without approval.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
