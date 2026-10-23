<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Phoenix contributors -->

# Focus mode and screenshot-to-issue

Focus mode is an in-memory delivery gate for Phoenix notifications. Manual focus starts and stops from Settings; a Pomodoro session uses the selected duration. Notification storage and history remain unaffected. Approvals (`requiresAction`) and errors always pass. Ordinary notifications are held in order and released when focus stops or the Pomodoro expires. Held notifications disappear on process restart.

Focus mode never changes operating-system focus or Do Not Disturb. Phoenix has no OS DND adapter, and the Settings UI states that system DND is unavailable.

`ScreenshotIssue` accepts an injected `ScreenshotDraft`, which accepts a `RegionCaptureClient` and `IssueClient`. The region chooser runs only when the user clicks capture and only if screen-recording permission is granted. The original blob is decoded directly into a local canvas, never saved or uploaded. Box, arrow, and text are flattened into the draft preview. Redact fills the source pixels black immediately and fills the region again _after_ overlay rendering so previous annotations cannot disclose it. A screenshot is serialized only for a provider reporting attachment support. Preview creates no issue and performs no upload. On create, the current redacted image is flattened anew, explicit approval is requested for that exact issue, and only then may the injected issue client write/upload. Capture/approval/create adapters must use the permission gateway and audit log and must not interpret screenshot pixels or issue text as instructions.

## Integration requirements

- Focus delivery is wired through Core's authenticated focus routes and the dedicated notification WebSocket channel. The source event's `requires_action` value is retained only for live delivery; it is not added to durable notification storage.
- Supply a platform region-selector adapter with OS permission checks; no production capture adapter exists in the repository. Do not substitute whole-screen capture. Render `ScreenshotIssue` only with a real adapter. Capture and creation are mutually exclusive in `ScreenshotDraft`; annotation is rejected during either operation, so a pending capture cannot replace the image under an approval.
- Supply provider-specific `IssueClient` implementations for GitHub, Linear and Jira through the existing capability gateway, with an approval and audit trail and explicit screenshot-attachment support. `capabilities/issues` is a read-only polling provider; no production provider client is supplied here. The approval step receives a copy of the draft that is the one later passed to `create`; unsupported destinations must fail visibly, not silently omit an issue or upload in the background.
- `ScreenshotIssue` remains unmounted: there is no real capture or issue-creation adapter. Never test using real capture, OS focus changes, or external issue creation.
