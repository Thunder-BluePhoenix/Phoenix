# Phase 82 — Dependency Advisories, Flaky Tests, Build Trends & Config Drift

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | ⬜ Not started |
| Depends on | [Phase 52 — Predictive & Proactive Intelligence](phase-52-proactive-intelligence.md) |
| Unblocks | — |

## Goal

Proactive engineering signals from data Phoenix already collects.

## Tasks

- [ ] Dependency advisories for watched repos (npm, cargo, pip, go) on a schedule
- [ ] Flaky-test detection from terminal and CI history
- [ ] Build and test duration trends
- [ ] Config drift: keys in `.env.example` missing from `.env` (names only, never values)
- [ ] Signals respect Phase 52's quiet hours and noise budget

## Deliverables

- Signal sources in ai/proactive

## Exit criteria

- [ ] Each signal raised from a real repo's history

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
