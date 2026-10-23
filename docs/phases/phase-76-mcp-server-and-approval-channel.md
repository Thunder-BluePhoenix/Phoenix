# Phase 76 — Phoenix MCP Server & Universal Approval Channel

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | 🟨 Built, exit criteria not met: a hand-written JSON-RPC MCP server (loopback HTTP and a stdio bridge), per-client tokens and grants, seven tools, audit and a Settings screen exist; tested only with an in-repo simulated MCP client over real loopback HTTP; no real MCP client (Claude Code, Cursor, Codex) was ever run against it and the client snippets are unverified; neither exit criterion is met |
| Depends on | [Phase 56 — Agent Approvals & Questions from Fawkes](phase-56-agent-approvals-from-fawkes.md), [Phase 30 — Policy Gateway & Tool Gateway](phase-30-policy-and-tool-gateway.md) |
| Unblocks | — |

## Goal

Expose Phoenix to any MCP-capable agent: authorised context to read, and one audited path to ask the user for approval.

## Tasks

- [ ] MCP server in Core (stdio and local HTTP), owner-only, per-client token. Built: a hand-written JSON-RPC 2.0 server (`core/runtime/src/mcp/**`), a loopback HTTP listener and a stdio bridge (`scripts/mcp/phoenix-mcp-stdio.mjs`); tokens are 256 random bits, shown once, stored only as a SHA-256 hash (`core/persistence/src/mcp-client-store.ts`, migration 30). Tested with a simulated client (`core/runtime/test/mcp-server.test.ts`, `mcp-stdio-bridge.test.ts`). Unticked because **no real MCP client ever connected**. The handshake probes a client may send are answered per the 2025-06-18 spec (empty `resources/list`, `resources/templates/list`, `prompts/list`; `notifications/cancelled` ignored; `MCP-Protocol-Version` checked; batches `-32600`); the server is deliberately stateless (no `Mcp-Session-Id`) and non-streaming (no SSE), see [mcp-server.md](../mcp-server.md).
- [ ] Read tools: activity, meetings and decisions, knowledge-graph queries, CI and git state, memory (scoped by Phase 29 governance). Five read tools are built (`phoenix_activity`, `phoenix_meetings`, `phoenix_graph_query`, `phoenix_ci_git_state`, `phoenix_memory_search`; `core/runtime/test/mcp-tools.test.ts`); memory search uses the Phase 29 viewer scoping computed from the **client's** grants, never the owner viewer. Unticked: search is lexical only, the `phoenix_ci_git_state` happy path with real capabilities enabled is untested, `phoenix_meetings` needs the memory setting on and a `meeting:*` scope at sensitive (a deviation from a separate grant), and `phoenix_activity` is not scoped per client.
- [x] `request_approval` tool: shows the same approval card as Phase 56 and returns the decision. `phoenix_request_approval` creates the Phase 56 card through `AgentApprovals` as agent `mcp-<12 hex>`; it is decided only by the owner path and offers no "Always" rules; the card starts with server-added attribution (client name and id). Tested with the simulated client (`mcp-tools.test.ts`). No real client waited for a decision.
- [x] `notify` tool: lets an agent report state (working, waiting, done) to Fawkes. `phoenix_notify` publishes `mcp.agent.working|waiting|completed` (not `agent.*`, so it cannot fire workflows or pin Fawkes); state rules carry a time limit (`core/runtime/src/mcp/state-rules.ts`). Tested with the simulated client.
- [x] Per-client permission grants, visible and revocable in Settings; every call audited. New clients have no grants; grants are tool names plus memory scopes; revocation is re-checked on each request and again after each call; denials are audited; `McpClients.tsx` shows grants and revokes (`apps/web/test/mcp-clients.test.tsx`). Simulated client only.
- [x] Prompt-injection rule: tool results are marked untrusted data. Results are wrapped as untrusted data and redacted (`untrusted.ts`). This marks the boundary; it cannot stop a model that reads hostile text.

## Deliverables

- Core MCP server: built (`core/runtime/src/mcp/**`, `core/api/src/mcp-routes.ts`, `core/persistence/src/mcp-client-store.ts`, `apps/web/src/components/McpClients.tsx`, [mcp-server.md](../mcp-server.md), OpenAPI entries); simulated client only.
- Client setup snippets for Claude Code, Cursor, Codex and generic MCP clients: written in [mcp-server.md](../mcp-server.md) and **unverified** against the real clients.

