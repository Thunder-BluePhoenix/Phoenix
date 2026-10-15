# Phase 80 — Port & Process Radar

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | ⬜ Not started |
| Depends on | [Phase 18 — Terminal / Process Capability](phase-18-terminal-process-capability.md) |
| Unblocks | — |

## Goal

Know which dev servers and processes are running, and stop the forgotten ones.

## Tasks

- [ ] List listening ports with process, project and age (macOS, Linux, Windows)
- [ ] Flag forgotten servers (no activity, old) and heavy processes
- [ ] Stop or restart a process with approval; never system processes
- [ ] Open a local server's page in the Phoenix browser (Phase 93)

## Deliverables

- capabilities/ports

## Exit criteria

- [ ] Ports listed match `lsof`/`ss`/`netstat` on each OS
- [ ] Stopping a process requires approval and is audited

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
