# Phase 85 — Focus Mode & Screenshot-to-Issue

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | 🟨 Manual and Pomodoro Focus Mode are wired through Core, the WebSocket delivery path and Settings; every check is simulated (injected clock and rendered components). A GitHub issue can be drafted from an image the user already has (Settings, `ImageIssueSection`, text-only through `github` `issue.create` with Core's confirmation), simulated against a fake Core. Text-only `linear.issue.create` and `jira.issue.create` exist in the `issues` capability (confirmed, audited, fake `fetch` only; no UI uses them). A macOS-only region-capture adapter (`capabilities/screen-region`, stock `screencapture` via `execFile`, confirmed per use) now backs the mounted capture/annotate `ScreenshotIssue` (`ScreenshotIssueSection` in Settings), text-only GitHub issue, fake runner and fake Core only. **Not built:** an OS DND reader, region capture on any platform other than macOS, and any image attachment to a tracker. Nothing real was captured or created, and the real `screencapture` was never run; neither exit criterion is met |
| Depends on | [Phase 26 — Issue Tracker Capabilities & v0.2 Release](phase-26-issue-tracker-capabilities.md) |
| Unblocks | — |

## Goal

Quiet Fawkes on demand, and turn what is on screen into an issue.

## Tasks

- [ ] Focus mode: holds live notification display/push delivery except approvals and errors; optional Pomodoro with a selected duration. `FocusController` is constructed by `PhoenixRuntime`; `notification.created` stays durable, then only its WebSocket display/push delivery passes through the gate as `focus.notification.deliver`. `FocusMode` is mounted in Settings with start, stop and a 1–1440 minute Pomodoro. Approval (`requires_action`) and error notifications bypass it; held normal notifications flush in order after stop or timer expiry. Simulated (real Core and WebSocket with fakes). Unticked: no real desktop notification surface was observed.
- [ ] Respects OS focus/do-not-disturb where readable. Held notifications are released only on an affirmative DND-off reading; an unknown reading after DND was on keeps holding (regression test added). Unticked because **no OS DND reader exists**; only an injected fake was used.
- [ ] Capture a screen region, annotate (arrow, box, text), redact, attach to a draft issue for GitHub/Linear/Jira (Phase 26). `ScreenshotDraft` checks permission before capture and redaction fills pixels; components take injected props. Simulated. Unticked because **the macOS region-capture adapter and the mounted `ScreenshotIssue` were only ever run against a fake runner and a fake Core (never on a real Mac or with a real Screen Recording permission), there is no adapter for other platforms, Linear and Jira image attachment is built but only fake-tested, and GitHub has no documented upload endpoint**. Partly reachable and built: a user-supplied image can be previewed and turned into a text-only GitHub issue draft (see Deliverables), and text-only Linear/Jira create commands exist (fake-tested); the image is not attached anywhere.
- [ ] Issue is created only with approval. For the mounted image flow, `github` `issue.create` is an `external` command: Core raises the confirmation and the UI only waits and reports Core's outcome (simulated with a fake Core; the UI never calls `/api/confirmations`). Unticked: nothing real was created, and the capture component's `client.approve()` path still has only a fake client.

## Deliverables

- Focus mode: `FocusController` (`core/runtime/src/focus`), authenticated `GET/POST/DELETE /api/focus`, focus-gated WebSocket delivery, and the mounted `FocusMode.tsx` Settings section. Simulated evidence only.
- Capture + annotate tool: `ScreenshotDraft` (`apps/web/src/core/screenshot.ts`) and `ScreenshotIssue.tsx`, mounted in Settings by `ScreenshotIssueSection` over the new `screen-region` capability (macOS only, `capture_region` confirmed every time, temp file in a 0700 directory, PNG and 5 MiB validation, cleanup on every path, image blanked after 60 s, other platforms unsupported); `apps/web/src/core/screen-region.ts`, `capabilities/screen-region/test/screen-region.test.ts`, `apps/web/test/screenshot-region.test.tsx`; [focus-and-screenshot.md](../focus-and-screenshot.md). Fakes only; `screenRegion.*` strings are English plus nine machine-translated, unreviewed locales.
- Image to GitHub issue draft: `ImageIssueSection` (`apps/web/src/components/ImageIssue.tsx`, `apps/web/src/core/image-issue.ts`), mounted in Settings. The user drops, pastes or chooses a PNG/JPEG (existing attachment checks), writes title and description, picks a `owner/name` repository, reviews a preview that equals the posted `issue.create` input and states that the image stays local, and confirms; Core then asks for its own confirmation. Secret-looking text is blocked by `findSecrets` before any request; text is cleaned. Tests: `apps/web/test/image-issue.test.tsx` (fake Core). `focus.issueDraft.*` strings are English plus nine machine-translated, unreviewed locales. No new dependency or migration.
- Linear and Jira create commands: `issues` `linear.issue.create` and `jira.issue.create` (`capabilities/issues/src/create.ts`, manifest `0.2.0`, permissions now `network` + `external_api`, `list` still declares none). `external`, so Core confirms every call (card: team/project, title, start of description) and its audit log records request, decision, authorisation and outcome; separate write-only secrets (`linear_write_key`, `jira_write_email`, `jira_write_token`); Linear host pinned to `api.linear.app`, Jira to the owner-set `config.create.jira_site` (https `*.atlassian.net`, checked by the config schema and again at call time); no redirects, 15 s timeout, 256 KiB reply cap, fixed secret-free errors; only `{ tracker, id, key, url }` returned after the url is checked (Linear) or built from the pinned site (Jira). **Text only: no image is attached or sent to any tracker.** No idempotency key. Tests: `capabilities/issues/test/create.test.ts` (fake `fetch`; nothing real was contacted). See [creating tasks](../capabilities/creating-tasks.md).
- Attach the redacted screenshot to a Linear or Jira issue: `issues` `jira.issue.attach` and `linear.issue.attach` (`capabilities/issues/src/attach.ts`), two separate `external` commands (Core confirms each call; the card shows the issue key, the generated file name, the byte size and a content-hash prefix). Base64 PNG only, validated with the capture adapter's `inspectPng` (signature, IHDR, IEND, 5 MiB), file name generated from the content hash and never taken from input, the confirmation fields recomputed from the bytes and refused on a mismatch, the existing write-only credentials, no redirects, timeouts, 256 KiB reply cap, fixed secret-free errors, audit by Core. Jira: multipart `POST /rest/api/3/issue/{key}/attachments` with `X-Atlassian-Token: no-check` (Atlassian's "Add attachment" reference). Linear: issue lookup, `fileUpload` mutation, one `PUT` of the bytes to the signed URL (accepted only on `storage.googleapis.com` or a single-label `<bucket>.storage.googleapis.com`, https, no port, credentials, fragment or dot segments, headers from a short allow-list, our key never sent there, the URL never logged or returned), then `attachmentCreate` with the `https://uploads.linear.app` asset URL (Linear's "How to upload a file to Linear" guide). **GitHub has no attach command: it has no documented REST endpoint for an issue image, and Phoenix does not use the undocumented web upload endpoints.** Core's API gives exactly those two command paths a 7 MiB body (`ISSUE_ATTACH_BODY_MAX_BYTES`, `core/api/src/http.ts`). The screenshot flow (`ScreenshotDraft.prepareAttachment` / `attachApproved`, `apps/web/src/core/issue-attach.ts`, `createCoreIssueClient`) now also creates Linear and Jira issues as text through the create commands and then offers the attachment as a second step: show exactly what would be sent (file name, size, hash), tick a confirmation, press "Request approval and attach", and Core asks again; the image is re-flattened and must hash to the same bytes that were shown. Tests: `capabilities/issues/test/attach.test.ts` (fake `fetch`: multipart body shape, host pinning, a signed-URL validation table, hostile replies, secrets and the signed URL never in an output), `core/runtime/test/issue-attach-wiring.test.ts` (real Core, body limit), `apps/web/test/screenshot-attach.test.tsx` and `screenshot.test.ts` (fake Core). `screenRegion.*` and `focus.screenshot.*` strings changed in English and nine machine-translated, unreviewed locales. Inventory: `docs/licenses/INVENTORY.md`. **No real Jira site, Linear workspace, Google Cloud Storage bucket or account was contacted.**

## Exit criteria

- [ ] Focus mode holds a normal notification and lets an approval through. **Simulated only:** a real Core held an ordinary notification's live WebSocket delivery while preserving it in stored history, then immediately delivered an approval and an error and released the ordinary notification after stop. No real desktop notification surface was observed.
- [ ] A screenshot becomes a real draft issue. **Unmet.** Nothing real was captured (the macOS region-capture adapter exists but was never run on a real Mac) and nothing real was created. A GitHub `issue.create` exists and the mounted image flow drives it from a user-supplied image, text only, tested against a fake Core. `issues` `linear.issue.create` and `jira.issue.create` now exist (text only, fake `fetch` only) but the screenshot flow now drives them and the optional attach step (see Deliverables), but only against fakes; no real Linear or Jira was contacted.

## Implementation notes

### What was built

- **FocusController and Core wiring**: manual or Pomodoro focus with an injected clock and read-only DND seam. Core now injects the read-only Linux (GNOME `gsettings`, KDE `gdbus` `Inhibited`) OS Do Not Disturb reader from `core/runtime/src/focus/os-dnd.ts` (polled once a minute, never run on a real desktop; macOS and Windows stay unknown, see [focus-and-screenshot](../focus-and-screenshot.md)), subscribes to `notification.created`, preserves the source event's `requires_action` only in the ephemeral delivery payload, and publishes permitted entries as `focus.notification.deliver` on the notification WebSocket channel. The stored notification/history is never withheld. Approvals and errors always pass; ordinary held notifications are released in order after manual stop or timer expiry.
- **ScreenshotDraft**: permission check before capture, redaction fills pixels, issue creation only after `client.approve()`.
- **Web and docs**: `FocusMode.tsx` is mounted in Settings and reads the Core snapshot; it explicitly says system DND is unavailable and controls Phoenix notifications only. `ImageIssue.tsx` is mounted in Settings (see Deliverables). `ScreenshotIssue.tsx` (capture/annotate) is mounted by `ScreenshotIssueSection` over the `screen-region` capability (macOS only; fakes only). `focus.*` interface strings are English plus nine machine-translated, unreviewed locales; [focus-and-screenshot.md](../focus-and-screenshot.md). No new dependency or migration.
- **Persistence**: `FocusController` takes an optional `FocusStore` (`focus.session` key in `SettingsStore`, wired by `PhoenixRuntime`); `restore()` runs at `start()`. No new dependency or migration.

### Deviations

- Focus is a display/push delivery gate. It does not hide durable history, read or change OS DND, or delay a reconnect's history reload. The default DND value is unavailable. Screenshot capture and issue creation remain unwired.
- An active manual or Pomodoro session persists across a Core restart in the settings store (`focus.session`: version, mode, absolute end instant), is strictly validated on load and resumed with the remaining time; expired, corrupt or hostile values are ignored and cleared, and stop or expiry clears it. Held (queued) ordinary notifications are in memory only and are not restored; they remain in durable history. On connect, reload or reconnect the Settings control re-reads `GET /api/focus`. Simulated evidence only: `core/runtime/test/focus-persistence.test.ts` (real `PhoenixRuntime` restarts on one SQLite file, injected clock) and `apps/web/test/focus-mode.test.tsx` (fake WebSocket).

### Security review

A static read-only review by tools (not a human audit) was followed by fixes, each with tests, including the unknown-DND-reading regression above.

### What was not built

- **OS Do Not Disturb on macOS and Windows.** macOS: the only public API (`INFocusStatusCenter`) needs a native app plus a user authorisation prompt and cannot be reached from Core's Node process; the Focus database and `defaults` keys are private and are not read. Windows: Focus Assist has no documented read API (`SHQueryUserNotificationState` does not report it; WNF is undocumented). Both report `unknown` with a fixed reason.

An OS DND reader, a region-capture adapter for any platform other than macOS, and attaching an image to a GitHub issue (no documented endpoint exists, so it stays text only). Linear and Jira attachment is built but never run against a real tracker.

### What was not run

Any real capture (the real `screencapture` and a real Screen Recording permission were never involved), OS do-not-disturb reading, desktop notification hold, or issue creation. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
