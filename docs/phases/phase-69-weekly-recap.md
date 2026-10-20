# Phase 69 — Weekly Recap & Statistics

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | Low |
| Status | 🟨 Recap numbers, the `#/recap` page and a 1080 × 1920 image export built; the numbers match a seeded test week (including a clock change), but no real week and no real agent hook was observed, the PNG was only built with fake canvas objects, and there is no "every Monday" notification and no real GitHub contribution calendar (the grid is local commit counts); exit criterion met against seeded recorders only |
| Depends on | [Phase 38 — Knowledge Graph & Provenance](phase-38-knowledge-graph-and-provenance.md) |
| Unblocks | [Phase 84 — Standup & End-of-Day Digest](phase-84-standup-and-daily-digest.md) |

## Goal

A local summary of the week, shareable as an image.

## Tasks — parity with Coucou

- [ ] Every Monday: time coding, sessions, files, lines changed, commands, permissions, top agent and project, busiest day, longest session. All the numbers are built and tested (`core/runtime/test/recap.test.ts`, `apps/web/test/recap.test.tsx`), shown for any chosen Monday-start week at `#/recap`. The "every Monday" part is **not built**: there is no notification, because `ProactiveRuntime` supports only the Kage source and the `unassigned_action` kind and widening it needs a policy change; the recap is visible only when the person opens `#/recap`.
- [ ] Share image (1080 × 1920), project names optional. Built: `buildRecapSvg` and `downloadRecapPng` (SVG data URL → canvas → PNG, no dependency) and a "show project name" checkbox that is off by default, with the project name absent from the output while it is off (`apps/web/test/recap-image.test.ts`, `recap.test.tsx`). Left unticked because the PNG path was exercised only with fake `Image` and canvas objects, never in a real browser or webview.
- [x] All local. The numbers are counted in Core and stored in the local SQLite table `recap_daily` (migration 28); the page reads `GET /api/recap`; the data is in the privacy inventory and removed by delete-all (`recap.test.ts` "is listed in the privacy inventory and deleted by privacy delete-all…", "the stored rows hold counts and names only: no path, command or text"). Tested in-process only.

## Tasks — Phoenix improvements

- [x] Includes meetings, decisions and CI outcomes. Meetings and decisions come from the meetings tables **only while sensitive meeting data is allowed** (`allow_sensitive_meetings`); otherwise `meetings` is `null` ("leaves meetings and decisions out while sensitive meeting data is off"). CI outcomes are counted from `github.ci.*` events ("counts commits and CI from the events table once, from the owning capability only"). Deviation: these are read from the meetings tables and the events table, **not from the knowledge graph** as the phase text says.
- [ ] GitHub contribution grid. **Not built as written.** A real GitHub contribution calendar needs a token and the GraphQL API. What exists is a 53-week grid of **local** commit counts from `git.commit.created` events, for repositories the git capability watches, counted since Phoenix started counting (plus whatever the events table held at first start).

## Deliverables

- Recap view and image export: built (`apps/web/src/components/Recap.tsx`, `#/recap`), with week navigation and a delete-all button that needs a second click. The image export is untested in a real browser.

## Exit criteria

- [x] Recap numbers match the event history for a test week. Met **against seeded recorders only**, not a human-observed real week: `recap.test.ts` ("every number, including week boundaries on the DST change") seeds the week 2026-10-26..2026-11-01 in `America/New_York` (clocks go back), asserts every number and the week boundaries, and a second test covers an empty week. Steps were fed by `POST /api/agent/live/step` and direct `recordStep` calls; no real agent hook ran.

## Implementation notes

### What was built

- Migration 28 `recap_daily` (the migration head is now 28), `RecapStore`, `RecapRuntime` (`core/runtime/src/recap.ts`) and routes `GET /api/recap?week=YYYY-MM-DD` and `DELETE /api/recap?confirm=true`; `POST /api/privacy/delete` also accepts `{ data: "recap" }`. The privacy inventory has a "derived" row for it.
- `AgentLive` bumps counts for each step: steps, files, lines added and removed, commands (steps of kind `run`), sessions, coding seconds (gaps of five minutes or less), the longest session, per agent and per project. `git.commit.created` and `github.ci.*` events are counted once, from the owning capability only. Permissions granted and denied come from the audit log by timestamp.
- Weeks start on Monday; day keys are local and DST-safe (an injectable IANA time zone).
- Text on the page and in the image goes through the translation framework; Arabic is mirrored.

### Decisions and limits

- `recap_daily` stores the project folder name (last path segment) and the agent id. That is user-private data, which is why it is in the privacy inventory and is removed by delete-all, and why the image hides the project name unless asked.
- "Granted" counts only user decisions (`agent_approval.resolved` allowed and `confirmation.approved`); "Denied" is `agent_approval.resolved` denied plus `confirmation.rejected`, `expired` and `cancelled`. The lists are `GRANT_ACTIONS` and `DENY_ACTIONS` in `recap.ts` and are an owner decision.
- Retention is 800 days with an hourly maintenance pass. **800 days was chosen by the implementing agent, not by a product decision.**
- A session that resumes after a Core restart counts as a new session. Delete-all does not remove the audit-derived permission counts or the meeting counts (a note says so in the UI). Live session baselines reset on delete. Delete-all runs `secure_delete` and `wal_checkpoint(TRUNCATE)` on a best-effort basis; the truncate cannot happen if another connection holds a read lock.

### Security fixes that came from review

A static review (not a human audit) found that a token holder can forge `git.commit.created`, `github.ci.*` and agent steps and inflate the recap. This is documented, not closed (the simulator posts these on purpose). Mitigations added: events older than the retention window are dropped, lines per step are clamped at 100,000 and per session at 1,000,000, and the overflow bucket key `(other)` was renamed `(other name)` so a project cannot merge into it (rows written under the old `(other)` key were not migrated).

What was not done or not run: the "every Monday" notification; a real GitHub contribution calendar; any real agent session or a real week; the PNG in a real browser or webview (the Tauri CSP allowing `img-src data:` is assumed, not run). Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
