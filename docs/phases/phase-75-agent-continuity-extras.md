# Phase 75 — Agent Continuity: Network Failover, tmux Nudge, Browser Throttling

| Field | Value |
|---|---|
| Stage | Stage 13 — Insomnia parity and beyond (keep awake) |
| Release target | Post-v2.0 track |
| Priority | Low |
| Status | 🟨 Four extras (network watch, hotspot failover, tmux nudge, throttle check) built, all off by default, and tested with simulations and fakes only; nothing ran against a real network, `networksetup`, tmux or browser; the hotspot join was never tried on a real Mac, so the exit criterion is not met; nudging Phoenix-tracked sessions is an interface only |
| Depends on | [Phase 72 — Keep-Awake Sessions (No Root)](phase-72-keep-awake-sessions.md), [Phase 34 — Coding-Agent Orchestration](phase-34-coding-agent-orchestration.md) |
| Unblocks | — |

## Goal

Keep long agent runs going through network drops and throttled browsers.

## Tasks — parity with Insomnia

- [ ] Wi-Fi drop → join the iPhone hotspot (password in the keychain). Built (`capabilities/awake/src/continuity/hotspot.ts`; tests in `capabilities/awake/test/continuity/hotspot.test.ts` with a fake runner), macOS only. By default the join runs **without a password** (macOS joins a network it already knows). Only when `allow_password_argv` is on is the keychain secret `hotspot_password` passed, as an argv element visible to local processes for the duration of the call (disclosed in the Settings UI and the README). The previous network survives a Core restart (`previous-network.ts`, below). Unticked because **`networksetup` was never run and no hotspot was joined**.
- [ ] No network for 90 s → type `continue` into tmux panes the user marked; Enter off by default. Built (`nudge.ts`, `nudge.test.ts`): the pane id must match `^%[0-9]{1,6}$`, the text is `send-keys -l continue`, Enter is off by default, a pane-command allow-list defaults to refuse, `pane_in_mode` must be 0, and a pane is nudged once per outage. Unticked because **tmux was never run**, and the nudge can still type into a half-typed line outside copy mode.
- [ ] Detect Chromium/Arc/Comet throttling and offer "relaunch unthrottled" (asks first). Built (`throttle.ts`, `throttle.test.ts`): a read-only `throttle.status` and a relaunch that is confirmation-gated; a browser counts as running only when the executable is at the start of the `ps` command line. Unticked because **no browser was inspected or relaunched**, and the browser bundle ids (including `ai.perplexity.comet`) are from memory.

## Tasks — Phoenix improvements

- [ ] The nudge targets Phoenix-tracked agent sessions (Phase 34), not only tmux. **Design decision: not built.** `SessionTarget` and `AgentSessionInput.send(sessionId, text, enter)` exist and are tested with a fake, and a real Core supplies no implementation, so a listed session reports `unavailable` and nothing is typed (`nudge.test.ts`, through the module). The reason is in [README-continuity.md](../../capabilities/awake/README-continuity.md) section 3: `session.send` needs the user's confirmation every time and a background nudge cannot answer it (the only alternative is a bypass of the permission gateway, which is refused); a tracked session is a pipe, not a terminal, so "Enter off" would leave an unterminated line in the agent's stdin; and there is no "user typed recently" signal. Nudging an agent works through a tmux pane.
- [x] Network events appear in the activity feed and Fawkes state. `awake.network.down` (warning) and `awake.network.up` are published; `awake.network.down` maps to the existing WARNING state with a 6-hour TTL so a lost `up` cannot leave it stuck, and `awake.network.up` clears it (`network.test.ts`, `manifest.test.ts`). No new state was added. Verified with fakes; the activity feed was not looked at in a real browser.

## Deliverables

- Failover, nudge and throttle checks in capabilities/awake: built (`capabilities/awake/src/continuity/`, `Continuity.tsx`, `capabilities/awake/README-continuity.md`); simulation only.

## Exit criteria

