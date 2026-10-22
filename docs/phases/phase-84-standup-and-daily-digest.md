# Phase 84 — Standup & End-of-Day Digest

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | 🟨 Built; every check is simulated (temporary git repositories, in-memory database, fakes). Sending to Slack or Teams is not built (Phase 86), and no real day of work was checked, so the "a standup generated from a real day's activity links each line to its source" criterion is not met |
| Depends on | [Phase 69 — Weekly Recap & Statistics](phase-69-weekly-recap.md) |
| Unblocks | — |

## Goal

Your standup and day summary, written from what actually happened.

## Tasks

- [ ] Yesterday / today / blockers from commits, agent sessions, meetings, CI and tasks. Sources: commits (read-only git, author equal to the repository's `user.email`, no merges, author date; none configured → "unattributed"), completed sessions (project name omitted), meetings (permission-gated) and stored events. Event-derived lines are labelled "Unverified event ·". Failed or partial sources are reported as unavailable, partial or unattributed notices. Stale blockers are cleared by a later pass or resume of the same subject. Tested with fixtures. Unticked because `terminal` and other sources can still be posted to `POST /api/events` (`github`, `issues` and `calendar` are reserved), so forged events can appear as unverified lines, and no real day was used.
- [ ] End-of-day digest. Routes `GET /api/digest?day=`, `/api/digest/commit/:sha`, `/api/digest/event/:id` (authenticated, read-only); pages `#/digest`, `#/digest/event/:id`, `#/digest/commit/:sha` ([daily-digest.md](../daily-digest.md)). Simulated. Unticked: not checked against a real day.
- [ ] Copy, or send to Slack/Teams with approval (Phase 86). Copy is built and performs no external write. **Send to Slack or Teams is not built** (Phase 86 does not exist).
- [ ] Local model by default; sources linked for every line. The digest is deterministic and local and calls no model. Every line links to a local evidence page (event pages ignore `payload.url`); titles are sanitised (control and bidi characters stripped, 200 characters). Unticked: no real day was checked, and the "model" part is not used at all.

## Deliverables

- Standup and digest views: built (`core/runtime/src/daily-digest`, `core/api/src/digest-routes.ts`, `DailyDigestPage` and its event and commit pages, Navbar link, [daily-digest.md](../daily-digest.md)); simulated evidence only.

## Exit criteria

- [ ] A standup generated from a real day's activity links each line to its source. **Unmet.** Source links are tested with fixtures only; no real day of work was digested.

## Implementation notes

### What was built

- **Routes and pages**: the three authenticated GET routes and the `#/digest`, `#/digest/event/:id`, `#/digest/commit/:sha` pages. Deterministic and local, no model.
- **Sources**: commits (read-only git; author is the repository's `user.email`; no merges; author date), sessions (project name omitted), meetings (permission-gated) and events labelled "Unverified event ·" with a local evidence page; `payload.url` is ignored.
- **Honesty**: unavailable, partial and unattributed notices; stale blockers cleared by a later pass or resume of the same subject; titles sanitised (control and bidi characters stripped, 200 characters).
- **Reserved sources**: the `github` and `issues` sources and `github.` / `issues.` types are now reserved on `POST /api/events` (failing-before test in `core/runtime/test/api.test.ts`).
- **Web and docs**: Navbar link and `#/digest*` routes, `digest.*` interface strings (English plus nine machine-translated, unreviewed locales). No new dependency, no migration.

### Deviations

- Send to Slack or Teams is not built; only Copy.
- No model is used, so there is no model summary.

### Security review

A static read-only review by tools (not a human audit) was followed by fixes, each with tests. **Not fixed (open):** `terminal` and other unreserved sources are still postable, so forged terminal events can appear as unverified lines.

### What was not built

Send to Slack or Teams (Phase 86).

### What was not run

A digest over a real day of work. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
