# Coding agents (`agents` capability)

Shows whether a coding agent (Claude Code, Codex, …) is working, waiting for you, done or failed. **Observe-only** ([Phase 25](../phases/phase-25-coding-agent-lifecycle-events.md)): the capability has no permissions, runs nothing and has no command that could steer an agent (that is Phase 34).

## Report contract

An adapter calls the `report` command (`POST /api/capabilities/agents/commands/report`, session token) with:

| Field       | Type                                                       | Notes                                                                    |
| ----------- | ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| `agent`     | slug, ≤ 40 chars (`claude-code`, `codex`, …)               | Shown in Fawkes' sentence                                                |
| `agent_id`  | session id, ≤ 100 chars (`A-Za-z0-9._:-`)                  | Claude Code's `session_id`                                               |
| `state`     | `started` `working` `waiting` `completed` `failed` `ended` | `ended` removes the session                                              |
| `workspace` | absolute path, no control characters                       | The agent's cwd. Only the path, never file contents                      |
| `task`      | one line, ≤ 120 chars, optional                            | **Dropped unless config `include_prompt_title` is true** (default false) |
| `reason`    | `permission` `input` `idle`, only with `waiting`           |                                                                          |

TypeScript: `AgentReport` and `validateReport()` in `capabilities/agents/src/report.ts`. Unknown fields are rejected. `report` has side effect `none`, like `terminal.report`: it changes nothing outside Phoenix's own event stream, and a confirmation per hook call would make it unusable.

Events (source `agents`, `correlation_id = agent-<agent_id>`, `subject` = repository name = last segment of `workspace`). Payload: `agent`, `agent_id`, `workspace`, `repository`, optional `task`, `reason`, `expired`.

| Report                       | Event                                    | Fawkes                                                                                |
| ---------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------- |
| `started`                    | `agent.started`                          | nothing (session is listed; clears the previous run's state)                          |
| `working`                    | `agent.working`                          | WORKING, "claude-code is working (phoenix)"; stalls after 60 min of silence → WARNING |
| `working` while working      | `agent.progress` (ephemeral)             | keeps the stall timer alive; not written to the history                               |
| `waiting` (permission/input) | `agent.waiting`, `requires_action: true` | WAITING "claude-code needs your input (phoenix)" + notification                       |
| `waiting` + `idle`           | `agent.idle`                             | nothing: an idle prompt must not nag                                                  |
| `completed`                  | `agent.completed`                        | SUCCESS for 5 s                                                                       |
| `failed`                     | `agent.failed`                           | ERROR                                                                                 |
| `ended`, or silent too long  | `agent.ended`                            | clears the session's state                                                            |

`requires_action: true` is what makes `core/notifications` raise the "input required" notification (it always notifies such events) and what the state engine maps to WAITING.

`list` (read) returns `{ agents: [{ agent, agent_id, workspace, repository, state, reason?, task?, since, updated_at }] }`. A session silent for `silent_after_min` (default 120) is dropped and its state cleared. At most 200 sessions are tracked.

Config (read when the capability is enabled): `include_prompt_title` (bool), `silent_after_min` (1–1440).

## Privacy

Transcripts are never read; tool inputs/outputs are never copied; prompt text is emitted only if you turn `include_prompt_title` on **and** the hook runs with `--task-from-prompt` (then: first line, control characters stripped, known secret formats redacted, hard-cut at 120 chars; redaction only knows credential formats, so a title can still reveal what you are working on). The workspace path is emitted: it is your own repository's path.

## Claude Code (hooks)

`capabilities/agents/src/claude-hook.ts` is run by Claude Code for each hook with the hook JSON on stdin. It always exits 0 within 2 s (also when Core is down or slow, or the input is garbage) and writes nothing to stdout.

| Claude Code hook   | Report                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `SessionStart`     | `started`                                                                                                                                  |
| `UserPromptSubmit` | `working`                                                                                                                                  |
| `PostToolUse`      | `working` (the agent resumed, e.g. after you approved a permission)                                                                        |
| `Notification`     | `waiting`; message "…needs your permission/approval/attention" → `permission`, "…waiting for your input" → `idle`, anything else → `input` |
| `Stop`             | `completed`                                                                                                                                |
| `SessionEnd`       | `ended`                                                                                                                                    |

Other hooks are ignored. Claude Code has **no failure hook**, so `agent.failed` is never produced for it; use the generic CLI from a wrapper if you need it.

Setup (prints, never writes; merge the `hooks` block into `~/.claude/settings.json` yourself):

```sh
node_modules/.bin/tsx capabilities/agents/src/cli.ts claude-hooks            # add --task-from-prompt for titles
```

Cost: `PostToolUse` starts one `tsx` process (~0.2 s, in the background of the tool call) per tool call. Drop that entry from the snippet if you do not want it; WORKING then ends at the next `Stop`/`Notification` and a permission answer is not noticed until the agent stops.

## Other tools (Codex, …)

```sh
node_modules/.bin/tsx capabilities/agents/src/cli.ts report --agent codex --state working   --workspace "$PWD" --id my-run
node_modules/.bin/tsx capabilities/agents/src/cli.ts report --agent codex --state waiting   --reason input
node_modules/.bin/tsx capabilities/agents/src/cli.ts report --agent codex --state completed
```

Without `--id` the session id is derived from agent + directory. The command always exits 0 when Phoenix is unreachable (it prints a note to stderr) so a wrapper never breaks. **No Codex hook or wrapper has been written or tested.**
