# Phase 72 — Keep-Awake Sessions (No Root)

| Field | Value |
|---|---|
| Stage | Stage 13 — Insomnia parity and beyond (keep awake) |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | 🟨 Built and tested with recording fakes; the only real run was one guarded macOS `caffeinate` smoke test; Linux and Windows holds, killing Core mid-session, and quitting the app were never run on real systems; no tray countdown, no Settings entry, no `state_rules`; the exit criterion is not met |
| Depends on | [Phase 13 — Capability SDK, Mock Capability & Event Simulator](phase-13-capability-sdk-mock-simulator.md) |
| Unblocks | [Phase 73 — Lid-Closed Mode, Recovery & Power Floors](phase-73-lid-closed-mode-and-recovery.md), [Phase 75 — Agent Continuity: Network Failover, tmux Nudge, Browser Throttling](phase-75-agent-continuity-extras.md) |

## Goal

Keep the computer awake for a bounded time while agents, builds or meetings run, without root.

## Tasks — parity with Insomnia

- [x] A timed session (days, hours, minutes) is the only way to stay awake; add time; hold-to-end. `start`, `extend`, `end` and `status` in `capabilities/awake` (1 to 10080 minutes, no indefinite mode); the web "hold to end" gesture takes 1.5 s. Tests: `capabilities/awake/test/session.test.ts`, `apps/web/test/awake.test.tsx`. Fakes only (see the exit criterion).
- [ ] Countdown shown where Fawkes is. Built as `AwakeCountdown` in the island and the floating Fawkes and as `AwakeGlance` on the Overview (`apps/web/src/components/Awake.tsx`; tested in happy-dom by `apps/web/test/awake.test.tsx`). Unticked because the **tray countdown is not built** (the tray menu is Rust and was not touched) and nothing was looked at in a real desktop window.
- [x] Battery rule ends the session below a floor (default 10 %). `battery_floor_percent` (1 to 90, default 10); a session ends on battery below the floor and `start` is refused in that state; three consecutive unknown reads end the session (`capabilities/awake/test/battery.test.ts`, fake runner). The battery reads (`pmset -g batt`, `/sys/class/power_supply`, PowerShell) were never run against a real battery.

## Tasks — Phoenix improvements

- [ ] macOS (`caffeinate`), Linux (`systemd-inhibit`) and Windows (`SetThreadExecutionState`). All three are written. macOS ran once for real in a guarded smoke test (`PHOENIX_REAL_AWAKE=1`, `capabilities/awake/test/real-awake.test.ts`: a real `caffeinate -t 20` held a power assertion and the process and assertion were gone after release). Unticked because **Linux (`systemd-inhibit`) and Windows (a PowerShell loop calling `SetThreadExecutionState`) were never run**, only tested against a fake runner (`inhibit.test.ts`).
- [x] "Stay awake while agents work": a session that ends a set time after the last agent finishes. `mode: "agents_grace"` (`capabilities/awake/test/agents-grace.test.ts`, fake bus). Only events whose bus source is `agents` count; no real coding agent drove it.
- [ ] Fawkes shows an awake indicator; history in the activity feed. The indicator is the countdown pill above. `awake.session.started|extended|ended` events are published, but the activity feed was not looked at with them in a real browser, and **Fawkes' state is not changed** (no `state_rules`, because states are fixed and WORKING while only a timer runs would be wrong). Disable, the kill switch and Core exit release the hold and now publish one `awake.session.ended` (`disabled`, `kill_switch`, `shutdown`) through the capability's `stopping` hook, which the manager calls before it aborts the signal; tested with fakes and a real `PhoenixRuntime` on a fake machine only.

## Deliverables

- capabilities/awake: built (`@phoenix/capability-awake`, id `awake`, registered in `builtins.ts` as installed, not enabled; [README](../../capabilities/awake/README.md)).
- Countdown UI in web, tray and island: web (Overview glance) and island built; floating Fawkes shows it too; **tray not built**.

## Exit criteria

- [ ] A session keeps a real Mac awake and always releases when it ends, is cancelled, or Phoenix quits. **Unmet.** One real macOS run showed a hold start and release. Not run for real: cancel, expiry or end through the app, killing Core with SIGKILL, and quitting Phoenix. The `-w <Core pid>` behaviour on a killed parent comes from the `caffeinate` man page and was not observed.

## Implementation notes

### What was built

- **Capability** (`capabilities/awake`): `start`, `extend`, `end`, `status`; all but `status` ask for confirmation and are audited. The confirmation prompt shows `[minutes: N]` through a new opt-in `x-phoenix-confirm` schema flag in `core/capability-manager/src/manager.ts`. `reason` is shown to the user only and a filter rejects control, format, line and paragraph separator and variation-selector characters and U+034F. Seams in `src/system.ts` (Platform, Runner, Spawner, AwakeClock, AwakeEnv, AwakeDeps, AwakeModule) let later phases add modules (`composeAwake`); no new npm or Rust dependency.
- **Holds**: macOS `caffeinate -d -i -s -t <seconds> -w <Core pid>`; Linux `systemd-inhibit`; Windows a constant PowerShell script. On macOS `-w` ties the hold to Core's life. On Linux and Windows nothing ties the child to Core, so holds are renewed in pieces of at most 30 minutes: after a SIGKILL up to 30 minutes of hold can remain.
- **Battery floor** with three-unknown-reads rule; `agents_grace` mode counting only events from the agents capability (`agent.session.step` and `agent.usage.*` come from source `core` and are not counted as work).
- **A disable or kill switch during `start`'s battery read cancels the session before it holds anything.**
- **Web**: `Awake.tsx` (`AwakeGlance`, `AwakeCountdown`) with the 1.5 s hold-to-end; `power.awake.*` keys (non-English text machine-generated and unreviewed).

### Security review

A static review (read-only, not a human audit) found the following; each was **fixed** with failing-before tests: the hold was not bound to Core's process (`-w` added on macOS; 30-minute pieces on Linux and Windows); a disable or kill switch during the battery read did not cancel the start; the `reason` text filter missed some invisible characters; `agents_grace` counted events from any source. No open security item is specific to this phase.

### What was not built

`state_rules` (Fawkes' state does not change), a tray countdown, a Settings entry.

### Ended event on disable, kill switch and Core exit

The manager aborts a capability's signal before `shutdown()`, and an aborted context cannot publish. `CapabilityModule` therefore gained an optional `stopping(ctx, reason)` hook (`core/capability-manager`), called synchronously from `disable()` and `close()` before the abort (a throw is logged and ignored). Awake's `stopping` ends the session (`disabled`, `kill_switch` or `shutdown`): the hold is released first, then the one event is published through the still-valid context, so no source is forged and the later abort/`shutdown()` find no session (no duplicate). Subscribers checked: the lid-actions module maps `kill_switch|disabled|shutdown` to its own release and already also reacts to the abort; Recovery just runs a tick; the scheduled-awake service does not subscribe to the event; the web hook only refreshes status. Tests: `capabilities/awake/test/session.test.ts`, `harness.test.ts`, `core/capability-manager/test/manager.test.ts`, `core/runtime/test/awake-session-ended.test.ts`.

### What was not run

Everything except the single guarded macOS `caffeinate` test: Linux and Windows holds, the battery readers on real hardware, SIGKILL of Core, quitting the app, the countdown in a real window, and any real coding agent driving `agents_grace`. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.
- Lid-closed sleep needs root and is Phase 73.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
