# Phase 77 — Agent Safety Net: Checkpoints, Rollback, Loop & Stall Detection

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | ⬜ Not started |
| Depends on | [Phase 57 — Universal Agent Relay & Hook Installers](phase-57-agent-relay-and-installers.md) |
| Unblocks | — |

## Goal

Every agent session can be undone, and Fawkes notices when an agent is stuck.

## Tasks

- [ ] Checkpoint before an agent's first edit: a git snapshot (stash-free ref or worktree) of the working tree, including untracked files
- [ ] One-click rollback of everything a session changed, with a preview diff and approval
- [ ] Loop detection: the same failing command N times, the same file edited back and forth
- [ ] Stall detection: waiting on the user for more than a set time, no activity for a set time
- [ ] Fawkes WARNING with the reason; optional notification
- [ ] Checkpoints expire on a retention setting and never touch the user's own branches or stashes

## Deliverables

- Checkpoint and rollback in capabilities/agents
- Loop/stall detectors

## Exit criteria

- [ ] A real agent session is rolled back exactly to its checkpoint
- [ ] A simulated loop and stall each raise a warning

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.
- Rollback is a write: it always needs approval.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
