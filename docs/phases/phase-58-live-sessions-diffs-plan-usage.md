# Phase 58 — Live Agent Sessions, Diffs & Plan Usage

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | 🟨 Steps, on-demand diffs, Claude plan usage with warnings, terminal jump and Markdown export built and tested without a real agent; Codex usage unsupported; exit criteria not met |
| Depends on | [Phase 57 — Universal Agent Relay & Hook Installers](phase-57-agent-relay-and-installers.md) |
| Unblocks | [Phase 78 — Agent Cost Meter & Mission Control](phase-78-agent-cost-and-mission-control.md), [Phase 79 — Session Handoff Notes & Secret Guard](phase-79-handoff-notes-and-secret-guard.md) |

## Goal

See what each agent is doing right now: steps, file changes, and how much of its plan is left.

## Tasks — parity with Coucou

- [x] Step ticker: what the agent reads, edits and runs, step by step (`capabilities/agents/src/steps.ts`, `claude-hook.ts`, `core/runtime/src/agent-live.ts`, web session page in `AgentSessions.tsx`; tests `steps.test.ts`, `live.test.ts` (the real `claude-hook.ts` subprocess against a real in-process Core, fed payloads shaped from the documentation), `agent-live.test.ts`, `agent-live.test.tsx`). Only Claude Code produces steps; tool output and file contents are never stored.
- [x] Live diffs: file name and +N −M, open the full diff (`diffs.ts`, `AgentSessions.tsx`; tests `diffs.test.ts`, `agent-live.test.ts` "diff", `agent-live.test.tsx` "files and diff"). The full diff is computed on demand with git argv only, from a neutral directory, with repository-configured filter drivers neutralised (proven against a real git repository and a marker-file fixture); secrets are masked on a best-effort basis; paths outside the project are refused.
- [ ] Jump to the session's terminal window. Built and tested only against a fake command runner, so no window was ever focused (`terminal-focus.ts`, `agent-live.ts` `focusTerminal`; tests `terminal-focus.test.ts`, `agent-live.test.ts` "focusTerminal asks first", `live.test.ts` "jump to terminal", `agent-live.test.tsx`). Each jump needs a user confirmation first. macOS supports Terminal and iTerm2 only.
- [x] Claude plan usage (5-hour and weekly) through a `statusLine` relay that still runs the user's previous status line (`statusline.ts`, `relay/statusline-hook.ts`, `usage.ts`; tests `statusline.test.ts` (including `statusline.ts` as a real process against a real in-process Core, previous output passed through byte for byte), `relay-statusline.test.ts`, `usage.test.ts`). The fields read are the ones the public statusLine documentation lists (`rate_limits`); no real Claude status JSON was captured. The wrapper is not installed on Windows.
- [ ] Codex plan usage and free resets left. Reported as `unsupported`: Codex documents rate limits only through its app-server (`account/rateLimits/read`), which Phoenix does not launch, and no hook or status line delivers them. `mapCodexRateLimits` (`usage.ts`, test `usage.test.ts` "Codex usage") understands the documented shape but nothing feeds it.

## Tasks — Phoenix improvements

- [ ] Diffs link to the commit and CI run they ended up in (knowledge graph, Phase 38). Deviation: diffs list the commits and CI runs that Phoenix's existing session links (`links.ts`, migration 15, `agent_links`) associated with the session while it was active (`diffs.ts` `diffLinks`; tests `diffs.test.ts`, `agent-live.test.ts` "diff"). The knowledge graph is not used, and a link says "appeared while the session was active", not "this file is in that commit".
- [x] Session timeline export (Markdown) (`timeline-export.ts`, `agent-live.ts` `exportMarkdown`; tests `timeline-export.test.ts` (hostile text from every untrusted field cannot form links, images, HTML, headings, lists or tables), `live.test.ts` routes, `agent-live.test.tsx` download)
- [x] Plan usage warnings before a limit is hit, not after: one durable warning per window per threshold, default 80 % and 95 %, configurable, restart-safe (`usage.ts` `UsageTracker`; tests `usage.test.ts`, `agent-live.test.ts` "plan usage and warnings", `live.test.ts` "plan usage warnings")
- [ ] Jump to terminal on Linux and Windows, not only macOS. Built, never run on either OS: Linux through `wmctrl`/`xdotool` (X11 only; Wayland is refused with a message), Windows through PowerShell `AppActivate` (`terminal-focus.ts`; tests `terminal-focus.test.ts` with a fake runner).

## Deliverables

- Session detail view (`AgentSessions.tsx`)
- Plan usage capability (`usage.ts`, `statusline.ts`, `agent-live.ts`)

## Exit criteria

- [ ] Live steps and diffs of a real session appear within a second
- [ ] Plan usage matches the agent's own display

## Implementation notes

Steps and usage reach Core through the relay (`step` and `usage` ops, `live-send.ts`, falling back to loopback HTTP), are validated and redacted again on arrival, and are held in memory (at most 500 steps per session, 32 usage windows). Steps and usage are pushed to the web as ephemeral `core`-sourced events. The route and relay tests run against a real in-process Core; the agent side is always a recorded-shape payload.

Not verified: a real Claude Code status JSON, any subsecond latency, agreement with the agent's own usage display, any real terminal window on any OS, and the Windows and Linux focus commands. Session detail for Phoenix-started (`ph-…`) sessions matches live sessions by project folder and time and says so.

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