## Exit criteria

- [ ] A real MCP client reads Phoenix context and gets an approval decided in Phoenix. **Unmet.** Only an in-repo simulated client over real loopback HTTP did this.
- [ ] A client without a grant is refused. **Unmet as a real-world criterion.** It is demonstrated by tests with the simulated client only; no real client was refused.

## Implementation notes

### What was built

- **Server** (`core/runtime/src/mcp/**`): JSON-RPC 2.0 with `initialize`, any `notifications/*` (accepted with 202 and ignored, `notifications/cancelled` included), `tools/list`, `tools/call`, `ping`, and empty answers to `resources/list`, `resources/templates/list` and `prompts/list` (no `resources`/`prompts` capability is declared because none is served; a `cursor` is `-32602`); every other method returns -32601 (`resources/read`, `prompts/get`, `logging/*`, `completion/*` included) and batches are refused with -32600 because revision 2025-06-18 removed them. An `MCP-Protocol-Version` header that is not one of the three supported versions is a 400 (after authentication). No `Mcp-Session-Id` is issued or required (stateless by design) and there is no SSE: replies are plain `application/json`, `GET`/`DELETE` are 405, all permitted by the transports page. It is hand-written; no MCP SDK is a dependency.
- **Loopback HTTP listener**: 127.0.0.1 only, off by default, default port 47822, `POST /mcp`, exact `Host`, any `Origin` refused, 64 KiB body limit, a rate limit; the kill switch closes it.
- **Stdio bridge** (`scripts/mcp/phoenix-mcp-stdio.mjs`): reads the token from `PHOENIX_MCP_TOKEN`, talks only to a loopback URL and does not follow redirects.
- **Clients and grants**: per-client tokens (shown once, SHA-256 only, migration 30); grants are tool names and memory scopes; a client cap and an audit-row budget for repeat denials.
- **Seven tools**: `phoenix_activity`, `phoenix_meetings`, `phoenix_graph_query`, `phoenix_ci_git_state`, `phoenix_memory_search`, `phoenix_request_approval`, `phoenix_notify`. Every call is audited, denials included.
- **Web and docs**: `McpClients.tsx` (grants, memory scopes, revoke, copy the token once), privacy kind `mcp` with inventory row `mcp_clients`, `mcp.*` interface strings (non-English text machine-generated and unreviewed), [mcp-server.md](../mcp-server.md), OpenAPI.

### Deviations

- `phoenix_meetings` has no grant of its own: it needs the memory setting on and a `meeting:*` scope at sensitive.
- Only `git.status` and `github.status` go through the policy engine; the other read tools are authorised by the client's grants and audited by the MCP handler.
- `phoenix_notify` publishes `mcp.agent.*`, not the `agent.*` namespace.

### Security review

An independent static review (read-only, not a human audit) found no critical or high issue. These were found and **fixed** with tests: approval cards now start with server-added attribution (client name and id); a client revoked mid-call cannot create a card; notify no longer publishes `agent.*` (which could fire workflows or pin Fawkes); the stdio bridge refuses redirects; git and activity paths are reduced to names; an audit-row budget for repeat denials; the client cap counted revoked rows; abandoned approvals could lock a client out.

**Not fixed (open):** plain HTTP gives no server identity, so anything that holds the port receives the token; a same-user process can hold the 16 allowed connections open and starve real clients (documented, not fixed); `phoenix_activity` is not scoped per client, so any client with that grant sees all live sessions; a client allowed to ask can still write a misleading `action` in an approval card.

### What was not built

Resources, prompts and logging (the server serves none), SSE and `Mcp-Session-Id` (not needed by the revision; see above), the legacy 2024-11-05 HTTP+SSE transport; hybrid (embedding) search for MCP clients; a separate `phoenix_meetings` grant.

### What was not run

Any real MCP client (Claude Code, Cursor, Codex or another): the handshake, the config snippets, an approval decided for a real client and a refusal of a real client were never exercised; the handshake probes are tested only with the simulated client. `phoenix_ci_git_state` was not run with the real git and GitHub capabilities enabled. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
