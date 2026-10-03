# Phase 18 — Terminal / Process Capability

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | High |
| Status | ✅ Done |
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

- [x] Provide opt-in shell integration (e.g. `phoenix run <cmd>` and shell hooks)
- [x] Emit command.started / completed / failed and build.started/passed/failed
- [x] Redact secrets from captured command lines
- [x] Link failure event to short output excerpt (local only)
- [x] Tests for exit-code mapping

## Deliverables

- capabilities/terminal

## Exit criteria

- [x] A failing build makes Fawkes enter ERROR with readable text (US-03 with real data)

## Implementation notes

- Builtin capability `terminal` with one command, `report` (side effect `none`), and the `phoenix run` CLI (`capabilities/terminal/src/cli.ts`) that runs the user's command without a shell, tees its output, and reports start/finish to Core.
- Kind (`build`/`test`/`command`) is guessed from the command line; `--kind` overrides. Capability state rules make failures read "Build failed: <command>".
- Secrets are redacted in the CLI (Core rejects command input containing secrets) and again in the capability. Failure excerpts are the last 20 lines, at most 2 000 characters, kept in the local event store only.
- Successful no-side-effect commands now publish `capability.command.completed` ephemerally, so terminal reports do not flood the activity feed; the audit log still records them.
- Shell hooks (zsh `preexec`/`precmd`) were not built: reporting every `ls`/`cd` would make Fawkes flicker. Add them behind an allowlist if users ask.

## Notes & risks

- Observation only — no shell execution by Phoenix in MVP.

## Source documents

- Full System PRD v2.0 §22 Phase 6
- Fawkes PRD v1.0 §10

---
Back to [TRACKER](TRACKER.md)
