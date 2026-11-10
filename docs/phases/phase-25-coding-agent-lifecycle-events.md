# Phase 25 — Coding-Agent Lifecycle Events

| Field | Value |
|---|---|
| Stage | Stage 2 — Useful Fawkes (v0.2) |
| Release target | v0.2 |
| Priority | High |
| Status | 🟨 Built, registered in Core and tested with recorded hook payloads; the Pet Panel Overview lists reported agents; never driven by a live Claude Code session (see [gaps register](../gaps.md)) |
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
- [x] Show active agents in Pet Panel — the Overview tab's `AgentsGlance` (`apps/web/src/components/Integrations.tsx`) lists agents from `agents.list`, says in words when one needs input, and refreshes on agent events (`apps/web/test/integrations.test.tsx`); it is absent, and calls nothing, while the capability is off. It shows only agents that actually report; no live Claude Code session has been observed

## Deliverables

- capabilities/agents (observe-only)

## Exit criteria

- [ ] Fawkes reflects an external agent waiting for input — demonstrated with the real hook CLI fed a recorded Notification payload against a real Core (state WAITING + notification); not yet with a live Claude Code session

## Implementation notes

- Builtin capability `agents` (observe-only: no permissions, commands `report` (`none`) and `list` (`read`)). Events keep the `agent.*` names of Appendix A; the manifest declares its own `state_rules` (stall timeout, `(subject)` in the sentence, `agent.started` shows nothing, `agent.idle`/`agent.ended` clear).
- Hook payload shapes and Notification texts for Claude Code 2.0.31 were read from the installed binary's strings (hook names, `session_id`/`transcript_path`/`cwd`/`permission_mode`/`hook_event_name`, `message`/`title`, `prompt`, `source`, SessionEnd `reason`, and the notification message texts); `claude --help` has no hook documentation. Nothing was captured from a live session, and `~/.claude/settings.json` was not modified (it has no `hooks` key today).
- Prompt text is not emitted by default (`include_prompt_title: false`); transcripts are never read.
- **Failure hook (Claude Code ≥ 2.1.78).** The installed Claude Code 2.0.31 (`claude --version`; `/opt/homebrew/bin/claude`) has no failure hook: `claude --help` documents none and the binary's hook list is `PreToolUse, PostToolUse, Notification, UserPromptSubmit, SessionStart, SessionEnd, Stop, SubagentStop, PreCompact`. Running `claude doctor` against a throwaway `CLAUDE_CONFIG_DIR` whose settings name `StopFailure` prints `Invalid Settings … "StopFailure" is not valid. Expected one of: "PreToolUse", …` (no prompt or model call was made). The [hooks reference](https://code.claude.com/docs/en/hooks) documents `StopFailure` ("Runs instead of Stop when the turn ends due to an API error"; fields `error`, `error_details`, `last_assistant_message`) and `PostToolUseFailure`, and the [changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md) lists "Added `StopFailure` hook event" under 2.1.78. Built: `StopFailure` → `failed` in `CLAUDE_HOOK_STATES` (`capabilities/agents/src/claude.ts`), so `claudeHooksConfig`, `phoenix-agent claude-hooks` and the one-click installer all register it, and Fawkes shows ERROR through the existing `agent.failed` rule. Only the session id and `cwd` are read; the error type, details and API message are never copied (tests `claude.test.ts`, `cli.test.ts` "a StopFailure hook (docs fixture)…"; the fixture is the docs example with the common fields). `PostToolUseFailure` is deliberately **not** mapped: a failed tool call is not the agent failing. Consequence: **the 2.0.31 binary rejects the whole hook name as invalid settings, exactly as it already does for `PermissionRequest`**, so the printed/installed hooks need a newer Claude Code. Not run against a Claude Code that sends `StopFailure`.
- **Re-checked on Claude Code 2.1.308 (2026-11-10).** `claude doctor` against a throwaway `CLAUDE_CONFIG_DIR` holding the printed hooks reports no invalid settings (a control directory with an invented event name is reported, so the check validates). The current docs list a `notification_type` on Notification hooks (`permission_prompt`, `idle_prompt`, `elicitation_dialog`, `auth_success`, `agent_completed` and others); the adapter now uses it and ignores types that are not a wait, falling back to the message text for older versions and unknown types. No session was run; no payload was captured.
- **Config reload.** `include_prompt_title` and `silent_after_min` now apply when saved while `agents` is enabled, through the new optional builtin hook `CapabilityModule.onConfig(ctx)` (called by `CapabilityManager.configure`; SDK-additive, no manifest major; failures contained, audited by error class only, capability unhealthy). The launcher keys (`launchers`, `grace_ms`) are still read at enable. The in-memory session table is unchanged: a Core restart still forgets active agents until their next hook. Tested with fakes only (`capabilities/agents/test/agents.test.ts`, `core/capability-manager/test/manager.test.ts`).
- **Config reload for five more capabilities.** `onConfig` now also exists on `git` (`repositories`, `poll_ms`; a saved change wakes the poll loop, a removed repository's state is dropped, a relative path in a saved list is refused by throwing so Core audits it by class and marks the capability unhealthy), `github` (`repositories`, `poll_ms`, `api_url`; the loop holds the replaced context and its wait is cut short), `ports` (`watch`, `poll_ms`; the radar can be started or stopped by a save; thresholds and recipes were already read per call), `status-lights` (`devices` consent, `quiet_hours`, `stream_deck`; a withdrawn consent goes dark at once, a new one is lit; the deck is rebuilt) and `awake` (`battery_floor_percent`; applies to the running session's battery watch and to the next `start`). Not changed, with the reason: capabilities that read `ctx.config` per call from the context Core hands every command (calendar, issues `create`, kage URLs, mock `speed`, web-search, ports thresholds/recipes) already see a saved value; the poll-interval-at-enable capabilities that remain are listed in `docs/gaps.md`. Tested with fakes only (the `config reload (onConfig, Phase 25)` blocks in each capability's test file).

## Source documents

- Post-MVP Roadmap v1.0 §4
- Fawkes PRD v1.0 §10
- Full System PRD v2.0 Appendix A

---
Back to [TRACKER](TRACKER.md)
