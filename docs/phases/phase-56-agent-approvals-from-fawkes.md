# Phase 56 — Agent Approvals & Questions from Fawkes

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | Critical |
| Status | 🟨 Approval service, hook, Always/deny rules and cards built and tested against a scripted Core and an in-process Core; no real Claude Code or Codex session run; exit criteria not met |
| Depends on | [Phase 25 — Coding-Agent Lifecycle Events](phase-25-coding-agent-lifecycle-events.md), [Phase 32 — Fawkes Chat & Approval UX](phase-32-fawkes-chat-and-approval-ux.md), [Phase 34 — Coding-Agent Orchestration](phase-34-coding-agent-orchestration.md) |
| Unblocks | [Phase 57 — Universal Agent Relay & Hook Installers](phase-57-agent-relay-and-installers.md), [Phase 71 — Phone Link & Mobile Companions](phase-71-phone-link-and-mobile.md), [Phase 76 — Phoenix MCP Server & Universal Approval Channel](phase-76-mcp-server-and-approval-channel.md), [Phase 86 — Approvals in Slack, Discord & Teams](phase-86-chat-app-approvals.md) |

## Goal

Answer a coding agent's permission request or question from Fawkes (web, Pet Panel, floating desktop, island) instead of switching to its terminal, without ever blocking the agent when Phoenix is not there.

## Tasks — parity with Coucou

- [x] Claude Code `PermissionRequest` hook that waits for a decision: Allow / Deny / Always (hook timeout = decision timeout + 10 s). Hook `capabilities/agents/src/approval-hook.ts`, timeout `claude.ts`/`approval-map.ts`; tests `approval-hook.test.ts` (allow, deny, always, `--timeout-ms`, `decision + 10 s`). Driven by a scripted fake Core, never by a real Claude Code.
- [x] `AskUserQuestion`: single and multi-select answers, up to 4 questions, plus "Reply in terminal" (`approval-map.ts`, `agent-approvals.ts`, `AgentApprovals.tsx`; tests in `approval-hook.test.ts`, `approval-map.test.ts`, `agent-approvals.test.ts`, `agent-approvals.test.tsx`). No payload captured from a real Claude Code session was used.
- [x] Codex approvals (Allow / Deny): `approval-codex.ts` and the Codex entry in `relay/adapters.ts`; tests `approval-hook.test.ts` ("Codex agent name"), `approval-map.test.ts` (Codex summaries). Written from Codex's public hooks documentation. The `apply_patch` and MCP `tool_input` shapes are unconfirmed and no real Codex run exists. Codex has no documented `AskUserQuestion` equivalent, so only permission requests exist for it.
- [x] Approval card stays until answered; the hook only applies a decision meant for the exact request it is waiting on (id, nonce and digest binding: `agent-approvals.test.ts`, `approval-client.test.ts`, `approval-hook.test.ts`; card lifetime: `agent-approvals.test.tsx`)
- [x] Fail open: if Core is down, slow or the request times out, the hook returns no decision and the agent asks in its terminal (`approval-hook.test.ts`, `approval-client.test.ts`). An over-limit command, a non-loopback `PHOENIX_CORE_URL` and an invalid answer also return no decision (nothing is truncated into an allow and the token is never sent off this machine). The agent's own behaviour on "no decision" was not observed.

## Tasks — Phoenix improvements

