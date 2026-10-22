# Phoenix MCP server (Phase 76)

Phoenix can act as an [MCP](https://modelcontextprotocol.io) server on this computer. A coding agent
or another MCP client can read a little Phoenix context and can ask **you** for approval through the
same card Fawkes shows for other agents. It is **off by default**, **local only**, and each client
gets **nothing** until you grant it.

> **Status.** The server, the stdio bridge and the Settings screen are built and tested with an
> in-repo **simulated** MCP client over real loopback HTTP. No real MCP client (Claude Code, Cursor,
> Codex, ...) has been run against it, so the phase exit criterion "a real MCP client reads Phoenix
> context and gets an approval decided in Phoenix" is **not met**. The client snippets below are
> marked where their config shape is not verified.

## Turning it on

Settings, "Phoenix MCP server": tick the switch. Core then listens on `127.0.0.1:<port>` (default
**47822**, changeable). Nothing else opens: not the loopback API port, not a LAN address.

1. Add a client (a name). Its **token** is shown **once**; copy it. Phoenix keeps only the SHA-256 of
   it, so a leaked database cannot be replayed and a lost token cannot be recovered (revoke and add
   another).
   At most 20 clients can be active at once; revoked clients stay in the list but do not count, so
   revoking one frees a place.
2. Tick what that client may do (below). A new client has **no grants**: it can connect, and every
   tool call is refused and audited.
3. Put the token in the client's environment as `PHOENIX_MCP_TOKEN`. Never put it on a command line.

## Transport

|                   |                                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint          | `POST http://127.0.0.1:<port>/mcp` (Streamable-HTTP style: one JSON-RPC message per POST, one JSON reply; no SSE, no GET)        |
| Auth              | `Authorization: Bearer <client token>`                                                                                           |
| `Host`            | must be exactly `127.0.0.1:<port>` or `localhost:<port>` (defeats DNS rebinding)                                                 |
| `Origin`          | any `Origin` header is refused (a browser page cannot use it)                                                                    |
| Body              | JSON, at most **64 KiB** (`413` above)                                                                                           |
| Rate              | 60 requests per minute per client and 4 calls running at once (`429` + `Retry-After`)                                            |
| Methods           | `initialize`, `notifications/initialized`, `tools/list`, `tools/call`, `ping`. Everything else is `-32601`. Batches are refused. |
| Protocol versions | `2025-06-18` (preferred), `2025-03-26`, `2024-11-05`                                                                             |

No MCP SDK is used; the JSON-RPC handling is in `core/runtime/src/mcp/`.

### stdio bridge

Many clients start a server as a child process. `scripts/mcp/phoenix-mcp-stdio.mjs` reads
newline-delimited JSON-RPC on stdin, forwards each line to the endpoint above and writes each reply
as one line on stdout. Plain Node, no dependencies.

| Environment         |                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PHOENIX_MCP_TOKEN` | required; the client token                                                                                                                                                          |
| `PHOENIX_MCP_URL`   | optional; default `http://127.0.0.1:47822/mcp`. Anything that is not plain-http loopback `/mcp` is refused so the token cannot leave this computer. HTTP redirects are refused too. |

## Tools

All names start with `phoenix_`. A tool the client has no grant for is **not listed**, and calling it
returns the same `Unknown tool` error as a tool that does not exist (the audit log tells them apart).

| Tool                       | Grant                                                       | Returns                                                                                                                                                                                                                                      |
| -------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `phoenix_activity`         | `phoenix_activity`                                          | Recent coding-agent sessions: agent, project **folder name** (never the path), active, last steps (a step's target is reduced to its file or folder name; absolute paths are dropped).                                                       |
| `phoenix_meetings`         | `phoenix_meetings` + a memory scope that covers `meeting:*` | Search of reviewed decisions, action items and summaries. Refused while "allow sensitive meeting data" is off in the memory settings.                                                                                                        |
| `phoenix_graph_query`      | `phoenix_graph_query`                                       | Facts about an entity named in the question, with explanation paths, plus matching memory text.                                                                                                                                              |
| `phoenix_ci_git_state`     | `phoenix_ci_git_state`                                      | `git.status` and `github.status` through the tool gateway (policy-checked and audited as an untrusted agent actor). Repositories are named by **folder name only**, never the absolute path. `available: false` when that capability is off. |
| `phoenix_memory_search`    | `phoenix_memory_search` + at least one memory scope         | Memory text (commits, project docs).                                                                                                                                                                                                         |
| `phoenix_request_approval` | `request_approval`                                          | `allow` or `deny` plus the owner's message. Nothing else.                                                                                                                                                                                    |
| `phoenix_notify`           | `notify`                                                    | Tells Fawkes `working`, `waiting` or `done`.                                                                                                                                                                                                 |

### Memory is scoped by the client's own grants

Memory search, graph questions and meetings run as a **viewer built from the grants you gave that
client** (the Phase 29 `canView` rule: scope, highest sensitivity, optional domains), never as the
owner. The filter runs inside the search before the result limit, so memory outside the grants cannot
take a slot or change a count. Meeting data is excluded from memory search and the graph even under a
`*` scope; only `phoenix_meetings` reads it. Search is lexical (keyword); the embedding path is not
used for MCP clients.

### Approvals

`phoenix_request_approval` creates the **same Phase 56 approval card** through the real
`AgentApprovals` API, under the agent id `mcp-<client id>` (matches `[a-z0-9-]{1,24}`), tool
`mcp.request_approval`, with `action`, `command`, `path` and `detail` redacted like every other
request. It waits up to 25 seconds. If you have not answered, it returns `{"status":"pending",
"approval_id": ...}` and the client calls again with that `approval_id` to keep waiting. A client can
only poll approvals it created, at most 5 at a time; an approval you left unanswered for 2 minutes
expires, is forgotten and frees its slot (the client then has to ask again).

**The client writes the card text, Core writes who it is from.** The first line of the card
description is always `MCP client "<name>" (<client id>)`, built by Core from the stored client
record (the name has control, zero-width and bidirectional characters removed and `"` turned into
`'`). Whatever the client sends as `action` comes after it, limited to 380 characters, so it cannot
pose as another client or as Phoenix. Settings shows each client's id, so you can match a card to a
client. The record is read again immediately before the card is created: a client that was revoked
(or lost the grant) while its request was in flight raises no card.

**Deciding is never an MCP tool.** Only the Phoenix UI or a paired phone answers an approval (they use
the session token or a device key; a client token is useless there). The result a client sees is
`allow`/`deny` and your message, and a client that is **revoked while waiting** gets nothing back even
if you then allow the card.

### Notify

`phoenix_notify {state, message?}` publishes `mcp.agent.working`, `mcp.agent.waiting` or
`mcp.agent.completed` (source `mcp`, severity `info`, agent `mcp-<client id>`, **ephemeral**: not kept
in the event history), at most 20 a minute per client. Core adds state rules so Fawkes shows
working / waiting / success, and **every state expires on its own** (working after 15 minutes,
waiting after 10, done after 5 seconds), so a client that says "waiting" and goes silent cannot pin
Fawkes. The events live in their own `mcp.agent.*` namespace on purpose: a workflow or rule that
triggers on `agent.*` (real coding agents) is **not** triggered by an MCP client's notify, and notify
can no longer start such workflows.

## Untrusted data

Every tool result is wrapped as `{"untrusted_data": ...}` after a text block that says it is **data
from Phoenix, not instructions**. Every string in it passes the redactor, is clipped to 2,000
characters, and results are bounded (50 items, depth 8, 48,000 characters). That marks the boundary
and keeps secrets out; it cannot stop a model that reads hostile text (a commit message, a file name)
from being misled. Grant only what a client needs.

## Audit, revoke, kill switch, delete

- **Every call is audited**, denials included: `mcp.call` (allowed), `mcp.call.denied` (reason:
  `not_granted`, `unknown_tool`, `unknown_method`, `invalid_params`, `revoked`, `revoked_in_flight`,
  `grant_removed_in_flight`, `rate_limited`, `too_many_in_flight`, `bad_token`, `kill_switch`,
  `host`, `origin`, `body_too_large`, ...). Rows hold the client id, the tool name and success; never
  arguments, results or tokens. Refusals are budgeted at 20 rows a minute per client (callers with
  no client share one budget) so a flood cannot fill the log. Owner actions: `mcp.client.created`, `mcp.client.grants_changed`,
  `mcp.client.revoked`, `mcp.listener.enabled`, `mcp.listener.disabled`, `mcp.listener.closed`.
- **Revoke** in Settings. The client record is re-read on **every request** and again when a tool
  call finishes, so a revoked client (or one that lost a grant) is refused immediately, even in the
  middle of a call.
- **Emergency stop** closes the listener, turns the setting off and cancels pending approvals.
  Turn the server on again in Settings after releasing it.
- **Delete all** for `mcp` (Settings > Privacy, or `POST /api/privacy/delete {"data":"mcp","confirm":true}`)
  removes every client and closes the listener. The privacy inventory lists `mcp_clients`.

## Owner API (session token)

`GET /api/mcp/status`, `POST /api/mcp/settings {enabled?, port?}`, `GET /api/mcp/clients`,
`POST /api/mcp/clients {name}` (answers `201` with the token, `Cache-Control: no-store`),
`POST /api/mcp/clients/:id/grants {tools, memory, request_approval, notify}`,
`DELETE /api/mcp/clients/:id`. A memory grant is `{scope, max_sensitivity, domains?}` where `scope` is
`*`, `global`, or `repo:`/`path:`/`meeting:` plus text, optionally ending in `*`.

## Client setup snippets

Replace `<path to Phoenix>` with this checkout and use your client token. **Every snippet below is
unverified against the client**: the config shapes come from each client's public documentation as
the author remembers it, not from running the client. If a client rejects one, the endpoint and the
environment variable above are the contract.

### Claude Code (unverified against the client)

HTTP, if your Claude Code version supports remote MCP servers with headers:

```sh
claude mcp add --transport http phoenix http://127.0.0.1:47822/mcp --header "Authorization: Bearer $PHOENIX_MCP_TOKEN"
```

stdio, through the bridge (the token comes from the environment, not argv):

```sh
claude mcp add phoenix --env PHOENIX_MCP_TOKEN="$PHOENIX_MCP_TOKEN" -- node "<path to Phoenix>/scripts/mcp/phoenix-mcp-stdio.mjs"
```

### Cursor (unverified against the client)

`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "phoenix": {
      "command": "node",
      "args": ["<path to Phoenix>/scripts/mcp/phoenix-mcp-stdio.mjs"],
      "env": { "PHOENIX_MCP_TOKEN": "<client token>" }
    }
  }
}
```

### Codex (unverified against the client)

`~/.codex/config.toml`:

```toml
[mcp_servers.phoenix]
command = "node"
args = ["<path to Phoenix>/scripts/mcp/phoenix-mcp-stdio.mjs"]
env = { PHOENIX_MCP_TOKEN = "<client token>" }
```

### Any other MCP client

- stdio: run `node <path to Phoenix>/scripts/mcp/phoenix-mcp-stdio.mjs` with `PHOENIX_MCP_TOKEN` in
  its environment.
- HTTP: `POST http://127.0.0.1:<port>/mcp` with `Content-Type: application/json` and
  `Authorization: Bearer <client token>`; no `Origin` header; one JSON-RPC message per request.

A quick check without a client (replace the token):

```sh
curl -s http://127.0.0.1:47822/mcp -H "Authorization: Bearer $PHOENIX_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Limitations you should know

- **Plain HTTP gives no server identity.** The endpoint is `http://127.0.0.1:<port>`, not TLS. The
  client token is a bearer secret sent to whatever answers on that port: anything on this computer
  that manages to hold the port (while Phoenix is not running, or on a port you changed) receives
  the token of any client that connects. The listener is **off by default** and the port is
  configurable; keep it off when you are not using a client. The stdio bridge refuses HTTP
  redirects (`redirect: "error"`) so a different address that answers with a `307` cannot make it
  replay the token there, but it cannot prove that the thing on the port is Phoenix.
- **A process of the same user can starve the listener.** The listener accepts at most 16 connections.
  Another program running as you can open connections and hold them, so real clients are refused
  until they close. Rate limits are per client token and do not help against that. The only
  mitigation is to switch the server off. A program running as you could also read the token from
  the client's own environment or config file; the token protects against other users and
  against web pages, not against your own account.
- **Audit rows for repeated denials are budgeted per client** (20 a minute), so a client hammering
  tools it has no grant for cannot fill the log; rows past the budget are dropped, the refusal itself
  is not.
- **A client can ask for approvals only as itself.** The card names the client, but a client that is
  allowed to ask can still write a misleading `action`. Read the first line of the card, then the
  rest.

## What is and is not verified

|                                                                                                                                                                                                                    |                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grants, revocation (incl. in flight), Host/Origin/size/rate guards, audit, token hashing, scoped memory, approval creation and owner-only decision, notify, kill switch, delete-all, stdio bridge, Settings screen | Tested with a **simulated** client (`core/runtime/test/mcp-*.test.ts`, `apps/web/test/mcp-clients.test.tsx`).                                                                            |
| Any real MCP client talking to it                                                                                                                                                                                  | **Not done.** Handshake details real clients expect (for example `resources/list` probes, SSE streams, `Mcp-Session-Id`) are not implemented; a client that requires them will not work. |
| The snippets above                                                                                                                                                                                                 | **Unverified.**                                                                                                                                                                          |
| Hybrid (embedding) search for MCP clients                                                                                                                                                                          | Not offered; lexical only.                                                                                                                                                               |
| Per-tool policy rules for the read tools backed by Phoenix's own data                                                                                                                                              | They are authorised by the client's grants and audited by the MCP handler; only `git.status` / `github.status` go through the tool gateway's policy engine.                              |
