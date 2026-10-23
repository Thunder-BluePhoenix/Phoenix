# phoenix CLI (Phase 89, terminal slice)

`apps/phoenix-cli` (`@phoenix/cli`, bin `phoenix`) is a command line for the loopback Core API. It uses
only `node:*` modules and the global `fetch`; it has no runtime dependency and imports no workspace
package. This build ships **status, approvals, an event tail and keep-awake**. `phoenix ask` is
**not built** (see [What is not built](#what-is-not-built)).

```
phoenix status [--json]
phoenix approvals list [--json]
phoenix approvals approve <id> [--ref <ref>]
phoenix approvals deny <id> [--ref <ref>]
phoenix events tail [-n <count>] [--follow] [--source <name>] [--type <type>] [--json]
phoenix awake <duration> [--reason <text>]
phoenix awake extend <duration>
phoenix awake end
phoenix awake status [--json]
```

Global options: `--url` (default `http://127.0.0.1:4870` or `PHOENIX_CORE_URL`), `--data-dir` (or
`PHOENIX_DATA_DIR`), `--json`. Run it from the repo with `npx tsx apps/phoenix-cli/src/main.ts …` (the
`bin` entry is a TypeScript file with a `tsx` shebang, like `phoenix-simulate`; there is no build step
or published artifact yet).

Exit codes: `0` ok, `1` failed (Core rejected the token or the request, unexpected answer), `2` usage
(bad flag, no token file, non-loopback URL), `3` Core unreachable, `4` refused (a decision the CLI
would not send, or that Core no longer accepts).

## How it authenticates

Core writes its per-run session token to `<data dir>/session.token` (mode `0600`) and deletes it on
shutdown (`core/runtime/src/runtime.ts`, `writeTokenFile`). The CLI looks for it, in order, in:
`PHOENIX_SESSION_TOKEN`, `--data-dir`, `PHOENIX_DATA_DIR`, `./.phoenix/<env>/`, `~/.phoenix/<env>/`
(`PHOENIX_ENV`, default `dev`), the same order as `resolveSessionToken` in the capability SDK. Every
request carries `Authorization: Bearer <token>` and `X-Phoenix-Client: phoenix-cli`.

- The token is **never printed**: not on success, not in `--json`, not in an error. Any string that
  contains it (a Core error message, a network error) is redacted before it reaches stderr.
- A token file readable by other users produces a warning that names the file, not the value.
- The Core URL must be `http://` on `127.0.0.1`, `localhost` or `[::1]`, with no credentials, query or
  fragment. Anything else exits `2` before a request is made, so the token cannot be sent to another
  host or over a channel that is not the loopback interface. Redirects are not followed
  (`redirect: "error"`), so a hostile listener on the port cannot bounce the token elsewhere.
- Requests time out after 10 s; a response over 4 MiB is refused.

## Approvals

`phoenix approvals list` merges the two places Core keeps requests that wait for a person, through
routes that already exist:

| Source         | Listed from                | Decided through                                          |
| -------------- | -------------------------- | -------------------------------------------------------- |
| `confirmation` | `GET /api/confirmations`   | `POST /api/confirmations/:id {approve, ref}`             |
| `agent`        | `GET /api/agent-approvals` | `POST /api/agent-approvals/:id/decision {behavior, ref}` |

Both are the same audited paths the web UI uses (`PermissionGateway.resolveConfirmation` and
`AgentApprovals.decide`, which write the audit log and publish their events). The CLI adds no route and
no new way to approve. Agent **questions** are left out of the list: they need a text answer, not
allow/deny. A Core without the agent-approval service answers `404` there; that counts as "none".

### A decision is bound to the request

Each listed request has two references:

- a **short ref**: the first 16 hex characters of the CLI's local hash over every field it listed, used
  to detect that a copied `--ref` is stale before the CLI sends anything; and
- a **Core ref**: a full 64-hex SHA-256 digest Core issued over the exact redacted pending view plus its
  source, under the domain `phoenix-approval-ref-v1`. The CLI never creates it and includes it in its
  decision body. When the client label is `phoenix-cli`, Core recomputes and verifies that digest in
  constant time before it resolves the request. A missing, malformed, cross-request or stale Core ref
  returns `409 EVENT_DUPLICATE` and leaves the request pending.

The full ref covers the id, requester, command or summary, permissions, risk, target, expiry and every
other field Core listed. Deciding re-reads the pending list and:

1. refuses (`4`) if the id is no longer waiting (decided elsewhere, expired, never existed);
2. refuses if a quoted `--ref` does not equal the short ref of the request **as it is now**;
3. refuses if the request has expired by the CLI's clock;
4. for **approve** without `--ref`, prints the full request and asks `Approve this request? [y/N]` on
   an interactive terminal; with no terminal it exits `2` rather than approving blind;
5. sends `{"approve": true|false, "ref": <Core ref>}` or `{"behavior": "allow"|"deny", "ref": <Core
ref>}`. It never creates an "always allow" rule, never attaches a message, and there is no
   approve-all.

**deny** needs no short `--ref` (refusing is always safe), but Core still binds it to the record it just
listed. If Core answers `404`/`409` to the decision (someone else decided first or the Core ref is stale)
the CLI reports "refused", not a crash.

This removes the CLI list/decision TOCTOU window. It does **not** authenticate a person: any local process
that holds the session token can list a request, obtain its Core ref and decide it. The web, phone and
internal flows retain their existing authenticated paths; the server binding is deliberately scoped to
`x-phoenix-client: phoenix-cli`.

### Untrusted text

Commands, paths, summaries, event descriptions and capability ids come from other programs. The CLI
prints them as one line each, replacing control, format and line-separator characters (including ESC,
BEL and NEL) and collapsing whitespace, and truncating long values. A command that contains a newline
and a fake "Approved by user" line cannot start a line of its own.

## Events

`phoenix events tail` reads `GET /api/events` (newest first on the wire, printed oldest first).
`-n` (0..1000, default 20) is the count of past events; `--source` and `--type` filter on the server.
With `--follow` it polls every 2 s using `after_seq`, starting after the newest event in the **whole**
history (so a filtered tail does not replay old events). If Core goes away while following, it warns
once on stderr, keeps retrying, and says when Core is back; a rejected token (Core restarted and issued
a new one) or a malformed answer ends the tail with exit `1`. `SIGINT`/`SIGTERM` end it with `0`.
This is polling, not the WebSocket (`/api/ws`): a burst of more than 1000 events between polls is
reported as skipped.

## Status

`phoenix status` combines `GET /api/health`, `GET /api/pet/state` and the pending-approval count:
Core version, environment and uptime, Fawkes state and its explanation, active tasks, approvals waiting,
the kill switch, and any **enabled** capability whose health is not `healthy`. `--json` prints a single
document with the same facts.

## Tests

`apps/phoenix-cli/test/` runs the real CLI entry (`run`) against:

- a local fake Core (`fake-core.ts`, `node:http` on port 0) for the boundary cases: wrong or rotated
  token, non-JSON answers, redirects, outages while following, a request that changes after it was
  listed, an expired or already-decided request, hostile text;
- the real `PhoenixRuntime` on a loopback port for one confirmation, one agent approval and the event
  history, checking the audit entry and the `phoenix-cli` client label in Core.

Time, sleeping and the fetch function are injected; no test waits on a real timer.

## Keep awake

`phoenix awake 2h --reason "overnight build"` calls the existing keep-awake capability command
(`POST /api/capabilities/awake/commands/start`, then polls `GET /api/operations/:id`); `extend`, `end`
and `status` call the capability's commands of the same names. A duration is whole minutes, hours or
days (`90`, `90m`, `2h`, `1d`; 1 minute to 7 days); `1.5h` is refused rather than rounded, so the
minutes the person approves are exactly the minutes typed. `--reason` is one line of at most 80
characters without control or invisible characters.

- **Core asks, the CLI never answers.** `start`, `extend` and `end` are `execute` commands, so the
  permission gateway raises a confirmation naming the minutes. The CLI prints "Waiting for you to
  approve this in Phoenix" on stderr and polls; the person answers in the app or with
  `phoenix approvals approve`. If nobody answers within 330 s (Core's own confirmation expires at five
  minutes) it exits `4` and says nothing was changed by this command yet.
- A "no" from the person or the emergency stop exits `4` (refused), not `1` (failed). A start while a
  session already runs, or an `extend` with none, exits `1` with Core's message.
- If a command is cancelled after it was sent, Core cannot prove whether it took effect; the CLI says
  so and points at `phoenix awake status`.
- `status` is a read and asks nothing. `--json` prints `{active, mode, label, endsAt, remainingSeconds,
agentsWorking, batteryFloorPercent}` with unsafe characters escaped.
- Tested against the real `PhoenixRuntime` with the real keep-awake capability on a fake machine
  (`capabilities/awake/testing/fakes.ts`), so no `caffeinate`, `systemd-inhibit` or PowerShell ran, and
  never against a real sleeping machine. Windows, Linux and a real macOS hold are unverified.

## What is not built

- `phoenix ask "…"`: not built. There is no dedicated Core route for asking a question, and no stand-in
  was written.
- No `phoenix approve` shortcut (the command is `phoenix approvals approve <id>`).
- No packaged binary, npm publish, shell completion, or WebSocket-based tail.
- **Core cannot tell the CLI from a person.** Any program on the machine that can read
  `session.token` can run these commands, including approving, exactly as it could call the routes
  directly. The ref and the interactive confirmation make a decision about a specific request that a
  human reviewed in the normal use; they do not stop a hostile local process that already holds the
  token. This is the existing session-token gap recorded in [gaps.md](gaps.md), unchanged by this
  slice.
- Verified only against a fake Core and an in-process `PhoenixRuntime` in tests. Not run on Windows
  (the token-file permission warning is skipped there) and not exercised in a real terminal session.
