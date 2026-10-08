# Phase 25 — Coding-Agent Lifecycle Events

| Field | Value |
|---|---|
| Stage | Stage 2 — Useful Fawkes (v0.2) |
| Release target | v0.2 |
| Priority | High |
| Status | 🟨 Built and tested against a real Core with recorded hook payloads; never driven by a live Claude Code session; Pet Panel list and runtime registration pending (see Implementation notes) |
| Depends on | [Phase 21 — Post-MVP Stabilisation](phase-21-post-mvp-stabilization.md) |
| Unblocks | [Phase 26 — Issue Tracker Capabilities & v0.2 Release](phase-26-issue-tracker-capabilities.md), [Phase 34 — Coding-Agent Orchestration](phase-34-coding-agent-orchestration.md) |

## Goal

Show whether AI coding agents (Codex, Claude Code, …) are working, waiting, done or failed.

## Scope

**In scope**

- agent.started / waiting / completed / failed
- Workspace/repo association

**Out of scope**

- Controlling agents (Phase 34)

## Tasks

- [x] Define agent.* payload (agent id, workspace, task title) — [docs/capabilities/agents.md](../capabilities/agents.md), `capabilities/agents/src/report.ts`
- [x] Adapters/hooks for at least one coding agent — Claude Code hooks (`claude-hook.ts`) and a generic `phoenix-agent report` CLI; not yet exercised by a live Claude Code session
- [x] Map agent.waiting → WAITING with 'input required' notification — `requires_action: true`; verified through a real `NotificationService`
- [ ] Show active agents in Pet Panel — the `list` command exists; the panel view is not built

## Deliverables

- capabilities/agents (observe-only)

## Exit criteria

- [ ] Fawkes reflects an external agent waiting for input — demonstrated with the real hook CLI fed a recorded Notification payload against a real Core (state WAITING + notification); not yet with a live Claude Code session

## Implementation notes

- Builtin capability `agents` (observe-only: no permissions, commands `report` (`none`) and `list` (`read`)). Events keep the `agent.*` names of Appendix A; the manifest declares its own `state_rules` (stall timeout, `(subject)` in the sentence, `agent.started` shows nothing, `agent.idle`/`agent.ended` clear).
- Hook payload shapes and Notification texts for Claude Code 2.0.31 were read from the installed binary's strings (hook names, `session_id`/`transcript_path`/`cwd`/`permission_mode`/`hook_event_name`, `message`/`title`, `prompt`, `source`, SessionEnd `reason`, and the notification message texts); `claude --help` has no hook documentation. Nothing was captured from a live session, and `~/.claude/settings.json` was not modified (it has no `hooks` key today).
- Prompt text is not emitted by default (`include_prompt_title: false`); transcripts are never read.
- Claude Code has no failure hook, so `agent.failed` is only reachable through the generic `report` CLI.

## Source documents

- Post-MVP Roadmap v1.0 §4
- Fawkes PRD v1.0 §10
- Full System PRD v2.0 Appendix A

---
Back to [TRACKER](TRACKER.md)
