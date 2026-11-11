# Phases 73, 74, 75: real macOS read-only probes (2026-11-11)

Evidence of one run on a real Mac, **macOS 27.0.1 (build 26A434), Apple Silicon laptop, lid OPEN**,
Node 22. Only read-only commands were run (no `sudo`, no `pmset` setter, no `networksetup -set*`, no
`osascript` setter, no `defaults write`, no `kill`, no `open`, no `SwitchAudioSource -s/-m/-u`). Output
is redacted by hand: SSIDs, MAC addresses, host and user names, UUIDs, per-user paths and long
property values are replaced or elided. Redacted fixtures: `capabilities/awake/test/fixtures/real-macos-27/`.
Pinned by `capabilities/awake/test/real-macos-fixtures.test.ts` (ungated). Re-runnable on any Mac with
`PHOENIX_REAL_MACOS_PROBES=1` (`capabilities/awake/test/real-macos-probes.test.ts`, structural asserts only).

This is evidence of formats on one Mac. It does not meet any exit criterion of Phase 73, 74 or 75.

## Verdicts

| Probe                                                  | Parser                                                                  | Verdict                                                                                                                                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ioreg -r -k AppleClamshellState -d 4`, lid open       | `parseClamshell`                                                        | matches (`open`); the **lid-closed value cannot be observed here**                                                                                                                                 |
| `pmset -g` `SleepDisabled`                             | `pmsetSetting(out, "SleepDisabled")`                                    | **differs**: the key is NOT in `pmset -g` while sleep is allowed (reads `undefined`, so `sleep_disabled_unjournaled` is `null`); whether it appears while disabled cannot be observed (needs root) |
| `pmset -g assertions`                                  | `parseAssertionHolders`                                                 | matches                                                                                                                                                                                            |
| `ps -axo pid=,ppid=,uid=,state=,lstart=,comm=`         | `parsePsLine`                                                           | matches (one-digit days padded with two spaces parse)                                                                                                                                              |
| `ps -axo command=`, real Chrome                        | `parseBrowserStatus`                                                    | matches (`running: true, throttled: true`, correct: no flags)                                                                                                                                      |
| `networksetup -listallhardwareports`                   | `parseWifiDevice`                                                       | matches (`en0`)                                                                                                                                                                                    |
| `networksetup -getairportnetwork en0` (no network)     | `parseCurrentNetwork`                                                   | matches (`null`); the connected wording `Current Wi-Fi Network: <ssid>` was not observed (the Mac is not on Wi-Fi)                                                                                 |
| `osascript ... output muted of (get volume settings)`  | `createOsascriptAudio`                                                  | matches (`false`)                                                                                                                                                                                  |
| `osascript ... output volume of (get volume settings)` | n/a (the code reads only `output muted`)                                | observed: a bare integer                                                                                                                                                                           |
| `SwitchAudioSource -c` / `-a`                          | **no production code calls it** (only README-lid.md mentions `-m mute`) | observed for the record, no parser                                                                                                                                                                 |
| `defaults read <id> NSAppSleepDisabled` (unset)        | `readPrior` in app-nap.ts                                               | **differs: real defect, fixed**                                                                                                                                                                    |
| `brightness -l`                                        | `parseBrightness`                                                       | cannot observe: not installed (`/opt/homebrew/bin`, `/usr/local/bin`, PATH)                                                                                                                        |

## Probes

### 1. `/usr/sbin/ioreg -r -k AppleClamshellState -d 4` (Phase 73)

Exit 0. Matching lines (the full output is ~155 lines: the `IOPMrootDomain` property block and about
120 `RootDomainUserClient` children; the fixture keeps the property block with long values elided):

```
+-o IOPMrootDomain  <class IOPMrootDomain, id 0x1000002d5, registered, matched, active, busy 0 (29396 ms), retain 187>
  |   "AppleClamshellCausesSleep" = Yes
  |   "AppleClamshellState" = No
  |   "SleepDisabled" = No
```

`parseClamshell` -> `open` (exactly one `AppleClamshellState` value, `No`). The value format
`"AppleClamshellState" = Yes|No` matches the regex, so `Yes` (closed) is expected to parse as
`closed` but **was never observed**. `AppleClamshellCausesSleep = Yes` is a different key and is not
matched. Note: `ioreg` also lists `"SleepDisabled" = No` in the root domain, a second, unused source.

### 2. `/usr/bin/pmset -g` (Phase 73)

Exit 0:

```
System-wide power settings:
Currently in use:
 standby              1
 Sleep On Power Button 1
 hibernatefile        /var/vm/sleepimage
 powernap             1
 networkoversleep     0
 disksleep            10
 sleep                1 (sleep prevented by <process>, <process>, coreaudiod, coreaudiod, powerd)
 hibernatemode        3
 ttyskeepawake        1
 displaysleep         3
 tcpkeepalive         1
 powermode            0
 womp                 0
