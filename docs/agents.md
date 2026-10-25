# Connecting coding agents to Phoenix

Phoenix watches your coding agents (what each one is doing, whether it waits for you) and can answer their permission prompts from Fawkes. This page covers the one-click installer, the local relay the hooks talk to, and how to connect an agent Phoenix has no adapter for.

## The installer (Settings → Coding agents, or `phoenix-agent`)

The installer finds the agents on your computer (a binary on `PATH` or the agent's config directory), and offers **only those**. For each one:

1. **Preview.** Phoenix shows the exact unified diff of the file it would change. Nothing is written yet.
2. **Confirm.** Applying carries the hash of that preview. If the file changed in between (you, or the agent), Phoenix refuses and asks you to preview again.
3. **Backup.** Before the first write, the original bytes go to `<Phoenix data dir>/agent-backups/<agent>/` with a `manifest.json` (`path`, `sha256_before`, `sha256_after`, `mtime`).
4. **Atomic write.** A temp file in the same directory, then rename; the file mode is kept; a symlinked settings file is written through the link.

Phoenix only ever adds or removes **its own** entries, recognised by the command (it runs one of `claude-hook.ts`, `approval-hook.ts`, `agent-hook.ts` in Phoenix's `capabilities/agents/src`). Your own hooks are never removed or reordered, and an existing `statusLine` is never touched. Invalid JSON, comments in JSON, a non-object root, or a wrongly shaped `hooks` value make Phoenix refuse and write nothing.

- **Uninstall** restores the backup **byte for byte** when the file still equals what Phoenix wrote. If you edited it afterwards, Phoenix removes only its own entries and keeps your edits (it tells you so).
- **Health.** The list shows _Installed_, _Not installed_ or _Needs repair — missing: …_ (an agent update or a manual edit dropped Phoenix's hooks). **Repair** previews and re-adds just those.
- **CLI.** `phoenix-agent status`, `phoenix-agent install|repair|uninstall <agent>` (prints the diff; add `--yes` to apply), `phoenix-agent self-test`.

### What is supported, and what is not

Only formats shown in the vendor's public documentation are written. Nothing is guessed.

| Agent                 | Status                                                                                                                                                                                                                                            | File                                    | Docs read                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code           | supported (state + approvals)                                                                                                                                                                                                                     | `~/.claude/settings.json`               | https://code.claude.com/docs/en/hooks                                                                                                           |
| Codex                 | supported (state + approvals); open `/hooks` once to trust the new hooks                                                                                                                                                                          | `~/.codex/hooks.json`                   | https://developers.openai.com/codex/hooks                                                                                                       |
| Cursor                | supported (state only; the docs show no permission-wait hook)                                                                                                                                                                                     | `~/.cursor/hooks.json`                  | https://cursor.com/docs/hooks                                                                                                                   |
| Gemini CLI            | supported (state)                                                                                                                                                                                                                                 | `~/.gemini/settings.json`               | https://geminicli.com/docs/hooks/reference/                                                                                                     |
| GitHub Copilot CLI    | supported (state); Phoenix writes its own `~/.copilot/hooks/phoenix.json`                                                                                                                                                                         | `$COPILOT_HOME` or `~/.copilot`         | https://docs.github.com/en/copilot/reference/hooks-reference                                                                                    |
| Muse Code             | supported (state), hooks documented as a developer preview                                                                                                                                                                                        | `~/.config/muse/settings.json`          | https://dev.meta.ai/docs/muse-code/configuration                                                                                                |
| OpenCode              | supported: one plugin file                                                                                                                                                                                                                        | `~/.config/opencode/plugins/phoenix.js` | https://opencode.ai/docs/plugins                                                                                                                |
| Amp                   | supported: one plugin file; no session-end/permission event exists in Amp                                                                                                                                                                         | `~/.config/amp/plugins/phoenix.js`      | https://ampcode.com/docs/customize/plugins                                                                                                      |
| Hermes Agent          | **unsupported**: a plugin needs `hermes plugins enable` / `plugins.enabled` in `~/.hermes/config.yaml` (YAML Phoenix will not rewrite) and its hooks carry no workspace; the gateway hook directory is not loaded by CLI, TUI or Desktop sessions | —                                       | https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins and https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks |
| Google Antigravity    | supported (state only: started, working, finished). Phoenix owns one hook named `phoenix-agent` in the global file and keeps yours; open `/hooks` in the Antigravity CLI to check it                                                              | `~/.gemini/config/hooks.json`           | https://antigravity.google/docs/hooks                                                                                                           |
| Claude Desktop (Chat) | **unsupported**: no user-writable hooks location for Chat is documented (the plugin support page says hooks are ignored in Chat; the Code tab shares Claude Code's settings, so install Claude Code above)                                        | —                                       | https://claude.com/docs/third-party/claude-desktop/extensions and https://claude.com/docs/plugins/platform-support                              |

These installers were tested against temporary directories only. **None of them has been observed running inside the real agent.**

**Antigravity details.** The docs name `~/.gemini/config/hooks.json` as the global file (the App, CLI and IDE read it; `~/.gemini/antigravity-cli/settings.json` is not loaded) and show it as a map of hook names to events. Phoenix installs `SessionStart`, `PreInvocation`, `PostToolUse` and `Stop`, all with a 5 s timeout. It never installs `PreToolUse`, because that hook's output must contain a `decision` and Phoenix would be gating every tool call. `Stop` also requires a `decision` and only `"continue"` keeps the agent going, so Phoenix's `Stop` handler prints the fixed line `{"decision":"stop"}` (`agent-hook.ts --reply antigravity-stop`); every other hook prints `{}`. The docs do not say what a non-zero exit does, so Phoenix's hooks always exit 0. A `Stop` with `fullyIdle: false` is reported as still working. Prompts, tool calls and the transcript path are never read.

**Approvals are Claude Code and Codex only, on purpose.** Their `PermissionRequest` hook fires only when the agent is about to ask you, can wait, and documents its allow/deny output. For the others the documentation gives no equivalent that Phoenix can use without gating every tool call or guessing: Cursor's `beforeShellExecution` (`permission: allow|deny|ask`) and Gemini CLI's `BeforeTool` run before every command or tool, not only when the agent would ask you, so using them would put a Phoenix card in front of every call and an `allow` from Phoenix could approve calls the agent would have stopped on; the pages read do not describe how those hook decisions combine with the agent's own approval prompt, so no adapter was written; Gemini's `Notification` hook "cannot block alerts or grant permissions"; Hermes's `pre_approval_request` is observer-only ("cannot veto or pre-answer the approval"); OpenCode lists `permission.asked` / `permission.replied` only as events; Muse Code lists a `PermissionRequest` event with no documented input or output; Copilot CLI documents the `permissionRequest` output (`{"behavior":"allow"|"deny"}`, exit 2 = deny) but no input payload for it; Amp has no permission event. Codex has no documented question hook, so questions are Claude Code only.

**Codex plan usage** can be read on request: `phoenix-agent codex-usage` starts `codex app-server` once (stdio, stable API only), sends `initialize`, `initialized` and one `account/rateLimits/read`, stops it, and sends only the 5-hour and weekly percentages, reset times and the reset-credit count to Phoenix. Nothing runs it in the background. **Unverified:** `codex` was not available where this was written, so only a scripted stand-in was used, and the Codex docs call the app-server command experimental.

## The relay

Hooks talk to Core over an owner-only local socket, falling back to loopback HTTP with the session token.

- **macOS / Linux:** a Unix domain socket at `<data dir>/relay/relay.sock`. Core creates the directory `0700` and the socket `0600`, refuses to start the relay if the directory is a symlink, belongs to another user, or is group/world accessible, removes a stale socket, and never deletes a file that is not a socket. Node does not expose the peer's uid, so there is no per-connection uid check: access control is the directory and socket permissions.
- **Windows:** a named pipe `\\.\pipe\phoenix-relay-<hash of the user name>`. **UNVERIFIED**: this code path has not been run on Windows and sets no pipe ACL.
- **Protocol:** one newline-terminated JSON request, one JSON response, then close. `{"v":1,"op":"…","body":{…}}`. Allowed ops: `ping`, `report`, `approval.create`, `approval.wait`, `step`, `usage`; anything else is refused. Requests over 1 MiB and connections idle for 2 s are cut. The protocol version `v` is pinned: a server speaking another version answers `unsupported_version`.
- **Self-test:** `phoenix-agent self-test` pings Core through the relay and prints `PASS: relay v1 answered (Core …)` or `FAIL: …` (exit code 1).

If Core is not running, hooks fail open: the agent carries on and asks you in its own terminal.

### Trust boundary

The relay is **not a sandbox boundary**. Any process running as the same OS user can connect to the socket, exactly as it can already read the session token from the data directory and call Core over loopback HTTP. The relay therefore authenticates nothing beyond "same user"; it only keeps other users out.

What a same-user process can do through it, and nothing more:

- send agent status reports, steps and usage numbers (shown in Phoenix, never trusted as instructions);
- create an approval request for any agent name, project, tool and command. It appears as a card (marked as sent through the local relay) and is only ever decided by **you** in the web UI; a relay client cannot decide, install, uninstall or read anything;
- wait for the approval it created (it needs the one-time nonce Core returned), at most 16 waits at a time; further waits get `busy`.

Because the request text is chosen by the sender, the card shows the full command, path, description and other arguments with whitespace and every non-ASCII character made visible. Read the card as "a program running as me asked this", not as proof that a particular coding agent did.

Hardening that does exist: the hook checks the socket before connecting (a real socket owned by you, in a directory you own that is not group/world accessible, no symlink in the path other than one made by root or you, also for `PHOENIX_RELAY_SOCKET` and `PHOENIX_DATA_DIR`) and otherwise falls back to loopback HTTP; the server bounds a request line at 1 MiB without re-copying buffered fragments. Installers write through a random exclusive temp file and refuse to commit when the settings file or its location changed since the preview.

## Any other agent

Anything that can run a command can report to Phoenix.

```sh
phoenix-agent report --agent my-agent --state working --id session-1 --workspace "$PWD" --task "Fix the tests"
```

- `--agent <name>` (or a `phoenix_agent` field in a JSON payload) must match `^[a-z0-9-]{1,24}$`.
- `--state` is one of `started | working | waiting | completed | failed | ended` (`--reason permission|input|idle` with `waiting`).
- The generic hook `capabilities/agents/src/agent-hook.ts --agent <name> [--event <name>]` reads a JSON payload on stdin and understands these fields: `session_id` (or `sessionId`, `conversation_id`), `cwd` (or `workspace_roots[0]`), and either `hook_event_name` or a direct `phoenix_state`. It prints `{}` and always exits 0. An optional `phoenix_usage` object (`model`, `input_tokens`, `output_tokens`, `cost_usd`; running totals) is sent to `POST /api/agent/live/usage` when valid; see [mission-control.md](mission-control.md). Example payload: `{"phoenix_agent":"my-agent","phoenix_state":"waiting","session_id":"s1","cwd":"/work/app","message":"needs your permission"}`.
- Approvals (`approval-hook.ts --agent <name>`) use the same slug rule.

Prompts, tool inputs and transcripts are never read or sent.
