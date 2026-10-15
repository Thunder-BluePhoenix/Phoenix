# Phase 81 — Machine Health & Local Model Manager

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | ⬜ Not started |
| Depends on | [Phase 27 — Model Adapter & Router](phase-27-model-adapter-and-router.md) |
| Unblocks | — |

## Goal

Machine health in Fawkes, and local models that fit your machine.

## Tasks

- [ ] Disk space, memory pressure, CPU, battery and temperature with thresholds → Fawkes WARNING
- [ ] Local model manager for Ollama/LM Studio: list, download, remove, run
- [ ] Fit check before download: model size vs free memory and disk
- [ ] Clean-up suggestions (old models, caches) with approval

## Deliverables

- capabilities/machine
- Model manager UI

## Exit criteria

- [ ] Low-disk warning fires on a simulated threshold
- [ ] A model is downloaded and removed through Phoenix

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