```

- **No `SleepDisabled` line and no `lowpowermode` line** (the Low Power setting here is `powermode 0`;
  `lowpowermode` is not listed while it is at its default). `pmsetSetting(out, "SleepDisabled")` is `undefined`,
  so `recovery.status.sleep_disabled_unjournaled` reads `null` (cannot tell) and `verifyNotApplied`
  returns `false` (the entry stays pending): fail-closed, but it means these two checks cannot confirm
  "off" from `pmset -g` on this macOS while the key is absent.
- Whether `SleepDisabled 1` appears in `pmset -g` while `pmset -a disablesleep 1` is in effect cannot be
  observed without root (the `sudo` rule is not installed and `sudo` was not run). The key name
  `SleepDisabled` IS real (it is a property of `IOPMrootDomain` in `ioreg`, value `No`, see probe 1),
  so the inference about the name is supported by `ioreg`, not by `pmset -g`.
- The `sleep` line has a trailing parenthesised note, which the `^\s*([A-Za-z]+)\s+(\d+)\s*$` regex skips.

### 3. `/usr/bin/pmset -g assertions` (Phase 74 in-app call detection)

Exit 0. Shape (timestamp, process names kept only where non-personal, UUID-free):

```
Assertion status system-wide:
   BackgroundTask                 0
   ...
   PreventUserIdleSystemSleep     1
Listed by owning process:
   pid 6111(<proc>): [0x...] 00:00:01 PreventUserIdleSystemSleep named: "<name>"
   pid 553(coreaudiod): [0x...] 01:18:41 PreventUserIdleSystemSleep named: "com.apple.audio.AVVCAggregateDevice-728-....context.preventuseridlesleep"
	Created for PID: 728.
	Resources: audio-out BuiltInSpeakerDevice
   pid 342(powerd): [0x...] 00:03:23 PreventUserIdleSystemSleep named: "Powerd - Prevent sleep while display is on"
   pid 398(WindowServer): [0x...] 00:00:29 UserIsActive named: "com.apple.iohideventsystem.queue.tickle ..."
No kernel assertions.
```

The first line is a timestamp, followed by the `Assertion status system-wide:` header the parser
requires. `parseAssertionHolders` -> `{342, 553, 728, 6111, 44724}` (owners and "Created for PID" of
the idle-sleep and audio blocks; `UserIsActive` is correctly not a hold). Matches. Observed here, and
worth knowing: on a Mac in normal use `powerd` always holds `PreventUserIdleSystemSleep` ("Prevent
sleep while display is on") and `coreaudiod` holds audio, so these pids are always "holders"; the
freeze action never targets system daemons, so this does not block anything, but a call that holds
no assertion is still not detected.

### 4. `ps` (Phase 74 lid actions, Phase 75 throttle)

`/usr/bin/env TZ=UTC LC_ALL=C /bin/ps -axo pid=,ppid=,uid=,state=,lstart=,comm=` exit 0 (fixture lines):

```
    1     0     0 Ss   Thu Oct 15 14:16:55 2026     /sbin/launchd
44673     1   501 S    Fri Oct 30 07:43:23 2026     /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

`parsePsLine` parses every line of the real output (no unparsed line: 0 of ~920), including
`Sat Nov  7` (padded day). `comm=` on macOS is the full executable path, with spaces (the
production regex takes the rest of the line).

`/bin/ps -axo command=` exit 0 (the production throttle call). The real Google Chrome main process is
the single line

```
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

**with no flags at all** (Chrome 156.0.8078.76 started from the Dock). Its helper processes carry
`--type=renderer|gpu-process|utility|file`. Flag NAMES seen on a Chrome renderer helper (values
redacted): `--type --origin-trial-disabled-features --lang --num-raster-threads --enable-zero-copy
--enable-gpu-memory-buffer-compositor-resources --enable-main-frame-before-activation
--renderer-client-id --launch-time-ticks --shared-files --metrics-shmem-handle --field-trial-handle
--variations-seed-version --pseudonymization-salt-handle --trace-process-track-uuid --seatbelt-client`.
Neither `--disable-background-timer-throttling` nor `--disable-renderer-backgrounding` appears
anywhere in the process list (0 matches). `parseBrowserStatus` for Google Chrome ->
`{ running: true, throttled: true }`: correct, and helpers (`--type=`) are ignored. Comet and Brave are
installed but were not running (no process), Arc and Microsoft Edge are not installed.

Bundle ids and executables, read from the real `Info.plist` files: `com.google.Chrome` /
`Google Chrome`, `ai.perplexity.comet` / `Comet`, `com.brave.Browser` / `Brave Browser`; they match the
`BROWSERS` table (app folders `Google Chrome.app`, `Comet.app`, `Brave Browser.app` in
`/Applications`). Arc (`company.thebrowser.Browser`) and Edge (`com.microsoft.edgemac`) are not installed:
unverified. The relaunch (`osascript` quit, `open -a ... --args`) was never run.

### 5. `networksetup` (Phase 75 hotspot)

`/usr/sbin/networksetup -listallhardwareports` exit 0 (MACs redacted):

```

