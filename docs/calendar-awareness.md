<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Phoenix contributors -->

# Calendar awareness and meeting preparation

The read-only calendar capability supports injected Google Calendar, Microsoft Graph, CalDAV, and macOS Calendar adapters. A host must supply authenticated, consented clients or a permission-checked macOS runner; importing the capability does not contact providers. Calendar content is untrusted data, not instructions. Private events expose only a busy placeholder. Five-minute reminders are deduplicated per occurrence in process; this does not provide durable delivery after a restart.

Meeting preparation finds previous related meetings and reviewed decisions and open action items. The runtime query (`StoreMeetingPrepQuery`) reads accepted reviewed items of prior meetings with matching participants and is gated on `allow_sensitive_meetings`; project-only matching returns nothing because meetings carry no project field. No transcript is fetched for this feature. The notetaker button only navigates to `#/meetings`; it never starts a recording. Nothing turns a reminder into a notification yet.

A deploy freeze applies only when the user enables the calendar `freeze` setting (default false). When it is on, the `CapabilityManager` `preflight` hook runs after approval and before dispatch and refuses commands with side effect `production` and `vercel/redeploy` unless a fresh feed shows no freeze window; it fails closed (`SECURITY_POLICY_BLOCKED`) when the feed is missing, stale, unreadable or incomplete, or a credential is missing. In production no adapter is wired (`createCalendarCapability()` is called without adapters), so with the freeze on every such command is blocked. Not covered: agent permission-request approvals (AgentApprovals) and other external side effects (n8n, terminal). The host must still supply real consented provider feeds.

All present test evidence uses injected fake providers and store records; no live account or real calendar delivery has been exercised. Phase 83's exit criterion, **a real calendar event triggering a reminder and a prep note**, remains unmet until account integration and an end-to-end run are completed.

The feed fails closed. A configured provider with a missing credential, a failed or paginated read, truncation, or any unreadable event makes the whole feed unavailable; Core reports `status` as `unavailable` or `stale` and the page says so rather than "No upcoming meetings". The freeze snapshot always requests a fresh read. A blocked deploy raises `PhoenixError(SECURITY_POLICY_BLOCKED)`. Freeze markers are listed in `capabilities/calendar/README.md`.
