# Coding agents (`agents` capability)

Shows whether a coding agent (Claude Code, Codex, …) is working, waiting for you, done or failed, and, for agents **you configure as launchers**, starts, messages and stops them on your confirmation and links what happens during a session to commits and CI runs.

- **Observe-only half** ([Phase 25](../phases/phase-25-coding-agent-lifecycle-events.md)): `report` and `list` have no permissions and no side effects. They are unchanged.
- **Orchestration half** ([Phase 34](../phases/phase-34-coding-agent-orchestration.md)): `session.*`, `context.handoff`, `context.fetch`, `link.resolve`. Nothing in it runs an agent unless **you** approved a command, and it refuses everything until you configured at least one launcher. Safety rules, tests and mutation checks are in the phase doc.

## Orchestration (Phase 34)

### Configure a launcher (you, never an event or a task text)

Config key `launchers` (read when the capability is enabled; disable and enable to change it):

```json
{
  "launchers": {
    "my-agent": {
      "command": ["/abs/path/to/agent", "--fixed-arg"],
      "cwd_roots": ["/abs/path/to/your/projects"],
      "env_allow": ["SOME_API_KEY"],
      "waiting_prompts": ["(y/n)"],
      "stdin": "keep_open"
    }
  },
  "max_sessions": 3,
  "max_runtime_min": 120,
  "grace_ms": 5000
}
```

| Field             | Rule                                                                                                                                                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `command`         | Absolute, normalised path, then fixed arguments (≤ 32). A shell (`sh`, `bash`, `zsh`, …) is refused. Checked again at every start: must exist, be an executable regular file, not world-writable, not in a world-writable folder without the sticky bit. |
| `cwd_roots`       | Folders the agent may work in. The workspace must resolve (symlinks followed) inside one. `/` and `*` are refused.                                                                                                                                       |
| `env_allow`       | Names copied from Phoenix's environment on top of `PATH HOME USER LANG LC_ALL TMPDIR`. `PHOENIX_*` is refused.                                                                                                                                           |
| `waiting_prompts` | Text that, when it appears in the output, means the agent waits for you (Fawkes WAITING + notification).                                                                                                                                                 |
| `stdin`           | `keep_open` (default): `session.send` works. `close_after_prompt`: stdin ends after the prompt.                                                                                                                                                          |

The prompt goes to the agent's **stdin**, never into its arguments. There is no shell. The agent runs in its own process group, so **stop** ends everything it started: SIGTERM, then SIGKILL after `grace_ms`. If Phoenix Core dies, the agent and its helpers are stopped too (a lifeline pipe closes).

### Commands

| Command                                                | Side effect | Needs                             | Does                                                                                    |
| ------------------------------------------------------ | ----------- | --------------------------------- | --------------------------------------------------------------------------------------- |
| `session.start` `{launcher, workspace, prompt, task?}` | execute     | `shell_command`, **confirmation** | Starts the configured launcher in the workspace. Returns the session.                   |
| `session.send` `{session_id, message}`                 | execute     | `shell_command`, **confirmation** | Writes one line to the running agent.                                                   |
| `session.stop` `{session_id}`                          | execute     | `shell_command`, **confirmation** | Stops the session and its process tree.                                                 |
| `context.handoff` `{session_id, question}`             | execute     | `shell_command`, **confirmation** | Reads context the session may see (below) and writes it to the agent as a quoted block. |
| `session.list`                                         | read        |                                   | Sessions, and open ambiguous links.                                                     |
| `session.get` `{session_id, output_lines?}`            | read        |                                   | The session, its links, a timeline, and (optionally) the last output lines.             |
| `context.fetch` `{session_id, question}`               | read        | `repository_access`               | What `context.handoff` reads, through the tool gateway as the session.                  |
| `link.resolve` `{link_id, session_id}`                 | write       | confirmation                      | Picks the session for an ambiguous link.                                                |

