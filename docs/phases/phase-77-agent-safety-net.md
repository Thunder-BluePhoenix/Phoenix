# Phase 77 — Agent Safety Net: Checkpoints, Rollback, Loop & Stall Detection

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | 🟨 Built, exit criteria not met: checkpoints as git refs, rollback with preview and approval, loop and stall detectors and a Settings screen exist; tested only against temp git repositories and scripted steps; no real agent session was ever rolled back; the first checkpoint is normally taken after the first edit because the hooks report steps after the fact; loop detection is weaker than specified; the real-session exit criterion is not met and the simulated loop and stall criterion is met in simulation only |
| Depends on | [Phase 57 — Universal Agent Relay & Hook Installers](phase-57-agent-relay-and-installers.md) |
| Unblocks | — |

## Goal

Every agent session can be undone, and Fawkes notices when an agent is stuck.

## Tasks

- [ ] Checkpoint before an agent's first edit: a git snapshot (stash-free ref or worktree) of the working tree, including untracked files. Built: a checkpoint is a commit under `refs/phoenix/checkpoints/cp_<16hex>` made with a temporary `GIT_INDEX_FILE`, so the user's branches, index, stash and work tree are untouched; untracked files are included, ignored files excluded, with a size guard (`core/runtime/src/agent-safety/checkpoints.ts`, `git.ts`; metadata in migration 31, `core/persistence/src/checkpoint-store.ts`; `core/runtime/test/agent-safety-rollback.test.ts`). Unticked because of **timing**: `claude-hook` maps `PostToolUse` to a step and uses `PreToolUse` only for `AskUserQuestion` approvals, so the first edit step arrives after the edit; the checkpoint is taken at the first report and the first edit is normally already in the snapshot. A `PreToolUse` edit hook needs relay installer work and was not built.
- [ ] One-click rollback of everything a session changed, with a preview diff and approval. Built: a preview (names, counts and a bounded redacted diff) with a hash bound to both trees; owner approval through the permission gateway as `execute`; the plan is recomputed after approval; rollback refuses when HEAD moved or the tree changed, deletes only listed HEAD-untracked, non-ignored regular files and never touches `.git` (`rollback.ts`, `agent-safety-rollback.test.ts`, `agent-safety-api.test.ts`). Unticked because it was **never run on a real agent session** and a race of hundreds of milliseconds between the recompute and the writes remains.
- [ ] Loop detection: the same failing command N times, the same file edited back and forth. Built as pure detectors that emit one `agent.safety.loop` WARNING per episode (`detectors.ts`, `agent-safety-detectors.test.ts`). Unticked because it is **weaker than specified**: steps carry no exit code or output, so "the same failing command" is the same command repeated, and file ping-pong is detected only from line-count swaps (equal-sized edits and Write edits are invisible).
- [x] Stall detection: waiting on the user for more than a set time, no activity for a set time. `agent.safety.stall` WARNING, one per episode (`detectors.ts`, `agent-safety-detectors.test.ts`). Simulated steps only; no real agent stalled.
- [x] Fawkes WARNING with the reason; optional notification. A pet WARNING state rule is added through `StateEngine.addRules` and a notification mute setting exists. The `NotificationService` path is not exercised by a test.
- [x] Checkpoints expire on a retention setting and never touch the user's own branches or stashes. Retention is 7 days, pruned hourly and at start; every ref deletion is guarded to the `refs/phoenix/checkpoints/` namespace (`agent-safety-rollback.test.ts`). The 7 days is a number chosen by the implementing agent, not a product decision.

## Deliverables

- Checkpoint and rollback: built (`core/runtime/src/agent-safety/**`, `core/persistence/src/checkpoint-store.ts`, `core/api/src/safety-routes.ts`, `apps/web/src/components/AgentSafety.tsx`, privacy kind `agent_checkpoints`, [agent-safety-net.md](../agent-safety-net.md), OpenAPI entries). The phase doc names `capabilities/agents`; the code is in Core runtime. Simulation only.
- Loop/stall detectors: built (`detectors.ts`); simulation only.

## Exit criteria

- [ ] A real agent session is rolled back exactly to its checkpoint. **Unmet.** Only a temp-repository simulation with scripted steps did this; no real agent session, hook or rollback took part.
- [ ] A simulated loop and stall each raise a warning. **Met in simulation** (`core/runtime/test/agent-safety-detectors.test.ts`); left unticked because the detectors are weaker than specified (see the loop task) and no real agent loop or stall has been observed.

## Implementation notes

### What was built

- **Checkpoints** (`core/runtime/src/agent-safety/**`): a commit under `refs/phoenix/checkpoints/cp_<16hex>` built with a temporary `GIT_INDEX_FILE`; ignored files excluded; a size guard; rows capped at 50 and throttled per project; metadata in migration 31.
- **Rollback**: preview with names, counts and a bounded, redacted diff; a hash bound to both trees; owner approval as `execute`; the plan is recomputed after approval; refused when HEAD moved or the tree changed; only listed HEAD-untracked non-ignored regular files are deleted; `.git` is never touched. Bidi and format characters are stripped from preview paths.
- **Retention**: 7 days, pruned hourly and at start.
- **Detectors**: pure loop and stall detectors emit one `agent.safety.loop` or `agent.safety.stall` WARNING per episode (source `core`); the pet WARNING state rule and a notification mute setting.
- **Web and docs**: `AgentSafety.tsx`, privacy kind `agent_checkpoints` with an inventory row, `safety.*` interface strings (non-English text machine-generated and unreviewed), [agent-safety-net.md](../agent-safety-net.md).

### Deviations

- The code is in `core/runtime` and `core/persistence`, not `capabilities/agents` as the phase doc says.
- Timing: the checkpoint is taken at the first report, not before the first edit (see the first task).
- Loop detection is weaker than the specification (see the loop task).

### Security review

An independent static review (read-only, not a human audit) was followed by fixes, each with tests: checkpoint rows are capped and throttled per project; bidi and format characters are stripped from preview paths; every ref deletion is guarded to the checkpoint namespace.

**Not fixed (open):** the rollback race between the recompute and the writes (hundreds of milliseconds); hostile-repository git behaviour (a `core.worktree` redirect, empty filter commands, `safe.directory`) was not verified on real git; checkpoint snapshots contain any secret present in the work tree (local only, ignored files excluded).

**Fixed later (simulation only):** the `agent.safety.*` reservation for external capabilities. Manifests that could match the namespace (`agent.*`, `agent.safety.*`, ...) are refused unless Core loaded the module itself (the `agents` capability), and `CapabilityManager.publishAs` refuses `agent.safety.*` from any capability. Tested with fake and fixture capabilities only; see [agent-safety-net.md](../agent-safety-net.md#reserved-namespace-agentsafety).

### What was not built

A `PreToolUse` edit hook so that checkpoints precede the first edit; loop detection from exit codes and output.

### What was not run

Any real agent session (Claude Code, Codex), a real hook, a rollback of an agent's real work, real git in a hostile repository, and the `NotificationService` path. Cross-check: a throwaway test (deleted) showed that this phase's real `agent.safety.stall` event is consumed by Phase 78's real board, which marks the session stuck. Open items are in the [gap register](../gaps.md).


## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.
- Rollback is a write: it always needs approval.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
