# Phase 79 — Session Handoff Notes & Secret Guard

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | 🟨 Built, exit criteria not met: a secret-guard hook for Claude Code and Codex, a deterministic handoff-note generator, an attach-with-approval flow and a Settings screen exist; tested only with simulated hook payloads, fake secrets, scripted model providers and a fake GitHub command; never run inside a real agent; the Codex `PreToolUse` wiring and the deny shape come from published docs and are unverified; PR attach is copy-only; the guard fails open on a crash or timeout and aliases or scripts evade it; both exit criteria are unmet |
| Depends on | [Phase 58 — Live Agent Sessions, Diffs & Plan Usage](phase-58-live-sessions-diffs-plan-usage.md) |
| Unblocks | — |

## Goal

What an agent did travels with its work, and secrets never leave through an agent.

## Tasks

- [ ] Handoff note at session end: goal, what changed, commands run, open questions; local model by default. Built: a deterministic generator (goal from the reported task title, files changed, redacted commands, open questions) with an optional model summary through a **local provider only** (cloud refused unless `allow_cloud`; the reply is re-checked); notes are stored in `<dataDir>/handoff` (mode 0600, 50 notes, 64 KiB each) (`core/runtime/src/handoff-notes/**`, `core/runtime/test/handoff-notes.test.ts`, `handoff-api.test.ts`). Unticked because no real session ended into a note: the goal is often "Unknown" and automatic notes depend on `agent.ended` events from source `agents`.
- [ ] Attach the note to the commit message, PR description or task with approval. Built as preview plus approval (`attach.ts`): the commit message and PR description are **copy-only** (Phoenix never runs `git commit`; PR attach is "not wired"); the task path creates a GitHub issue through the existing `issue.create` command with an idempotency key, tested only with a fake. Unticked because nothing was attached to a real PR or a real issue.
- [x] Secret guard: block an agent tool call, commit or push that contains a secret (Phoenix's detector), with an explanation and override by approval. The hook (`capabilities/agents/src/guard-hook.ts`, `relay/guard-scan.ts`, `relay/guard-git.ts`) scans tool-call input and, for `git commit` and `git push`, the staged diff or the unpushed range with the `protocol/src/secrets.ts` patterns; a block names the pattern kind and location only, never the secret; an override needs an approval card bound to the content hash and decided by the user (Core re-checks against the audit log); installed for Claude Code and Codex through the existing relay installer with preview, hash, repair and uninstall that preserve the user's hooks (`capabilities/agents/test/guard-hook.test.ts`, `guard-install.test.ts`, `core/runtime/test/secret-guard-*.test.ts`). Simulated payloads and fake secrets only; the hook has never run in a real agent. Ticked as built with those limits; see the open items in the notes.
- [x] Guard results in the audit log. Results are posted to `POST /api/secret-guard/result` (it rejects payloads that contain secrets; rate-limited; the override proof is single-use) and audited (`core/runtime/test/secret-guard-api.test.ts`). No real agent posted one.

## Deliverables

- Handoff generator: built (`core/runtime/src/handoff-notes/**`, `core/api/src/handoff-routes.ts`, `apps/web/src/components/HandoffNotes.tsx`, privacy kind `handoff` with inventory row `handoff_notes`, [handoff-and-secret-guard.md](../handoff-and-secret-guard.md), OpenAPI entries); simulation only.
- Secret guard hook: built (see the guard task); never run in a real agent.

## Exit criteria

- [ ] A planted test secret in an agent's commit is blocked. **Unmet.** Covered with a simulated hook payload in a temporary git repository, not by a real agent attempting a commit. The Codex `PreToolUse` wiring and the deny shape come from published docs and are unverified.
- [ ] A handoff note is attached to a real PR. **Unmet.** PR attach is copy-only and the task path was tested with a fake GitHub command; nothing was attached to a real pull request.

## Implementation notes

### What was built

- **Guard hook**: scans tool-call input; for `git commit` and `git push` it scans the staged diff or the unpushed range; a block names the pattern kind and location only; override only by an approval bound to the content hash, re-checked by Core against the audit log; results audited.
- **Installers**: through the existing relay installer for Claude Code and Codex, with preview, hash, repair and uninstall preserving the user's own hooks.
- **Handoff notes**: deterministic generation, optional local-only model summary, bounded store, preview-and-approve attach flow.
- **Web and docs**: `HandoffNotes.tsx`, `handoff.*` interface strings (non-English text machine-generated and unreviewed), [handoff-and-secret-guard.md](../handoff-and-secret-guard.md).

### Deviations

- Commit-message and PR attach are copy-only: Phoenix does not edit a commit or a pull request.
- The goal comes from the reported task title, so it is often "Unknown".

### Security review

An independent static review (read-only, not a human audit) was followed by fixes, each with tests: the diff scanner skipped added lines that start with `++ ` (it is now hunk-aware); git intent matching was widened (quotes, `/usr/bin/git`); a first push without an upstream is scanned; oversize or truncated input now denies; the task-attach card names the repository and title; `redactSecrets` backtracking made linear and diff previews are cut before redaction; the result route is rate-limited and the override proof is single-use; a handoff goal source check; a checkpoint cap; bidi characters in preview paths.

**Not fixed (open, documented):** aliases and scripts (`git ci`, `./release.sh`, `make push`) evade the guard; the guard is not tamper-resistant against an agent that can edit its own hook config or the Phoenix checkout; the detector has few patterns (no Stripe, JWT, GitLab or npm tokens); a hook crash or timeout fails **open** (exit 0) by design; `git add && git commit` scans the whole working tree; the approval card text (finding locations) is partly attacker-chosen; the CLI printers `claude-hooks` and `codex-hooks` do not include the guard.

### What was not built

Attaching to a real commit or PR (copy-only); a fail-closed mode. Added later: detector patterns for Stripe live keys, GitLab personal access tokens, npm tokens and JWTs, and the guard in the `claude-hooks` and `codex-hooks` printers (`--no-guard` omits it). Both are tested with fake secrets only.

### What was not run

The guard in a real Claude Code or Codex session, the Codex `PreToolUse` wiring and deny shape, a real commit of a planted secret, a real model summary, a real GitHub issue or pull request. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
