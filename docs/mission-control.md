# Mission control and the agent cost meter (Phase 78)

One page, `#/mission`, shows every coding-agent session Phoenix knows of by state, and what the
agents **say** they used. Everything is stored and computed on this computer.

> **Not verified against the provider's bill.** Every token and cost number comes from the agent
> itself. Phoenix cannot check it, and no test or review in this repository compared it with a real
> invoice. The page says so next to the totals.

## What was and was not verified

| Claim                                                                        | Status                                                                                                                                                    |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Board shows real sessions from three agents (exit criterion)                 | **Unmet.** Tested with fake sessions only ("simulated").                                                                                                  |
| Cost totals match the providers' own figures for a test day (exit criterion) | **Unmet.** No provider figure was ever compared.                                                                                                          |
| Claude Code's status JSON fields                                             | Taken from the public documentation (https://code.claude.com/docs/en/statusline). Real payloads were **not captured**; fixtures follow the documentation. |
| Codex, Gemini and others                                                     | They send nothing about tokens to Phoenix today (see "What an agent can report").                                                                         |

## Where the numbers come from

Phoenix reads **only what an agent reports about its own session**. It never reads transcripts and
never estimates tokens.

### Claude Code (status line)

Phoenix's `statusLine` wrapper (Phase 58, `capabilities/agents/src/statusline.ts`) already reads the
status JSON. Phase 78 additionally forwards, from fields the documentation lists:

| Field                                                     | Used for                                                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `session_id`                                              | which session                                                                                                                                                |
| `cost.total_cost_usd`                                     | the cost Claude Code shows. The documentation calls it an estimate computed client-side "that may differ from your actual bill"; it resets to 0 on `/clear`. |
| `model.id`                                                | the model name, to find the price you entered                                                                                                                |
| `workspace.project_dir` / `workspace.current_dir` / `cwd` | reduced to the **folder name**; the path is never stored                                                                                                     |

**Not read:** `context_window.total_input_tokens` / `total_output_tokens`. The documentation says
these count what is _currently in the context window_ (the output count is the most recent response
only), so they are not session totals. Claude Code's cumulative token counts are therefore not
available to Phoenix; with Claude Code you get a **cost** (as Claude Code shows it) but no token
totals unless something else reports them.

### Any agent (generic report)

`POST /api/agent/live/usage` (session token) or the Phase 57 relay's `usage` operation accepts a
token report. It is told apart from a plan-window sample by having a `session_id`:

```json
{
  "agent": "my-agent",
  "session_id": "abc",
  "model": "m-1",
  "project": "/path/to/alpha",
  "input_tokens": 1200,
  "output_tokens": 300,
  "cost_usd": 0.02
}
```

All numbers are **running totals for the session**, not increments. Core stores the difference since
the previous report, on Core's own clock's local day. A total that goes down is a reset (Claude Code
resets on `/clear`) and counts from zero. Fields you do not send stay unknown (never zero).

### Validation and clamps

Agents can lie and Core cannot check, so every number is bounded:

- Strict validation: unknown fields, strings, fractions, negatives, `NaN`/`Infinity` and
  `input_tokens`/`output_tokens` above 1e12, `cost_usd` above 100 000 are refused (HTTP 400).
- One report adds at most 50 000 000 tokens per field and 1 000 USD.
- One session adds at most 500 000 000 tokens and 10 000 USD per day; one agent (all its sessions) 2 000 000 000 tokens and 20 000 USD per day; all sessions together
  5 000 000 000 tokens and 50 000 USD per day.
- The day is Core's, never the sender's. Project is cut to a folder name of at most 120 characters.

## Cost: known, computed from your price, or unknown (never zero)

A cost exists in exactly three cases:

1. the agent reported one (`cost_usd`, as Claude Code's status line does), or
2. you entered a price for the model, in US dollars per million tokens (Mission page, **Prices**;
   stored in the setting `agents.usage.prices`, keyed by the model id the agent reports), or
3. the AI settings contain exactly one distinct price for a model with that id
   (`<provider>:<model>` keys). Two different prices for one id are ambiguous: cost stays unknown.

**Phoenix has no built-in price table**, for any provider. Otherwise the cost is **unknown**
(`null` in the database and the API; the page says "Cost unknown"). A sum with some unknown parts
shows "$X or more". A price you set to `0` is a real zero; a missing price is not.

## Storage

Migration 32 `agent_usage`: one row per day, session, agent and model with the **increment**
recorded that day (`input_tokens`, `output_tokens`, `cost_micro` = millionths of a dollar or NULL)
and the project **folder name**. No prompts, outputs, commands, file names or paths. Rows older than
the retention (setting `agents.usage.keep_days`, 7–3650 whole days, default 400) are dropped. Privacy inventory row `agent_usage`; delete all with
`POST /api/privacy/delete {"data":"agent_usage","confirm":true}` or
`DELETE /api/mission/usage?confirm=true` (audited, `secure_delete`). Delete-all also writes each live
session's running-total baseline to the setting `agents.usage.reported` (a hash of agent and session id, never a name), so a session that repeats its total after a Core restart or after its in-memory baseline was dropped adds only the difference: the delete is not undone. It also deletes the budget `agent.usage.warning` events from the event history (plan-usage warnings are not touched).

## The board: states

Each session from the three sources (hook **reports** via the `agents` capability `list`, sessions
with **steps** from `AgentLive`, and **orchestrated** `ph-…` sessions from `session.list`) is merged
by `<agent>:<session id>` and put in one column.

| Source state                                                                                                       | Column                         | Notes                                                              |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------ |
| report `completed` or `failed`; orchestrated `completed` / `failed` / `stopped`                                    | **Finished**                   | A stall flag never moves it.                                       |
| report `waiting` (reason: permission, input or idle); orchestrated `waiting`                                       | **Waiting on you**             | Silence does not move it; a stall flag does not either.            |
| report `started` / `working`, orchestrated `running`, with a `agent.safety.stall` event newer than its last report | **Stuck** (reason: safety net) | Phase 77 events, see below.                                        |
| the same, no report for **more than 30 minutes** (setting `agents.usage.stuck_after_min`, 5–1440)                  | **Stuck** (reason: no report)  | Same idea as the stall rule: "active but silent".                  |
| the same, otherwise                                                                                                | **Working**                    |                                                                    |
| only steps seen (no state report), last step under 10 minutes ago                                                  | **Working**                    | AgentLive's "active" rule.                                         |
| only steps seen, last step older                                                                                   | **Finished**                   | Core cannot tell "ended" from "idle"; it does not guess "working". |
| any state this build does not know                                                                                 | **Finished**                   | Shown, not guessed at.                                             |

Orchestrated sessions have no activity timestamp, so silence alone never marks them stuck.
Within a column, newest activity first; the columns are ordered Waiting, Stuck, Working, Finished.

**Phase 77:** Core listens for `agent.safety.stall` events (source `core`, payload
`agent` and `session_id`). The Phase 77 module did not exist when this was built, so the payload
shape is _assumed_, not checked against its code. A malformed or non-Core event is ignored.

**Sources that fail:** if the `agents` capability is off or not answering, the page says the board
may be incomplete and still shows the sessions it could read.

## Budgets

Daily or per-session, in tokens or US dollars, optionally for one agent (Mission page, **Budgets**;
setting `agents.usage.budgets`, at most 20). An alert is the existing **`agent.usage.warning`**
event (so the existing notification and Fawkes paths apply), fired **before** the limit at the same
percentages as the plan-usage warnings (default 80 % and 95 %; setting `agents.usage.thresholds`;
the highest is severity `error`, lower ones `warning`). One alert per budget per threshold **per
day** (per session for session budgets); the next day it can fire again. The "already alerted"
markers survive a restart (`agents.usage.budget_fired`; today's and yesterday's are kept, and when more than 2 000 are held the oldest **day** goes first). A cost budget never
fires on an unknown cost; usage without a known cost is not in its figure, so when some exists
(`unpriced_rows` > 0) the page says **"at least $X"**. `agent.usage.warning` is reserved for Core: `POST /api/events` refuses it, and the page ignores one whose source is not `core`.

## API

| Route                                                 |                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `GET /api/mission?days=14`                            | board, totals by day / agent / project / session, budgets (days 1–90)                 |
| `GET /api/mission/config`, `POST /api/mission/config` | budgets, prices, `stuck_after_min`, `keep_days`; a bad part rejects the whole request |
| `DELETE /api/mission/usage?confirm=true`              | delete all stored usage                                                               |
| `POST /api/agent/live/usage`                          | token/cost report (above)                                                             |

The emergency stop (kill switch) refuses new reports (HTTP 403) and keeps what is stored readable.

## Jump to a session

- **Details** opens `#/agents/<id>` (shown when Core holds the session's steps or Phoenix started it).
- **Jump to terminal** uses the existing `focus-terminal` route and its confirmation, addressed as `<agent>:<id>` (the board's key) because two agents can use the same session id. A bare id that live sessions of more than one agent answer to is refused (HTTP 400) instead of landing on whichever came first. Shown only when Core knows the agent's terminal window.

## Limitations and things to know

- No real agent, provider or invoice was used; both exit criteria are unmet.
- Claude Code's cumulative token counts are not in its status JSON; only a cost is read.
- Codex and other agents deliver no token counts to Phoenix; they can use the generic report.
- Retention is one setting for all usage rows: `keep_days` (whole days, 7 to 3650, default 400) in `POST /api/mission/config`, also a field on the mission page. Rows from `today - keep_days` on are kept; older rows are deleted on the next report after the day or the value changed, and when Core starts (so a lowered value takes effect after a restart even with no report). Lowering it deletes the older rows for good; raising it brings nothing back. A stored value that is damaged or out of range reads as the default 400, never as a smaller number. There is no per-class retention. The new interface text is machine-translated in the eight non-English locales and unreviewed.
- A budget warning's `resets_at` is the instant the next local day starts, in the time zone the service was built with (the system zone, or `recapTimeZone`). It is found from the zone's own day boundary, so it is right on 23- and 25-hour days and where a zone skips midnight. The zone is fixed when Core starts: if the computer's zone changes, restart Core to follow it.
- Whoever can post to the usage route can pre-consume Core's per-day limits (sessions, agents, models) or move a session's baseline with a forged report; Core cannot tell a real report from a forged one. The limits only bound the damage.
- The time zone that decides what "today" is, is fixed when Core starts. A change of the system zone is picked up after a restart.
- The per-agent, per-session and per-day limits cut what is stored; the part cut stays **pending** (the session's baseline does not move past what was stored), so it is counted once there is room again. Cut and refused reports are counted for the current day in memory (`ingest` in `GET /api/mission`, shown on the page); a restart starts the count again.
- The usage table has no index on `(agent, session_id)`, so per-session sums scan the table. Rows are bounded (400 days, 500 sessions a day) so this is slow only at the extreme; adding the index needs a migration, which this change did not make.
