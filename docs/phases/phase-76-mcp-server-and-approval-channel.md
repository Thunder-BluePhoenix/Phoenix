# Phase 76 — Phoenix MCP Server & Universal Approval Channel

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | ⬜ Not started |
| Depends on | [Phase 56 — Agent Approvals & Questions from Fawkes](phase-56-agent-approvals-from-fawkes.md), [Phase 30 — Policy Gateway & Tool Gateway](phase-30-policy-and-tool-gateway.md) |
| Unblocks | — |

## Goal

Expose Phoenix to any MCP-capable agent: authorised context to read, and one audited path to ask the user for approval.

## Tasks

- [ ] MCP server in Core (stdio and local HTTP), owner-only, per-client token
- [ ] Read tools: activity, meetings and decisions, knowledge-graph queries, CI and git state, memory (scoped by Phase 29 governance)
- [ ] `request_approval` tool: shows the same approval card as Phase 56 and returns the decision
- [ ] `notify` tool: lets an agent report state (working, waiting, done) to Fawkes
- [ ] Per-client permission grants, visible and revocable in Settings; every call audited
- [ ] Prompt-injection rule: tool results are marked untrusted data

## Deliverables

- core MCP server
- Client setup snippets for Claude Code, Cursor, Codex and generic MCP clients

## Exit criteria

- [ ] A real MCP client reads Phoenix context and gets an approval decided in Phoenix
- [ ] A client without a grant is refused

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
