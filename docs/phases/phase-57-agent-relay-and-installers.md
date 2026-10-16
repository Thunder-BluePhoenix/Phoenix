# Phase 57 — Universal Agent Relay & Hook Installers

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | 🟨 Relay, installers and eight adapters built from public documentation and tested on temporary directories; no agent installed or observed for real; three agents unsupported; exit criteria not met |
| Depends on | [Phase 56 — Agent Approvals & Questions from Fawkes](phase-56-agent-approvals-from-fawkes.md) |
| Unblocks | [Phase 58 — Live Agent Sessions, Diffs & Plan Usage](phase-58-live-sessions-diffs-plan-usage.md), [Phase 77 — Agent Safety Net: Checkpoints, Rollback, Loop & Stall Detection](phase-77-agent-safety-net.md) |

## Goal

One relay that connects every coding agent to Phoenix, installed safely with one click.

## Tasks — parity with Coucou

- [ ] Agents: Claude Code, Codex, Cursor, Gemini CLI, Antigravity, Copilot CLI, Muse Code, OpenCode, Amp, Hermes, Claude Desktop. Eight have adapters written from the vendors' public documentation (`capabilities/agents/src/relay/adapters.ts`; tests `relay-installer.test.ts`): Claude Code, Codex, Cursor, Gemini CLI, Copilot CLI, Muse Code (documented as a developer preview), OpenCode and Amp. Hermes, Antigravity and Claude Desktop are registered as **unsupported: format unconfirmed** and refuse every action; the reasons and documentation URLs are in [agents.md](../agents.md). None of the eight has been run inside the real agent.
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
