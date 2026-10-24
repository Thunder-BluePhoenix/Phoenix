# Phase 78 — Agent Cost Meter & Mission Control

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | 🟨 Built, exit criteria not met: ingest of what agents report, per-session/project/agent/day tokens and cost, budgets with early alerts, a board of sessions and a Mission Control page exist; tested with simulated sessions only; Claude Code's real status payload was never captured; Codex sends nothing by itself (only an explicit `phoenix_usage` from a Phoenix wrapper reaches the generic report; no Codex payload with tokens was observed); no cost figure was ever compared with a provider's own; both exit criteria are unmet |
| Depends on | [Phase 58 — Live Agent Sessions, Diffs & Plan Usage](phase-58-live-sessions-diffs-plan-usage.md) |
| Unblocks | — |

## Goal

See every agent session and what it costs in one place.

## Tasks

- [ ] Board of all agent sessions across repos by state: working, waiting on you, finished, stuck. Built: a board with an explicit, documented mapping (stuck = silent for more than N minutes, or a Phase 77 `agent.safety.stall` event from source `core`) in `core/runtime/src/agent-usage/board.ts`; page `MissionControl.tsx` at `#/mission`. Tested with fake sessions (`core/runtime/test/agent-usage-board.test.ts`, `apps/web/test/mission-control.test.tsx`). Unticked because **no real session from any agent was shown**; the board only saw simulated sessions. A throwaway cross-check showed that Phase 77's real stall event marks a session stuck on the real board.
- [ ] Tokens and cost per session, project, agent and day, from agent reports and plan usage. Built from what agents themselves report: the generic `POST /api/agent/live/usage` (`session_id` plus tokens) and the Claude statusline fields `cost.total_cost_usd` and `model.id`, with strict validation, clamps and per-day increments (`ingest.ts`, `agent-usage-ingest.test.ts`, `agent-usage-api.test.ts`). Cost is NULL unless the agent reported it or the user supplied a price (`agents.usage.prices` or `AiSettings.prices`); unknown is never shown as zero and partial sums read "or more". Unticked because Claude's status JSON has **no documented cumulative token fields** (Claude sessions show cost only), **Codex sends nothing by itself** (the installed generic hook sends the generic report only for an explicit `phoenix_usage` object from a Phoenix wrapper; no Codex payload with tokens or cost was ever observed), and no real payload was captured.
- [x] Budgets with alerts before they are reached. Daily and per-session budgets in tokens or cost; `agent.usage.warning` fires at 80 % and 95 % by default, once per budget per threshold per day, persisted (`core/runtime/src/agent-usage/runtime.ts`, `core/runtime/test/agent-usage-budgets.test.ts`). Simulated usage only.
- [x] Filters and search; jump to a session's terminal or detail. Built in `MissionControl.tsx` (jump-to-terminal is scoped by agent; `apps/web/test/mission-control.test.tsx`). No real terminal window was opened.

## Deliverables

- Mission-control page: built (`apps/web/src/components/MissionControl.tsx`, `apps/web/src/core/mission.ts`, `core/api/src/mission-routes.ts`, [mission-control.md](../mission-control.md), OpenAPI entries); simulated sessions only.
- Cost model per provider: **no built-in price table**. Cost comes only from what an agent reports or a price the user sets; privacy kind `agent_usage`, store `core/persistence/src/agent-usage-store.ts` over migration 32.

## Exit criteria

- [ ] Board shows real sessions from three agents. **Unmet.** Tested with fake sessions only ("simulated"); no real session from any agent, and Claude's real status payload was not captured (fixtures follow the public documentation).
- [ ] Cost totals match the providers' own figures for a test day. **Unmet.** No provider figure, bill or invoice was ever compared.

## Implementation notes

### What was built

- **Ingest and store** (`core/runtime/src/agent-usage/**`, `core/persistence/src/agent-usage-store.ts`, migration 32): strict validation, clamps, per-day increments, per-agent daily caps; clamped amounts do not advance baselines; a delete-all watermark; retention is the setting `agents.usage.keep_days` (whole days, 7 to 3650, default 400; set with `keep_days` on `POST /api/mission/config`, audited, shown in the config view and in a field on the mission page). Older rows are pruned on the next report after a day change or a changed value, and when Core starts.
- **Pricing**: cost is NULL unless reported or priced by the user; an unpriced row is surfaced in cost budgets.
- **Budgets**: daily and per-session, tokens or cost, `agent.usage.warning` at 80 and 95 % by default, once per budget per threshold per day, persisted.
- **Board and routes** (`mission-routes.ts`): sessions by working / waiting on you / finished / stuck; tokens and cost per session, project, agent and day; filters and search; jump to terminal or detail scoped by agent.
- **Web and docs**: `MissionControl.tsx`, `mission.*` interface strings (non-English text machine-generated and unreviewed), privacy kind `agent_usage`, [mission-control.md](../mission-control.md).

### Deviations

- No cost model per provider and no built-in price table: unknown cost stays unknown.
- Claude sessions show cost only, because the documented status JSON has no cumulative token fields.

### Security review

An independent static review (read-only, not a human audit) was followed by fixes, each with tests: `agent.usage.warning` is now core-only in `POST /api/events` and checked in the web hook; per-agent daily caps; clamped amounts no longer advance baselines; a delete-all watermark; unpriced rows are surfaced in cost budgets; jump-to-terminal is scoped by agent.

**Not fixed (open):** Core cannot tell a real usage report from a forged one, so whoever can post to the usage route can pre-consume Core's per-day limits or move a session's baseline, and a forged report can consume a dedup marker early; `resets_at` is UTC midnight of the next local day, which is wrong in non-UTC zones; the time zone is fixed at construction; `agent_usage` has no index on `(agent, session_id)` (migrations are parent-owned, reported).

### What was not built

Token counts for Claude sessions; usage reports that Codex sends by itself (the installed generic hook `agent-hook.ts` sends the generic report only for an explicit `phoenix_usage` object produced by a Phoenix wrapper, because no Codex hook payload with token counts or cost was ever observed or found in the repo; test `capabilities/agents/test/usage-hook.test.ts`); a per-provider price table; a per-class retention setting (the one retention setting covers all usage rows).

### What was not run

Any real agent, provider, invoice or status payload. Claude Code's real status JSON was not captured; no real Codex hook payload was captured either, and nothing wraps Codex to produce `phoenix_usage`. Open items are in the [gap register](../gaps.md).


## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
