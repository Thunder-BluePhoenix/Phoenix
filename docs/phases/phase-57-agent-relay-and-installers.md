# Phase 57 — Universal Agent Relay & Hook Installers

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | 🟨 Relay, installers and nine adapters built from public documentation and tested on temporary directories; no agent installed or observed for real; two agents unsupported (Hermes, Claude Desktop); exit criteria not met |
| Depends on | [Phase 56 — Agent Approvals & Questions from Fawkes](phase-56-agent-approvals-from-fawkes.md) |
| Unblocks | [Phase 58 — Live Agent Sessions, Diffs & Plan Usage](phase-58-live-sessions-diffs-plan-usage.md), [Phase 77 — Agent Safety Net: Checkpoints, Rollback, Loop & Stall Detection](phase-77-agent-safety-net.md) |

## Goal

One relay that connects every coding agent to Phoenix, installed safely with one click.

## Tasks — parity with Coucou

- [ ] Agents: Claude Code, Codex, Cursor, Gemini CLI, Antigravity, Copilot CLI, Muse Code, OpenCode, Amp, Hermes, Claude Desktop. Nine have adapters written from the vendors' public documentation (`capabilities/agents/src/relay/adapters.ts`; tests `relay-installer.test.ts`, `relay-antigravity.test.ts`): Claude Code, Codex, Cursor, Gemini CLI, Antigravity, Copilot CLI, Muse Code (documented as a developer preview), OpenCode and Amp. Hermes and Claude Desktop are registered as **unsupported** and refuse every action. None of the nine has been run inside the real agent. Per agent, what the format is confirmed by (documentation URLs; no real agent was run for any of them):

  | Agent | Confirmed by | Status |
  |---|---|---|
  | Claude Code | https://code.claude.com/docs/en/hooks; `claude --version` 2.0.31 and `claude --help` on this machine show `--settings` and `--setting-sources user,project,local`, nothing about hooks | built |
  | Codex | https://developers.openai.com/codex/hooks (user `~/.codex/hooks.json` or `[hooks]` in `config.toml`; the file Phoenix writes is the JSON one, hooks need `/hooks` trust) | built |
  | Cursor | https://cursor.com/docs/hooks (`~/.cursor/hooks.json`, `version: 1`, flat lists) | built |
  | Gemini CLI | https://geminicli.com/docs/hooks/reference/ (`settings.json` `hooks`, exit 0 JSON / 2 block); `gemini --version` 0.17.0 here, its `--help` lists no hook option | built |
  | Copilot CLI | https://docs.github.com/en/copilot/reference/hooks-reference (user hook files in `~/.copilot/hooks/`) | built |
  | Muse Code | https://dev.meta.ai/docs/muse-code/configuration and /extending (`~/.config/muse/settings.json`, `schema_version: 1`, user hooks block; stdout contract not documented) | built (developer preview) |
  | OpenCode, Amp | https://opencode.ai/docs/plugins, https://ampcode.com/docs/customize/plugins | built (plugin files never loaded by the agents) |
  | Antigravity | https://antigravity.google/docs/hooks: global file `~/.gemini/config/hooks.json`, name-to-events map, event list, handler fields (`command`, `timeout` in seconds), stdin/stdout JSON for every event, and the `Stop` rule that `decision` is required and only `"continue"` keeps the agent running. Built as state only (`SessionStart`, `PreInvocation`, `PostToolUse`, `Stop`; never `PreToolUse`). Tests `relay-antigravity.test.ts` use the page's own payloads and `hooks.json` example. **Still unconfirmed:** what a non-zero exit does (the page says nothing; Phoenix hooks always exit 0), and the `~/.gemini/antigravity-cli` CLI directory was only used as the detection marker (it exists here, `agy` is in `~/.gemini/bin` and not on PATH; nothing was run) | built |
  | Hermes Agent | https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins and /hooks: a plugin loads only after `hermes plugins enable` / `plugins.enabled` in `config.yaml`; plugin hook callbacks (`on_session_start(session_id, model, platform)`, `on_session_end(session_id, completed, interrupted, ...)`) carry no workspace directory; the gateway hook directory needs no enable step but "the CLI, TUI, Desktop and cron never load gateway hooks" and its events carry no workspace; shell hooks do get `cwd` but live in `config.yaml` (`hooks:` block, first-use consent). No documented integration point that avoids rewriting YAML and covers CLI sessions exists | **unconfirmed, nothing built** |
  | Claude Desktop (Chat) | https://claude.com/docs/third-party/claude-desktop/extensions (hooks arrive only through plugins: marketplaces, or the admin-owned `/Library/Application Support/Claude/org-plugins/` on 3P) and https://claude.com/docs/plugins/platform-support (hooks `Ignored` in Chat, load in Cowork and Claude Code). No user-writable hooks file for Chat is documented; the Code tab reads Claude Code's settings | **unconfirmed, nothing built** (covered by the Claude Code installer for the Code tab) |
