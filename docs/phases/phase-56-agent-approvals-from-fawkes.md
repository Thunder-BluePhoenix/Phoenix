# Phase 56 — Agent Approvals & Questions from Fawkes

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | Critical |
| Status | ⬜ Not started |
| Depends on | [Phase 25 — Coding-Agent Lifecycle Events](phase-25-coding-agent-lifecycle-events.md), [Phase 32 — Fawkes Chat & Approval UX](phase-32-fawkes-chat-and-approval-ux.md), [Phase 34 — Coding-Agent Orchestration](phase-34-coding-agent-orchestration.md) |
| Unblocks | [Phase 57 — Universal Agent Relay & Hook Installers](phase-57-agent-relay-and-installers.md), [Phase 71 — Phone Link & Mobile Companions](phase-71-phone-link-and-mobile.md), [Phase 76 — Phoenix MCP Server & Universal Approval Channel](phase-76-mcp-server-and-approval-channel.md), [Phase 86 — Approvals in Slack, Discord & Teams](phase-86-chat-app-approvals.md) |

## Goal

Answer a coding agent's permission request or question from Fawkes (web, Pet Panel, floating desktop, island) instead of switching to its terminal, without ever blocking the agent when Phoenix is not there.

## Tasks — parity with Coucou

- [ ] Claude Code `PermissionRequest` hook that waits for a decision: Allow / Deny / Always (hook timeout = decision timeout + 10 s)
- [ ] `AskUserQuestion`: single and multi-select answers, up to 4 questions, plus "Reply in terminal"
- [ ] Codex approvals (Allow / Deny)
- [ ] Approval card stays until answered; the hook only applies a decision meant for the exact request it is waiting on
- [ ] Fail open: if Core is down, slow or the request times out, the hook returns no decision and the agent asks in its terminal

## Tasks — Phoenix improvements

- [ ] Approvals for every agent whose hook protocol supports a decision (Coucou has Claude Code and Codex only)
- [ ] "Always" is a scoped, expiring, audited rule (per project + tool + command pattern), visible and revocable in Settings
- [ ] Requests go through Phoenix's policy gateway (Phase 30): a policy can auto-deny dangerous commands before a human sees them
- [ ] Same card in every Fawkes view at once; answering in one clears the others
- [ ] Approval history in the audit log with the agent, project, tool, command and who decided

## Deliverables

- capabilities/agents approval relay
- Approval cards in apps/web and apps/desktop
- Policy rules for "Always"

## Exit criteria

- [ ] A real Claude Code session's permission request is approved and denied from Phoenix
- [ ] With Core stopped, the agent asks in its terminal within its own timeout
- [ ] An "Always" rule is shown, expires and can be revoked

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