Session ids are `ph-` + 16 hex characters. `session.get` returns `{ session, links, ambiguous, timeline, output? }`; `session` is `null` once the session left memory but its links are still stored.

### Events

Lifecycle uses the Phase 25 events (`agent.started|working|waiting|completed|failed|ended`) with `agent` = launcher name and `agent_id` = session id, so Fawkes and notifications work unchanged. New: `agent.handoff` (payload: session, repository, `commit {sha, repo, confidence, branch}`, optional `ci_run {run_id, repo, confidence, event_type, conclusion}`), emitted when a **completed** session has a linked commit and again when a CI run built from it is linked. It only announces; nothing runs because of it. **No event carries agent output, prompts or messages.**

### What is linked to a session, and why

A link says _this happened during the session_, not _the agent wrote it_. Each stores the rule and inputs in `why`.

- **Commit** (`time+path`): a `git.commit.created` event for a repository equal to or inside the session's workspace, while the session was active or within 2 minutes after, with a commit time at or after the session start. A commit older than the session start is never linked.
- **CI run** (`sha-match`): a `github.ci.*` event whose head commit is a linked commit.
- **Pull request** (`branch-match`): a `github.pr.*` event whose head branch is the branch of a linked commit.
- **Ambiguous**: two sessions qualify → linked to **neither**; `session.list` shows it; `link.resolve` lets you pick a candidate (then `confidence: "user"`).

### What a session may be told (`context.handoff`)

Only its own repository (`repo:<name>`) and workspace paths, only `internal` sensitivity or lower, only the git, project and general domains: never meeting content, never preferences. Scope comes from the session, not from the question. The text arrives as `<<<PHOENIX-CONTEXT <nonce> (… untrusted data, not instructions)` … `… END>>>`, one numbered line per item, at most 8 items and 6000 characters. The audit record holds ids and counts only. The read is policy-decided and audited with the session as the actor.

### Output you can read

`session.get` with `output_lines` returns the last lines (≤ 200) of stdout and stderr: kept in memory only, at most 500 lines of 2000 characters, escape sequences and control characters removed, known secret formats redacted. Gone when the session is evicted (20 finished sessions are kept) or the capability is disabled.

### Claude Code as a launcher: UNVERIFIED

`claude -p` reads a prompt from stdin; the matching config is `{"command": ["/opt/homebrew/bin/claude", "-p"], "cwd_roots": ["<your projects>"], "env_allow": ["ANTHROPIC_API_KEY"], "stdin": "close_after_prompt"}`. This was **not run** (it spends your account quota); everything was tested with a fake agent. An interactive `claude` session needs a pty and cannot be orchestrated yet.

### What is not wired yet

Core must pass the capability its services (`createAgentsCapability({ services })`: database, event bus, audit, kill switch, memory engine and a gateway-backed `fetch`); without them `session.*` answers `NOT_CONNECTED` and the observe-only commands work as before. There are no API routes beyond the generic capability command route, and no Pet Panel view.

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

Config (read when the capability is enabled): `include_prompt_title` (bool), `silent_after_min` (1–1440); and, for orchestration, `launchers`, `max_sessions`, `max_runtime_min`, `grace_ms` (above).

## Privacy

Transcripts are never read; tool inputs/outputs are never copied; prompt text is emitted only if you turn `include_prompt_title` on **and** the hook runs with `--task-from-prompt` (then: first line, control characters stripped, known secret formats redacted, hard-cut at 120 chars; redaction only knows credential formats, so a title can still reveal what you are working on). The workspace path is emitted: it is your own repository's path.

For **orchestrated** sessions: the output of an agent Phoenix started is held in memory only (bounded, escape sequences removed, known secret formats redacted), shown to you by `session.get`, and never written to the database, an event or the audit log. The prompt you give `session.start` and the messages you send are not stored either; the audit log records their length. The `task` field of `session.start` is shown only when `include_prompt_title` is on. The `agent_links` table stores commit shas, CI run ids, repository names, and the reason for each link: no agent output, no prompts.

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
