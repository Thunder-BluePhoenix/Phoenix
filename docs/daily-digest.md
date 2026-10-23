<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

# Daily digest (Phase 84)

The read-only standup and end-of-day view groups _observed_ items by local calendar day. Yesterday contains completed observations, today contains explicitly planned work, blockers contain explicit failure/blockage events that nothing later resolved, and end-of-day contains today's completed and blocked observations. The default generator is deterministic and local: it does not call a model or cloud service. Untrusted titles are displayed as data, never executed as prompts, and are sanitised (control, line-break and bidi/format characters removed, whitespace collapsed, clipped to 200 characters) in the model and again in the copied text.

## Sources and how each line is cited

- **Commits** from explicitly watched repositories, read with a bounded, argv-only `git log` (no shell, hooks, remote access or writes). Only the user's own work is shown: commits whose **author email equals the repository's configured `user.email`** (read-only `git config --get user.email`), **no merges**, dated by the **author date** (the committer date moves on a rebase and can be set to anything). With no identity configured, commits are left out and the digest says so (`unattributed`). Each line links to `#/digest/commit/<sha>`, an in-app page that loads `GET /api/digest/commit/:sha` with the session token; a plain link to the API would be refused (401).
- **Events** (GitHub CI, issues, agents) are read from the stored event history. They are labelled **Unverified event ·** and link to `#/digest/event/<event id>` (`GET /api/digest/event/:id`, `verified: false`), a local evidence page. Payload URLs (`payload.url`) are never followed or shown. The `github` and `issues` sources and `github.` / `issues.` types are reserved on `POST /api/events`. The `terminal` source is reserved only if you turn that on (`PUT /api/events/source-policy {"reserveTerminal":true}`, off by default); other sources can still be posted, so a forged event can appear as an unverified line.
- **Completed agent sessions** link to `#/agents/<id>`. The project folder name is **omitted unless `projectNames()` returns true**; the recap has no project-name setting to reuse (its share image has a per-export choice, off by default), so the service defaults to off and the runtime may pass a setting later.
- **Meetings** link to `#/meetings/<id>` and are read only while sensitive meeting access is enabled.

A blocker (failed CI, waiting agent) ends when a later item about the same subject is not blocked: a pass of the same repository + workflow + branch, or an agent session working or completing again. A past day is judged as it stood at the end of that day.

## Incomplete digests are never shown as empty days

`DailyDigest` carries three lists of source names (`git`, `events`, `sessions`, `meetings`): `unavailable` (could not be read: a failing repository or store), `partial` (a window limit was reached: 1000 events, 500 meetings, 500 commits per repository) and `unattributed` (git has no identity). The page shows a labelled notice above the sections, empty sections then say "Nothing found in the sources that could be read", and the copied text starts with the same notices.

## Slack delivery

Daily-digest Slack delivery is an independently opted-in, user-triggered action. It is off by default and reuses only the existing Chat Approvals Slack channel and bot token; it does **not** use Phase 86's `post_digest`, which remains a counts-only approval digest. `GET`/`PUT /api/digest/slack` exposes and changes only the separate opt-in. `POST /api/digest/slack` or `POST /api/digest/:day/slack` accepts no content, token, channel or URL: Core regenerates the cited digest, shows a bounded preview and cited-source count in a mandatory `network`/`external_api` confirmation, then posts through the guarded fixed-host Slack transport after approval. The kill switch fails closed before a request and every outcome is audited. There are no automatic retries or schedules, and there is no Teams or Discord daily-digest delivery.

The UI explains that cited activity, unverified event claims and potentially meeting-derived content leave the device. Existing Chat Approvals configuration is a prerequisite; this page never accepts a token or channel. Delivery has only been exercised with injected fakes: no real Slack message or workspace testing is claimed.

## Wiring

`DailyDigestService` takes an injected clock, IANA time zone, watched repository paths, events, live sessions, a permission-gated meeting reader, an optional `projectNames()` and an optional git runner. Routes: `GET /api/digest?day=YYYY-MM-DD`, `GET /api/digest/commit/:sha`, `GET /api/digest/event/:id`, all authenticated and read-only. Pages: `DailyDigestPage` (`#/digest`), `DailyDigestEventPage` (`#/digest/event/:id`), `DailyDigestCommitPage` (`#/digest/commit/:sha`). No migration or new dependency is needed. Copy exports every line with its source citation and performs no external write. No real day of work has been checked against the digest, so the Phase 84 exit criterion remains open.

Retained event history limits what can appear; a pruned original event cannot be cited. This capability does not infer future plans from yesterday's activity.
