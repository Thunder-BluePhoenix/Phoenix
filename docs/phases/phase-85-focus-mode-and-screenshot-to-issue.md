# Phase 85 — Focus Mode & Screenshot-to-Issue

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | 🟨 Manual and Pomodoro Focus Mode are wired through Core, the WebSocket delivery path and Settings; every check is simulated (injected clock and rendered components). **Not built:** an OS DND reader, region-capture adapter, Linear/Jira/GitHub issue client with create, and `ScreenshotIssue` mounting. Nothing real was captured; neither exit criterion is met |
| Depends on | [Phase 26 — Issue Tracker Capabilities & v0.2 Release](phase-26-issue-tracker-capabilities.md) |
| Unblocks | — |

## Goal

Quiet Fawkes on demand, and turn what is on screen into an issue.

## Tasks

- [ ] Focus mode: holds live notification display/push delivery except approvals and errors; optional Pomodoro with a selected duration. `FocusController` is constructed by `PhoenixRuntime`; `notification.created` stays durable, then only its WebSocket display/push delivery passes through the gate as `focus.notification.deliver`. `FocusMode` is mounted in Settings with start, stop and a 1–1440 minute Pomodoro. Approval (`requires_action`) and error notifications bypass it; held normal notifications flush in order after stop or timer expiry. Simulated (real Core and WebSocket with fakes). Unticked: no real desktop notification surface was observed.
- [ ] Respects OS focus/do-not-disturb where readable. Held notifications are released only on an affirmative DND-off reading; an unknown reading after DND was on keeps holding (regression test added). Unticked because **no OS DND reader exists**; only an injected fake was used.
- [ ] Capture a screen region, annotate (arrow, box, text), redact, attach to a draft issue for GitHub/Linear/Jira (Phase 26). `ScreenshotDraft` checks permission before capture and redaction fills pixels; components take injected props. Simulated. Unticked because **no region-capture adapter and no issue client with create exist** and `ScreenshotIssue` is not mounted.
- [ ] Issue is created only with approval. Creation happens only after `client.approve()`. Simulated with a fake client. Unticked: no real issue client exists, so nothing real was created.

## Deliverables

- Focus mode: `FocusController` (`core/runtime/src/focus`), authenticated `GET/POST/DELETE /api/focus`, focus-gated WebSocket delivery, and the mounted `FocusMode.tsx` Settings section. Simulated evidence only.
- Capture + annotate tool: `ScreenshotDraft` (`apps/web/src/core/screenshot.ts`) and `ScreenshotIssue.tsx`, built but not wired or mounted; [focus-and-screenshot.md](../focus-and-screenshot.md).

## Exit criteria

- [ ] Focus mode holds a normal notification and lets an approval through. **Simulated only:** a real Core held an ordinary notification's live WebSocket delivery while preserving it in stored history, then immediately delivered an approval and an error and released the ordinary notification after stop. No real desktop notification surface was observed.
- [ ] A screenshot becomes a real draft issue. **Unmet.** Nothing real was captured and no issue client with create exists.

## Implementation notes

### What was built

- **FocusController and Core wiring**: manual or Pomodoro focus with an injected clock and read-only DND seam. Core supplies an unavailable DND reader (`null`) until a platform adapter exists, subscribes to `notification.created`, preserves the source event's `requires_action` only in the ephemeral delivery payload, and publishes permitted entries as `focus.notification.deliver` on the notification WebSocket channel. The stored notification/history is never withheld. Approvals and errors always pass; ordinary held notifications are released in order after manual stop or timer expiry.
- **ScreenshotDraft**: permission check before capture, redaction fills pixels, issue creation only after `client.approve()`.
- **Web and docs**: `FocusMode.tsx` is mounted in Settings and reads the Core snapshot; it explicitly says system DND is unavailable and controls Phoenix notifications only. `ScreenshotIssue.tsx` remains injectable and unmounted. `focus.*` interface strings are English plus nine machine-translated, unreviewed locales; [focus-and-screenshot.md](../focus-and-screenshot.md). No new dependency or migration.
- **Persistence**: `FocusController` takes an optional `FocusStore` (`focus.session` key in `SettingsStore`, wired by `PhoenixRuntime`); `restore()` runs at `start()`. No new dependency or migration.

### Deviations

- Focus is a display/push delivery gate. It does not hide durable history, read or change OS DND, or delay a reconnect's history reload. The default DND value is unavailable. Screenshot capture and issue creation remain unwired.
- An active manual or Pomodoro session persists across a Core restart in the settings store (`focus.session`: version, mode, absolute end instant), is strictly validated on load and resumed with the remaining time; expired, corrupt or hostile values are ignored and cleared, and stop or expiry clears it. Held (queued) ordinary notifications are in memory only and are not restored; they remain in durable history. On connect, reload or reconnect the Settings control re-reads `GET /api/focus`. Simulated evidence only: `core/runtime/test/focus-persistence.test.ts` (real `PhoenixRuntime` restarts on one SQLite file, injected clock) and `apps/web/test/focus-mode.test.tsx` (fake WebSocket).

### Security review

A static read-only review by tools (not a human audit) was followed by fixes, each with tests, including the unknown-DND-reading regression above.

### What was not built

An OS DND reader, a region-capture adapter, Linear/Jira/GitHub issue clients with create, and mounting of `ScreenshotIssue`.

### What was not run

Any real capture, OS do-not-disturb reading, desktop notification hold, or issue creation. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
