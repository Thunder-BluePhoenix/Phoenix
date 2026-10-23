# Phase 74 — Lid-Close Actions

| Field | Value |
|---|---|
| Stage | Stage 13 — Insomnia parity and beyond (keep awake) |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | 🟨 Six actions built and tested with a lid simulation and fakes only; no lid was closed and no signal, volume, brightness, `defaults`, `pmset` or `sudo` ran for real; the backstop covers only Low Power Mode; keyboard light, Docker wiring and per-device mute are not built; the exit criterion is met as a simulation only |
| Depends on | [Phase 73 — Lid-Closed Mode, Recovery & Power Floors](phase-73-lid-closed-mode-and-recovery.md) |
| Unblocks | — |

## Goal

When the lid closes during a session, save power and quiet the machine; undo it all when it opens.

## Tasks — parity with Insomnia

- [ ] Display and keyboard light off, brightness saved and restored. Display sleep is built (`lid-actions/actions/display.ts`); the brightness tool is used only if it is owned by root or the user and is not group- or world-writable. **The keyboard backlight is not implemented.** Unrun against a real display.
- [ ] Freeze listed apps with `SIGSTOP` (default Slack, WhatsApp, Discord); never meeting, recording or dictation apps; only unfreeze what it can prove it froze. Built (`actions/freeze-apps.ts`, `freeze-core.ts`): a process is resumed with `SIGCONT` only after its pid, start time, command and uid are proven to match what was frozen (`ps` with `TZ=UTC LC_ALL=C`); targets are limited to the current user (other users' processes are classed `not_ours`); undo is retried three times; apps that hold an audio or power assertion (read-only `pmset -g assertions`) are skipped and an unreadable assertion list fails closed (`assertions_unknown`). Tested with fakes (`actions.test.ts`, `hardening.test.ts`). Unticked because **no real app was frozen**; app paths and the `ps` output format are unverified, and an in-app call is detected only through assertions.
- [ ] Mute every output, restore on open even after switching outputs. Built for the **default output only**: the output name is recorded, and a changed default is not unmuted (`output_changed`). Per-device mute is not built. Unrun against real audio.
- [ ] Low Power Mode on. Built through the Phase 73 helper (`actions/low-power.ts`); the only action the backstop also undoes. Never run with the helper.
- [ ] Freeze Docker Desktop when no container runs (off by default). The action (`actions/docker-freeze.ts`) is now fed by Phoenix's Docker capability through `core/runtime/src/docker-idle.ts`: it freezes only when the capability lists containers and every one is stopped; running, paused, restarting, unknown, a failed call or a possibly cut list never freeze. Tested against the real Docker capability on a mock Engine socket and the fake machine; never against a real Docker Desktop or a closed lid. Unticked.
- [ ] Turn App Nap off for agent apps (opt-in, journalled). Built with `defaults write`, the prior value journalled first (`actions/app-nap.ts`). Never run against real `defaults`.

## Tasks — Phoenix improvements

- [x] Protected list always includes Phoenix, terminals, editors and running coding agents. Built (`lid-actions/protected.ts`, tests in `protected.test.ts`): Phoenix, terminals, editors, tracked agents and meeting apps are always protected, users can add names but not remove built-ins, unknown state fails closed, and mute, display sleep and App Nap act only when the protected state is `idle`. Meeting and recording state is per-capture and never expires. Agent pids may not arrive from agent events, so name-based protection does most of the work (see the notes).
- [ ] Docker idleness comes from Phoenix's Docker capability. Wired (`dockerIdleFrom`, read-only `containers` command, fails closed); simulated only. Unticked.

## Deliverables

- Lid actions in capabilities/awake: built (`capabilities/awake/src/lid-actions/`, `LidActions.tsx`, [awake-lid-actions.md](../awake-lid-actions.md), `capabilities/awake/README-lid.md`); simulation only.

## Exit criteria

- [ ] Each action is undone on lid open and by the backstop; tested with a lid simulation. **Met as a simulation only, so left unticked.** The lid simulation (`lid.test.ts`, `rig.ts`) shows each action undone on lid open, and the engine tracks its own lid-applied flag so a missed lid-open (an unknown state between) still undoes. But the backstop undoes **only Low Power Mode**: every other action is undone at the next Phoenix launch after a crash, not by the backstop. No lid was closed and no signal, volume, brightness, `defaults`, `pmset` or `sudo` call ran for real.

## Implementation notes

### What was built

- **Six actions** in `capabilities/awake/src/lid-actions`: display sleep; freeze listed apps (SIGSTOP/SIGCONT); mute with restore; Low Power Mode through the helper; Docker freeze (off by default, never freezes while idleness is unknown); App Nap off through `defaults write` (opt-in, prior value journalled).
- **Safety rules**: the protected list, fail-closed unknown state, mute/display/App Nap only when idle, assertion check before freezing, per-capture meeting and recording state that never expires, uid filter, `not_ours` class, undo retried three times, shutdown awaited for at most 10 s, every change journalled through the Phase 73 journal before it is made.
- **Web**: `LidActions.tsx` (Settings and Overview glance).

### Security review

Independent static reviews (read-only, not human audits) were followed by a hardening round, each item with failing-before tests: mute, display sleep and App Nap act only when the protected state is `idle`; apps holding audio or power assertions are skipped (`pmset -g assertions`, fail closed as `assertions_unknown`); meeting and recording state is per capture and never expires; the engine tracks its own lid-applied flag so a missed lid-open still undoes; mute records the default output name and refuses to unmute a different default (`output_changed`); freeze targets are filtered to the current uid, undo is retried three times, other users' processes are classed `not_ours`, and shutdown is awaited for at most 10 s; `ps` runs with `TZ=UTC LC_ALL=C` and a start-time mismatch with an identical command gives `retry_or_alert`; the brightness tool is trusted only if root- or user-owned and not group- or world-writable. No open security item is specific to this phase beyond the inherited Phase 73 items (unkeyed journal, per-account sudoers rule, backstop limited to `pmset` kinds).

### What was not built

Keyboard backlight; the Docker wiring; per-device mute (default output only); any backstop coverage beyond Low Power Mode.

### What was not run

Any action for real: no lid was closed, and no signal, volume, brightness, `defaults`, `pmset` or `sudo` call ran. Agent pids may not arrive from agent events; app paths, the `ps` output format and the `brightness -l` output are unverified. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
