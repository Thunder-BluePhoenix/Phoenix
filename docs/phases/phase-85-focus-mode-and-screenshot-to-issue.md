# Phase 85 — Focus Mode & Screenshot-to-Issue

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | 🟨 Built as injectable components; every check is simulated (injected clock, DND reader, capture and issue clients). **Not wired:** `FocusController` is not in the notification delivery path, there is no OS DND reader, no region-capture adapter and no Linear/Jira/GitHub issue client with create, and `FocusMode` and `ScreenshotIssue` are not mounted anywhere. Nothing real was captured; neither exit criterion is met |
| Depends on | [Phase 26 — Issue Tracker Capabilities & v0.2 Release](phase-26-issue-tracker-capabilities.md) |
| Unblocks | — |

## Goal

Quiet Fawkes on demand, and turn what is on screen into an issue.

## Tasks

- [ ] Focus mode: holds notifications except approvals and errors; optional Pomodoro with Fawkes timer. `FocusController` (manual and Pomodoro, injected clock, DND reader and deliver function) lets approvals and errors always pass ([focus-and-screenshot.md](../focus-and-screenshot.md)). Simulated. Unticked because it is **not in the notification delivery path** and `FocusMode` is not mounted.
- [ ] Respects OS focus/do-not-disturb where readable. Held notifications are released only on an affirmative DND-off reading; an unknown reading after DND was on keeps holding (regression test added). Unticked because **no OS DND reader exists**; only an injected fake was used.
- [ ] Capture a screen region, annotate (arrow, box, text), redact, attach to a draft issue for GitHub/Linear/Jira (Phase 26). `ScreenshotDraft` checks permission before capture and redaction fills pixels; components take injected props. Simulated. Unticked because **no region-capture adapter and no issue client with create exist** and `ScreenshotIssue` is not mounted.
- [ ] Issue is created only with approval. Creation happens only after `client.approve()`. Simulated with a fake client. Unticked: no real issue client exists, so nothing real was created.

## Deliverables

- Focus mode: `FocusController` (`core/runtime/src/focus`) and `FocusMode.tsx`, built but not wired or mounted; simulated evidence only.
- Capture + annotate tool: `ScreenshotDraft` (`apps/web/src/core/screenshot.ts`) and `ScreenshotIssue.tsx`, built but not wired or mounted; [focus-and-screenshot.md](../focus-and-screenshot.md).

## Exit criteria

- [ ] Focus mode holds a normal notification and lets an approval through. **Simulated only:** the injected `FocusController` held a normal notification and passed an approval and an error. It does not do so in the running app because it is not in the delivery path.
- [ ] A screenshot becomes a real draft issue. **Unmet.** Nothing real was captured and no issue client with create exists.

## Implementation notes

### What was built

- **FocusController**: manual or Pomodoro focus with an injected clock, DND reader and deliver function; approvals and errors always pass; held notifications are released only on an affirmative DND-off reading, and an unknown reading after DND was on keeps holding (regression test added).
- **ScreenshotDraft**: permission check before capture, redaction fills pixels, issue creation only after `client.approve()`.
- **Web and docs**: `FocusMode.tsx` and `ScreenshotIssue.tsx` take injected props; `focus.*` interface strings (English plus nine machine-translated, unreviewed locales); [focus-and-screenshot.md](../focus-and-screenshot.md). No new dependency, no migration.

### Deviations

- Both components are injectable and not wired into the app: the notification delivery path, an OS DND reader, a region-capture adapter and an issue client with create are all missing.

### Security review

A static read-only review by tools (not a human audit) was followed by fixes, each with tests, including the unknown-DND-reading regression above.

### What was not built

The delivery-path wiring, an OS DND reader, a region-capture adapter, Linear/Jira/GitHub issue clients with create, and mounting of `FocusMode` and `ScreenshotIssue`.

### What was not run

Any real capture, OS do-not-disturb reading, notification hold in the running app, or issue creation. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
