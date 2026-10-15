# Phase 57 — Universal Agent Relay & Hook Installers

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | ⬜ Not started |
| Depends on | [Phase 56 — Agent Approvals & Questions from Fawkes](phase-56-agent-approvals-from-fawkes.md) |
| Unblocks | [Phase 58 — Live Agent Sessions, Diffs & Plan Usage](phase-58-live-sessions-diffs-plan-usage.md), [Phase 77 — Agent Safety Net: Checkpoints, Rollback, Loop & Stall Detection](phase-77-agent-safety-net.md) |

## Goal

One relay that connects every coding agent to Phoenix, installed safely with one click.

## Tasks — parity with Coucou

- [ ] Agents: Claude Code, Codex, Cursor, Gemini CLI, Antigravity, Copilot CLI, Muse Code, OpenCode, Amp, Hermes, Claude Desktop
- [ ] Any other agent with `--agent <name>` / a `phoenix_agent` field (`^[a-z0-9-]{1,24}$`)
- [ ] Plugin-model agents (OpenCode, Amp, Hermes) get a plugin file installed in their plugin folder
- [ ] Installer backs up the agent's settings file, merges Phoenix's hooks and shows the diff before writing
- [ ] Local transport: Unix socket (macOS/Linux) and named pipe (Windows), owner-only

## Tasks — Phoenix improvements

- [ ] Detects which agents are installed and offers only those
- [ ] Hook health check: shows when an agent's settings no longer contain Phoenix's hooks (agent update, manual edit) and offers to repair
- [ ] One-click uninstall that restores the backup exactly
- [ ] Version-pinned relay with a self-test command (`phoenix-hook --self-test`)

## Deliverables

- Relay binary/script per OS
- Installer UI in Settings → Agents
- docs/agents.md for third-party agents

## Exit criteria

- [ ] At least five agents installed and observed for real
- [ ] Install → uninstall leaves the agent's settings byte-identical to before

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
