# Phase 18 — Terminal / Process Capability

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | High |
| Status | ⬜ Not started |
| Depends on | [Phase 13 — Capability SDK, Mock Capability & Event Simulator](phase-13-capability-sdk-mock-simulator.md) |
| Unblocks | [Phase 20 — Hardening, E2E, Observability & v0.1 Release](phase-20-hardening-and-v0-1-release.md) |

## Goal

Surface build/test/command lifecycle from the terminal so Fawkes shows WORKING / SUCCESS / ERROR for real work.

## Scope

**In scope**

- Shell wrapper / hook that reports command start/finish/exit code
- build.* and test events

**Out of scope**

- Phoenix executing arbitrary shell commands

## Tasks

- [ ] Provide opt-in shell integration (e.g. `phoenix run <cmd>` and shell hooks)
- [ ] Emit command.started / completed / failed and build.started/passed/failed
- [ ] Redact secrets from captured command lines
- [ ] Link failure event to short output excerpt (local only)
- [ ] Tests for exit-code mapping

## Deliverables

- capabilities/terminal

## Exit criteria

- [ ] A failing build makes Fawkes enter ERROR with readable text (US-03 with real data)

## Notes & risks

- Observation only — no shell execution by Phoenix in MVP.

## Source documents

- Full System PRD v2.0 §22 Phase 6
- Fawkes PRD v1.0 §10

---
Back to [TRACKER](TRACKER.md)
