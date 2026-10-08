# @phoenix/policy

Policy engine for AI tool calls (Phase 30). It turns a `ToolRequest` into a `PolicyDecision`
(`allow` / `deny` / `require_approval`, a risk tier, reasons and the ids of what matched), and
writes every decision to the audit log before anyone can act on it.

## Risk tiers

Derived from the tool's declared side effect, its permissions and the environment. The caller
cannot influence it.

| Side effect        | local / dev / staging | production   |
| ------------------ | --------------------- | ------------ |
| `none`, `read`     | low                   | high         |
| `write`, `execute` | medium                | **critical** |
| `external`         | high                  | high         |
| `production`       | **critical**          | **critical** |

The `production_action` permission counts as "production" in any environment: a read becomes
high, a write/execute/production-effect becomes critical. Production is therefore never below High.

## Decision order (first match wins)

1. Kill switch engaged → `deny`.
2. Malformed request (tool ≠ capability.command, unknown enum, no actor id, clock skew > 5 s) → `deny`.
3. Unknown tool (not in the registry of enabled capabilities) → `deny` (default deny).
4. Stored rules cannot be read/validated → `deny` (fail closed).
5. Any matching `deny` rule → `deny`. **Deny always wins.**
6. Request not directly asked for by the user (`trustedByUser: false`) above low risk → `require_approval`.
7. Matching `require_approval` rule → `require_approval`.
8. Low risk → `allow`. Medium risk → `allow` unless the actor is an `agent`.
9. Critical, or high for an `agent` → `require_approval`. No rule or temporary approval can lift this.
10. Matching `allow` rule or live temporary approval → `allow`, otherwise `require_approval`.

`require_approval` is carried out through the existing `PermissionGateway` confirmation flow (the
tool gateway does not have its own approval path). Policy only narrows what the permission
gateway already enforces; it never replaces its grants, confirmations or kill switch.

## Rules

Typed JSON, validated on write and on read, stored in `policy_rules` (migration 6). A rule
matches on tool pattern, actor kind/id, environment, resource (exact or `prefix*`), data class,
side effect, permission and a UTC time window. `allow` rules must name a tool and environments;
`*` for everything is refused.

## Changing policy

Only through `PolicyAdmin`, a capability object the API layer constructs for requests on an
authenticated user channel. The agent runtime and the tool gateway get a `PolicyEngine`, which has
no mutating method. Every `PolicyAdmin` method also refuses any actor that is not
`{ kind: "user", trustedByUser: true }`, audits the refusal and throws `PolicyError("NOT_USER_ACTOR")`.
Text in a request, a payload or a tool result has no path to either object.

## Temporary approvals

`approveTemporarily({ toolPattern, scope: { environment, resource, actorId? }, ttlMs, by })`:
scoped to one tool (or one capability's tools), one environment and one resource (no `*`),
capped at 24 h, revocable, at most 100 live. Expiry is evaluated at decision time
(`expiresAt > now`; at exactly `expiresAt` it is gone). It cannot cover critical actions, and
cannot lift high-risk actions for agents.

## Audit

Decisions go to the `AuditLog` of `@phoenix/permissions` (same table, same ordering and
redaction). `PolicyEngine.decide()` throws `AUDIT_FAILED` if the write fails; the returned
`AuditedDecision` can only be created there (`assertAudited`).