- [ ] Each extra tested with a simulation; hotspot join tested on a real Mac. **Half met.** Each of the four extras is tested with a simulation (fake runner, clock and probes). The hotspot join was **never tested on a real Mac**, and nothing else ran against a real network, `networksetup`, tmux or browser.

## Implementation notes

### What was built

- **Network watch** (`network.ts`): probes the hosts the user lists (resolve, then open a TCP connection, 3 s limit); sends and reads nothing; the probe skips pending lookups, destroys late sockets and caps concurrency. Off by default, with no host chosen for the user.
- **Hotspot failover** (`hotspot.ts`, macOS only): runs only when the network is confirmed down, failover is enabled and a keep-awake session is active; the previous network is remembered before the join and is never overwritten with a null; "rejoin my previous network" uses no password, asks first (execute command) and does nothing if the Mac is already on that network.
- **Previous network, persisted** (`previous-network.ts`): `<data dir>/awake/previous-network.json`, written through the Phase 73 `JournalFs` seam (directory 0700, file 0600, temp file + fsync + rename). It holds `{v, ssid, device, at}` only: no password, BSSID or location. The recovery journal was not used: it is for changes that must be undone (strict checksum and owner, a 1 MB budget shared with privileged undo entries, quit veto while pending), and a Wi-Fi name is none of that. On load the record is checked with the join rules (`isValidSsid`, `isWifiDevice`) and must have exactly those four keys, be at most 1 KiB (an oversized file is deleted without being read), not be dated in the future and not be 24 h old or older; otherwise it is ignored and deleted. It is also dropped when it expires while Core runs, after a successful rejoin (or when the Mac is already on it), and at start when hotspot failover is turned off. A failed rejoin keeps it. A write that fails is logged with the code `write_failed` (never the SSID) and the record then lives in memory only. Tested with a fake machine and a fake file system that records modes (`hotspot.test.ts`, "previous network across a Core restart"); no real file, restart or Mac was involved.
- **tmux nudge** (`nudge.ts`): settings as above; tmux is located from a fixed list of absolute paths; nothing is sent during a meeting or recording.
- **Throttle check** (`throttle.ts`): `throttle.status` is read-only; relaunch is confirmation-gated.
- **Common**: system tools are called by absolute path (`networksetup`, `ps`, `osascript`, `open`); `realRunner` never returns Node's `Command failed:` message, because it carried the argv including a hotspot password; all four extras are off by default (zero runner calls when off). **Web**: `Continuity.tsx` (Settings, Overview glance).

### Security review

An independent static review (read-only, not a human audit) was followed by a hardening round, each item with failing-before tests: system tools called by absolute path (`networksetup`, `ps`, `osascript`, `open`; tmux from a fixed list); a brightness tool trusted only if it is owned by root or the user and is not group- or world-writable; the `pane_in_mode` check; probe that skips pending lookups, destroys late sockets and caps concurrency; browser detection that matches only the start of the command (an argument that merely contains a browser path is not a browser); a previous network that could be overwritten by "not associated"; and an error message that exposed the argv with the hotspot password.

**Not fixed (open):** with `allow_password_argv` on, the hotspot password is visible to every local process for the duration of the `networksetup` call (disclosed; `networksetup` takes the password only as an argv element); the nudge can type `continue` into a half-typed line when the pane is not in a mode, because tmux has no portable "input line is empty" signal; the data directory is taken from `PHOENIX_DATA_DIR` / `~/.phoenix/<env>` as in Phase 73 because Core does not hand it to capabilities yet.

### What was not built

Nudging Phoenix-tracked agent sessions: a design decision, not an omission (see the exit-criterion note above). The seam stays as an interface; no host implements it, and the agents capability's `session.send` is unchanged (still one appended newline, still confirmed, still refused under the kill switch).

### What was not run

Everything against the real thing: a real network drop, `networksetup`, joining a hotspot, tmux, a Chromium-family browser, `ps` output on a real machine. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
