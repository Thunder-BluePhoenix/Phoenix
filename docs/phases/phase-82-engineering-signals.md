# Phase 82 — Dependency Advisories, Flaky Tests, Build Trends & Config Drift

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | 🟨 Built; every check is simulated (temporary repositories, injected fakes). The advisory provider is always unavailable in production, the history provider can only yield job-level duration trends, and no screen can opt in to engineering signals, so the "each signal raised from a real repo's history" criterion is not met |
| Depends on | [Phase 52 — Predictive & Proactive Intelligence](phase-52-proactive-intelligence.md) |
| Unblocks | — |

## Goal

Proactive engineering signals from data Phoenix already collects.

## Tasks

- [ ] Dependency advisories for watched repos (npm, cargo, pip, go) on a schedule. Exact pinned versions are read from top-level `package.json`, `Cargo.lock`, `requirements.txt` and `go.mod` and passed to an injected advisory provider ([engineering-signals.md](../engineering-signals.md)). Unticked because **the advisory provider is always unavailable in production** (no approved local advisory database; nothing contacts the network), so advisory signals never fire.
- [ ] Flaky-test detection from terminal and CI history. Implemented over an injected history source and tested with fixtures. Unticked because the production history provider reads only the last 1000 terminal events and yields job-level duration trends only, so flaky-test and CI signals cannot fire from it.
- [ ] Build and test duration trends. Median comparison over recent runs, tested with fixtures; job-level trends are the only kind the production history provider can produce. Unticked: no real repository history was used.
- [ ] Config drift: keys in `.env.example` missing from `.env` (names only, never values). Names only, never values; files opened with `O_NOFOLLOW` and an inode check, top-level only. Tested on temporary directories. Unticked: no real repository was scanned.
- [ ] Signals respect Phase 52's quiet hours and noise budget. Delivery goes through the Phase 52 `considerInsight` (quiet hours, dedupe, hourly budget); simulated. Unticked: it also needs a user opt-in, and **no UI can write the `engineering-signals` opt-in** (the web `ProactiveSettings` writes only `["kage"]` or `[]`).

## Deliverables

- Signal sources in ai/proactive: built (`ai/proactive/src/engineering`, `core/runtime/src/engineering-signals`, `core/api/src/engineering-signals-routes.ts`, `EngineeringSignals` in Settings, [engineering-signals.md](../engineering-signals.md)); simulated evidence only.

## Exit criteria

- [ ] Each signal raised from a real repo's history. **Unmet.** Advisory signals cannot fire in production, flaky-test and CI signals cannot fire from the production history provider, and no real repository history was used.

## Implementation notes

### What was built

- **Signals**: `advisory` (exact pinned versions for npm, cargo, pip and go), `flaky_test`, `duration_trend` and `config_drift`. Files are opened `O_NOFOLLOW` with an inode check, top level only. Caps: 500 names per file, names of at most 128 characters, at most 500 drift signals per root, linear `go.mod` comment stripping, lines over 1 KiB skipped.
- **Core**: `GET /api/engineering-signals` (manual read-only scan; returns provider availability) and `PUT /api/engineering-signals/watched-roots` (`{ watchedRoots }`). Roots are stored under the settings key `engineering-signals.watched-roots` (listed in the privacy inventory as `engineering_signals_roots`).
- **Scheduler**: starts with Core and runs only if the `engineering-signals` capability id is opted in with a cadence set in the proactive preferences and the kill switch is off; it stops on opt-out (`ProactiveRuntime.setPreferences` calls `consentChanged`) or on the kill switch. Delivery goes through Phase 52 `considerInsight` (quiet hours, dedupe, hourly budget).
- **Web and docs**: `EngineeringSignals` in Settings shows an unavailable-provider notice instead of "no signals"; `signals.*` interface strings (English plus nine machine-translated, unreviewed locales). `ProactiveRuntime` now accepts the capability id `engineering-signals` and an `onPreferencesChanged` hook. No new dependency, no migration.

### Deviations

- The advisory provider is a permanent "unavailable" stub because no approved local advisory database exists.
- Core's `capabilityEnabled` is hard-wired to true (there is no capability manifest); the opt-in is the only gate.

### Security review

A static read-only review by tools (not a human audit) was followed by fixes, each with tests. **Not fixed (open):** terminal events are forgeable by any session-token holder (the `terminal` source is not reserved), which can feed the history provider.

### What was not built

A real advisory source; an end-to-end opt-in UI for engineering signals.

### What was not run

Any scan of a real repository's history, any real advisory lookup, any notification delivered from these signals. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