- [ ] Approvals for every agent whose hook protocol supports a decision (Coucou has Claude Code and Codex only). Only Claude Code and Codex are wired and installable; the hook accepts any `--agent <slug>` that sends the same payload (`approval-map.test.ts`). **Decision, re-checked against the vendors' documentation for this phase (nothing built for the others):**

  | Agent | What the documentation gives (URL) | Why no adapter |
  |---|---|---|
  | Claude Code, Codex | `PermissionRequest` fires only when the agent is about to ask, waits for stdout, documents allow/deny: https://code.claude.com/docs/en/hooks, https://developers.openai.com/codex/hooks | built |
  | Copilot CLI | `permissionRequest` event; output `{"behavior":"allow"\|"deny","message"?,"interrupt"?}`, exit 2 = deny, empty/`{}` falls through: https://docs.github.com/en/copilot/reference/hooks-reference | **unconfirmed:** the reference has no input payload for `permissionRequest` (only the matcher on `toolName` and `toolInput.requestSandboxBypass`), so the fields Phoenix would read (session, cwd, tool, arguments) are unknown. Building an adapter on guessed field names would be the guessing the installer rule forbids |
  | Antigravity | `PreToolUse` returns `decision` allow / auto_approve / deny / ask / force_ask: https://antigravity.google/docs/hooks | `PreToolUse` runs before EVERY tool call, `decision` is required, and `allow` "delegates to the next hook or default policy", so Phoenix would sit in front of every call rather than only the ones that need approval, and the page does not document a way to wait for a person beyond the hook timeout. Not built; state reporting only |
  | Cursor | `beforeShellExecution` / `beforeMCPExecution` return `permission: allow\|deny\|ask`: https://cursor.com/docs/hooks | runs before every shell or MCP call, and the page does not describe how `allow` combines with Cursor's own approval prompt, so a Phoenix `allow` could approve something Cursor would have asked about. Not built |
  | Gemini CLI | `BeforeTool` `decision` allow/deny; `Notification` is "observability only ... cannot ... grant permissions": https://geminicli.com/docs/hooks/reference/ | same every-call problem, no documented interaction with `--approval-mode` prompts. Not built |
  | Hermes | `pre_approval_request`: "observer-only; they cannot veto or pre-answer the approval": https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks | cannot decide. Not built |
  | OpenCode | `permission.asked` / `permission.replied` are listed as events only: https://opencode.ai/docs/plugins | no documented way to reply from a plugin. Not built |
  | Muse Code | lists a `PermissionRequest` hook event: https://dev.meta.ai/docs/muse-code/extending#hooks | no input or output contract documented (also a developer preview). Not built |
  | Amp | no permission event: https://ampcode.com/docs/customize/plugins | none |
  | Claude Desktop | Code tab = Claude Code's hooks (covered); Chat has no documented user hooks | none |

  Codex also has no documented question hook: `tool/requestUserInput` exists only on the app-server protocol (https://developers.openai.com/codex/app-server, marked experimental), not as a hook, so questions stay Claude Code only and Codex stays Allow / Deny.
- [x] "Always" is a scoped, expiring, audited rule (per agent + project + tool + command pattern, at most 24 h), visible and revocable in Settings (`core/policy/src/agent-rules.ts`, `agent-approvals.ts`, migrations 25 and 26, `ApprovalRules.tsx`; tests `agent-approvals.test.ts` "Always rules", `agent-approvals-rules.test.tsx`). A rule is refused for critical, production-looking, non-ASCII and redacted subjects, and a prefix rule never covers a chained or redirected command.
- [x] Requests go through Phoenix's policy gateway (Phase 30): a policy can auto-deny dangerous commands before a human sees them (`core/policy/src/engine.ts` `denyByRule`, `command-normalize.ts`; tests `agent-approvals.test.ts` "policy auto-deny" and "deny rules resist cheap bypasses"). Only deny rules the user created apply; there is no built-in deny list, and the normalisation is best-effort, not a sandbox.
- [x] Same card in every Fawkes view at once; answering in one clears the others. `AgentApprovals.tsx` renders the same cards (same `useAgentApprovals` hook, same decision request and 'Always' button gated by `always_ok`, same hidden-character cleaning) in the Pet Panel overview and, as `<AgentApprovals compact />`, in the floating window (`FloatingApp.tsx`) and the expanded island (`IslandApp.tsx`). A decision in any one window or client clears the card in the others through the `agent.approval.*` events (`agent-approvals.test.tsx`, `agent-approvals-windows.test.tsx`). Tests render the components in happy-dom against a fake Core; the layout inside the fixed 200×220 floating window and the 360×176 expanded island (the card scrolls; the bubble and island text shrink to one line; Fawkes keeps her size) was never seen in a real Tauri window, and the Windows/Linux island is non-focusable, so its card is mouse-only there (not run).
- [x] Approval history in the audit log with the agent, project, tool, command and who decided (`agent-approvals.test.ts` "history"; the command is redacted and cut at 200 characters, and the decider label is self-reported through an optional `x-phoenix-client` header)

## Deliverables

- capabilities/agents approval relay
- Approval cards in apps/web and apps/desktop
- Policy rules for "Always"

## Exit criteria

- [ ] A real Claude Code session's permission request is approved and denied from Phoenix
- [ ] With Core stopped, the agent asks in its terminal within its own timeout
- [ ] An "Always" rule is shown, expires and can be revoked

## Implementation notes

Core owns the service (`core/runtime/src/agent-approvals.ts`, routes `core/api/src/agent-approval-routes.ts`, rules `core/policy/src/agent-rules.ts` and `command-normalize.ts`, SQLite migrations 25 and 26). The hook (`capabilities/agents/src/approval-{map,client,hook,codex}.ts`) maps an agent payload to a request, long-polls Core, and prints one JSON decision line or nothing. Every route needs the session token. Pending requests are held in memory only: a Core restart drops them and the hook then fails open. Migration 26 re-created the rules table with an agent column and dropped the rules of migration 25, which could not be attributed to an agent.

What was actually run:

- TypeScript tests of the hook, client, mapping, Core service, HTTP API and web components. The hook tests use a scripted in-process fake of Core's API.
- Twice, by a throwaway test that was deleted afterwards, the real approval-hook process against a real in-process Core: allow, deny, an Always rule that then auto-allowed, a chained command not covered by that rule, `AskUserQuestion` answers, "terminal" giving no decision, Core down giving no decision, an over-limit command giving no decision, a non-loopback URL sending nothing, and another agent not being covered by a rule. That test is not in the repository.

What was not: a real Claude Code or Codex session, the agents' own timeouts, voice deny (Phase 66), and a look at the card in a real floating or island window (only component tests with a fake Core and happy-dom ran).

Known limits: any holder of the session token can decide any pending request (the token is also injected into HTML served from `webRoot`; pre-existing, see the [security review](../security-review.md)); the `detail` field shows the other tool arguments; at most 50 requests are pending and one agent session may create 20 a minute. Five findings of a read-only review of Phases 56–58 (a git filter running code, a silent truncation turning into an allow, the token sent to a non-loopback URL, an installer file-replacement race, and a deny-rule bypass with raw text in the audit log) were fixed, each with a test that failed before the fix. The review was static reading of the code; it was not an independent human security audit.

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.
- Voice may deny but never approve (rule shared with Phase 66).

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