- [x] Any other agent with `--agent <name>` / a `phoenix_agent` field (`^[a-z0-9-]{1,24}$`) (`agent-hook.ts`, `relay/generic-map.ts`; tests `relay-hooks.test.ts`: third-party `phoenix_state`, invalid slug rejected, the real hook subprocess prints `{}` and exits 0 with no Core running)
- [ ] Plugin-model agents (OpenCode, Amp, Hermes) get a plugin file installed in their plugin folder. OpenCode and Amp: one marked plugin file, install and uninstall tested on temporary directories (`relay-installer.test.ts` "plugin agents"); the plugin JavaScript was never loaded by OpenCode or Amp. Hermes is unsupported (its plugins need an edit to a YAML file Phoenix will not rewrite).
- [x] Installer backs up the agent's settings file, merges Phoenix's hooks and shows the diff before writing (`relay/installer.ts`, `relay/diff.ts`, `relay/atomic-file.ts`; tests `relay-installer.test.ts` "writes a backup with a manifest and shows the diff before writing", "refuses to write when the file changed after the preview", "hardened writes"; HTTP routes `agent-relay-routes.test.ts`)
- [ ] Local transport: Unix socket (macOS/Linux) and named pipe (Windows), owner-only. The Unix socket is built and tested (`relay/server.ts`, `socket-trust.ts`; tests `relay-server.test.ts`, `relay-socket-trust.test.ts`, `relay-client.test.ts`, `agent-relay.test.ts`: directory 0700, socket 0600, ownership checked on server start and client connect). The Windows named pipe path exists but has never been run on Windows and sets no ACL. Node does not expose the peer's uid, so any process of the same user can use the relay.

## Tasks — Phoenix improvements

- [x] Detects which agents are installed and offers only those (`relay-installer.test.ts` "only offers detected agents"; `agent-installers.test.tsx`)
- [x] Hook health check: shows when an agent's settings no longer contain Phoenix's hooks (agent update, manual edit) and offers to repair (`relay-installer.test.ts` "health notices vanished hooks and repair puts them back", "detects the whole file being replaced"; `agent-installers.test.tsx` "repairs an agent")
- [x] One-click uninstall that restores the backup exactly. Byte-identity after install → uninstall is proven for every JSON adapter on temporary-directory fixtures only (`relay-installer.test.ts` "leaves the file byte-identical"; `relay-hooks.test.ts` CLI; `agent-relay-routes.test.ts`), not on a real agent's settings file. If the user edited the file in between, only Phoenix's entries are removed.
- [x] Version-pinned relay with a self-test command. Deviation: the command is `phoenix-agent self-test`, not `phoenix-hook --self-test`; it pings Core through the relay protocol `v:1` (`relay/self-test.ts`; tests `relay-client.test.ts` "runSelfTest", `relay-hooks.test.ts` CLI). It does not run a hook inside an agent.

## Deliverables

- Relay script per OS: TypeScript hook scripts started through the repository's `tsx`; no packaged per-OS binary exists
- Installer UI in Settings → Coding agents (`apps/web/src/components/AgentInstallers.tsx`; tests `agent-installers.test.tsx`)
- docs/agents.md for third-party agents ([agents.md](../agents.md))

## Exit criteria

- [ ] At least five agents installed and observed for real
- [ ] Install → uninstall leaves the agent's settings byte-identical to before (shown only on temporary-directory fixtures, not on a real agent's file)

## Implementation notes

Hooks use an owner-only local socket and fall back to loopback HTTP with the session token. The relay is not a sandbox boundary: any process running as the same OS user can use it, which is the same trust as reading `session.token`; the approval card shows that a request came through the relay. The relay accepts only the ops `ping`, `report`, `approval.create`, `approval.wait`, `step` and `usage`, caps a request line at 1 MiB, cuts idle connections after 2 s, and answers `busy` beyond 16 concurrent waits. Installers write through an exclusive random temp file and refuse to commit when the file or its location changed since the preview (a fix for an installer race found by the Phase 56–58 review, with a failing-before test).

What was run: the unit and component tests above, and the real generic hook as a subprocess. What was not: any listed agent installed and run, the plugin files inside OpenCode or Amp, the Windows pipe, and an installer run against an agent's real settings file.

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