Hardware Port: Ethernet Adapter (en4)
Device: en4
Ethernet Address: <mac>
...
Hardware Port: Thunderbolt Bridge
Device: bridge0
Ethernet Address: <mac>

Hardware Port: Wi-Fi
Device: en0
Ethernet Address: <mac>
...
VLAN Configurations
===================
```

`parseWifiDevice` -> `en0`. Matches (the port is named `Wi-Fi`, blocks are separated by blank lines).

`/usr/sbin/networksetup -getairportnetwork en0` exit 0, stdout (stderr empty):

```
You are not associated with an AirPort network.
```

`parseCurrentNetwork` -> `null` (not associated). Matches; this is what THIS Mac prints with Wi-Fi
not joined, with the word "AirPort" still in the text on macOS 27. The connected wording
(`Current Wi-Fi Network: <ssid>`) and a no-Wi-Fi-hardware wording were **not observed**, nor
`-setairportnetwork` (the join, never run).

### 6. Audio and volume (Phase 74 mute)

- `/usr/bin/osascript -e 'output muted of (get volume settings)'` exit 0, stdout `false`. Matches
  `createOsascriptAudio` (`muted: false`). The `missing value` answer for an output with no mute
  control was not observed.
- `osascript -e 'output volume of (get volume settings)'` exit 0, stdout `94` (a bare integer). The
  production code does not read the volume.
- `SwitchAudioSource` is installed (Homebrew) but **no production code calls it**: `SwitchAudioSource -c`
  printed the current output device name (one line, `MacBook Pro Speakers`), `-a` one name per line
  (`MacBook Pro Microphone`, `MacBook Pro Speakers`; inputs and outputs mixed, no `-t` filter). The mute
  adapter uses `osascript` and `system_profiler SPAudioDataType -json`; the latter was not run here.

### 7. `defaults read` App Nap key (Phase 74) and the defect found

`/usr/bin/defaults read com.google.Chrome NSAppSleepDisabled` exit 1, stdout empty, stderr:

```
Error: Could not find key 'NSAppSleepDisabled' in domain 'com.google.Chrome'.
```

An unknown domain (`defaults read com.phoenix.nonexistent.probe NSAppSleepDisabled`, and
`ai.perplexity.comet`, not yet written) exit 1, stderr `Error: Domain '<id>' not found.`

The production reader `readPrior` (app-nap.ts) only treated stderr containing `does not exist` (the
wording older macOS used: "The domain/default pair of (<id>, <key>) does not exist", also what the test
rig faked) as "absent". On macOS 27 neither real message contains that text, so every app with no
App Nap key read as `null` ("unknown prior, left alone"): the App Nap action would have planned
nothing (`no_targets`) for an app that never set the key. **Fixed**: `ABSENT =
/does not exist|Could not find key|Domain .* not found/i` is used by `readPrior` (the undo path's
"deleting a key already gone" check is unchanged: `defaults delete` wording was not observed). Failing
first: the new fixture test "a missing App Nap key or domain reads as `absent`" failed with `null` before
the change and passes after it; the 155 existing lid-actions tests still pass.

### 8. `brightness -l`

Not installed (`/opt/homebrew/bin/brightness` and `/usr/local/bin/brightness` do not exist, not on
PATH). `parseBrightness` and the Homebrew-tool behaviour stay unverified.

## Not observable here

- Lid CLOSED `AppleClamshellState = Yes` (the lid was open and was not touched).
- `SleepDisabled` in `pmset -g` while sleep is disabled (needs `pmset -a disablesleep 1`, root).
- `sudo -n -l`, `launchd` loading, BSD `install` symlink behaviour: not run (sudo forbidden).
- Connected-Wi-Fi wording of `-getairportnetwork`; the hotspot join; relaunch of any browser; Arc and Edge.
- `defaults write`/`delete` wording, `NSAppSleepDisabled` actually changing App Nap.
- `brightness -l` output.
