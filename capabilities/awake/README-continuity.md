# Agent continuity (Phase 75)

Four extras of the `awake` capability for long agent runs. **All are off by default, each is a
separate opt-in, and none ships with a host, a network, a terminal or a program chosen for you.**
They live in `src/continuity/` and are registered in `MODULES` in `src/index.ts`.

Every effect goes through injected seams (`Runner`, `AwakeClock`, the event feed), so the tests use
recording fakes. **Nothing here was ever run against a real tmux, `networksetup` or browser.**

## Config (`continuity` key of the Keep awake capability)

```jsonc
{
  "continuity": {
    "network_watch": {
      "enabled": false,
      "hosts": [],
      "failures_required": 3,
      "interval_seconds": 15,
    },
    "hotspot": { "enabled": false, "ssid": "My iPhone", "allow_password_argv": false },
    "nudge": {
      "enabled": false,
      "after_seconds": 90, // minimum 30
      "panes": [], // ^%[0-9]{1,6}$
      "sessions": [], // ^ph-[0-9a-f]{16}$
      "allowed_commands": [], // empty = refuse every pane
      "enter": false,
    },
    "throttle_check": { "enabled": false },
  },
}
```

The manager validates saves with the JSON Schema; the module validates again when it reads config
(an invalid entry is dropped and counted in `ignored_config_entries`, never used).

## 1. Network watch

Probes the hosts you list (`name` or `name:port`, default port 443): resolve, then open a TCP
connection, 3 s limit, one reachable host means "up". It sends and reads nothing. No hosts, no
probing. `failures_required` consecutive failed rounds (default 3, at 15 s) declare the network
down; one success declares it up. Each transition is emitted once; flapping below the threshold
emits nothing.

The default probe is bounded: a host whose previous lookup or connect is still pending (a hung DNS
resolver) is skipped in the next round and counts as not reachable, so lookups never pile up; at
most 4 lookups run at once within a round (`MAX_CONCURRENT_LOOKUPS`); every socket gets
`setTimeout(3 s)`; a lookup that resolves after the round's deadline opens no socket.

Events: `awake.network.down` (warning), `awake.network.up`. Both appear in the activity feed.
**Fawkes:** `awake.network.down` sets **WARNING** ("Network is down") with `ttlMs` of 6 h so a lost
`up` cannot leave it stuck; `awake.network.up` clears it. WARNING is an existing state; none was
added. A down network does not change the session or end it.

## 2. Hotspot failover (macOS only, UNVERIFIED)

When the network is confirmed down **and** hotspot failover is enabled **and** a keep-awake session
is active, Phoenix joins the SSID you chose. The attempt is audited by the `awake.hotspot.joined` /
`awake.hotspot.failed` events (reason codes only). `hotspot.join_now` joins on request (side effect
`execute`: confirmation every time) and works without a session; `hotspot.rejoin_previous` rejoins
the network the Mac was on before.

Commands, in order (argv arrays through the Runner, no shell):

1. `/usr/sbin/networksetup -listallhardwareports` (read): the Wi-Fi device, accepted only if it matches `^en[0-9]{1,3}$`.
2. `/usr/sbin/networksetup -getairportnetwork <device>` (read): the network to remember.
3. `/usr/sbin/networksetup -setairportnetwork <device> <ssid> [password]`.

The tool is always called by its absolute path; the PATH is never searched. The real Runner never
puts Node's error message (which contains the full argv, hence a password) in a result: a failure
without stderr of its own is reported as the fixed text `exec_failed`.

The SSID is validated (1-32 bytes, no control or invisible characters, not starting with `-`).

### The password, and why this is a GAP

`networksetup -setairportnetwork` takes the password only as an **argv element**. Every local
process can read it (`ps`) for the duration of the call. `security` cannot join Wi-Fi networks, so
there is no better built-in, non-interactive route. Phoenix therefore:

- **Default (`allow_password_argv: false`): passes no password.** macOS joins a network it already
  knows, so join the hotspot once by hand first. Nothing secret is ever on a command line.
- **Only if you tick "use the saved hotspot password"**: reads the capability secret
  `hotspot_password` (OS keychain, written through Settings → capabilities; never in config) and
  passes it as the last argument. The Settings screen shows an explicit disclosure when hotspot
  failover is enabled. Decline if that is not acceptable. A password that begins with `-`, contains
  control characters, or is not 8-63 printable characters / 64 hex digits is rejected and not passed.

The password never appears in logs, events, status, errors or audit records (tests scan all of them
for a runtime-built password). `networksetup` exits 0 on some failures, so its output is checked for
failure words as well.

### Previous network

The network the Mac was on is remembered **before** the join (and the join is not made if it was
already on the hotspot). A saved real network is never overwritten by "not associated" or an
unreadable Wi-Fi reading (a second failover after the Wi-Fi already dropped would otherwise lose
the way back); it is replaced only by a different real network (you moved). The Settings screen
offers "Rejoin my previous network" (no password, ever). It asks you every time (execute command),
and does nothing, except forget the record, if the Mac is already on that network.

**It survives a Core restart.** The record is the file `<data dir>/awake/previous-network.json`
(`src/continuity/previous-network.ts`; data dir = `PHOENIX_DATA_DIR`, else `~/.phoenix/<env>`, the
same rule as the recovery journal), written through the same file seam as the Phase 73 journal:
directory 0700, file 0600, replaced atomically. The journal itself is not used: it is built for
changes that must be undone (strict checksum, owner, 1 MB budget, quit veto), and a Wi-Fi name is
not one.

- Stored: `{"v":1,"ssid":…,"device":"enN","at":<ms>}`. Never a password, a BSSID or a location.
- On load the SSID and device must pass the same rules as joining, the file must hold exactly those
  keys and be at most 1 KiB (bigger is deleted without being read), and `at` must not be in the
  future. A record **24 hours old or older** is dropped, also while Core keeps running.
- Anything that fails those checks is ignored and **deleted**.
- It is removed after a successful rejoin (or when already on it), and when Core starts with
  hotspot failover turned off. A failed rejoin keeps it so you can retry.
- If the file cannot be written, the record lives in memory for this run and the log says
  `write_failed` (never the SSID).

Tested with a fake machine and a fake file system only (`test/continuity/hotspot.test.ts`); no real
restart, disk or Mac.

## 3. Nudge

After the network has been down `after_seconds` (default 90, minimum 30), type `continue` into
targets **you** listed. A `NudgeTarget` is a tmux pane or a Phoenix-tracked agent session.

tmux pane, in order:

1. `<tmux> display-message -p -t <pane> '#{pane_id} #{pane_in_mode} #{pane_current_command}'` must succeed, answer the same pane id, report `pane_in_mode` `0`, and the command must be in `allowed_commands` (empty list = refuse everything; a shell prompt is refused). A pane in copy/view mode (`pane_in_mode` `1`) is refused with outcome `pane_in_mode`: keys typed then would drive the mode, not the program.
2. `<tmux> send-keys -t <pane> -l continue` (`-l`: literal, never read as a key name).
3. Only if `enter` is on (default **off**): a separate `<tmux> send-keys -t <pane> Enter`.

`<tmux>` is resolved at delivery time from the fixed ordered list `TMUX_PATHS`
(`/opt/homebrew/bin/tmux`, `/usr/local/bin/tmux`, `/usr/bin/tmux`): the first one that exists wins.
The PATH is never searched, so a planted `tmux` cannot receive keystrokes. If none exists the
outcome is `unavailable` and nothing is run. The existence check is injected (`fileExists`).

Guards: pane ids must match `^%[0-9]{1,6}$` (`%1; rm`, `$(x)`, spaces, empty are refused at config,
schema and again at send); at most once per outage per target (marked before sending); nothing is
sent while a meeting, recording or dictation is active (checked before each target; the nudge waits
and resumes with the targets not yet done), learned from `kage.*`, `dictation.*` and `notetaker.*`
events; with no event feed the answer is "protected" (fail closed). Audit: `awake.nudge.result` with
the pane id (or session id), kind and outcome only: never the text, the command or any output.

**GAP, tracked sessions:** the agents capability can write to a session's stdin (`session.send`),
but it always appends a newline (it cannot honour "Enter off") and a capability cannot call another
capability's command from inside Core. No safe terminal-input mechanism exists, so `SessionTarget`
defines the interface (`AgentSessionInput.send(sessionId, text, enter)`), is tested with a fake, and
without an injected implementation reports `unavailable`. Phase 58's terminal focuser raises a
window; it does not type. Nothing real is wired.

**GAP, a half-typed line (S2):** the nudge cannot know whether the program's input box already
holds text you were typing; `continue` is appended to it (and sent with Enter if `enter` is on).
tmux exposes no portable "input line is empty" signal. The guards that exist are: the program must
be on your allow-list, the pane must not be in a mode, nothing is sent during a meeting or
dictation, and Enter is off by default. Not closed.

## 4. Throttle check (macOS, UNVERIFIED)

`throttle.status` (read-only) lists `ps -axo command=` and, for the five table entries
(`com.google.Chrome`, `company.thebrowser.Browser` Arc, `ai.perplexity.comet`,
`com.microsoft.edgemac`, `com.brave.Browser`), reports _running without both_
`--disable-background-timer-throttling` and `--disable-renderer-backgrounding` as throttled. Helper
processes (`--type=`) are ignored. The app names and the Comet bundle id are from memory and
unverified against real installs.

`throttle.relaunch {bundle_id}` (side effect `execute`, confirmation every time; the Settings screen
also asks, naming the app and warning that tabs reload): the bundle id must be in the table (the
command's schema enumerates it) and is the only value placed in the script;
refused while a meeting/dictation is active; refused if the app is not running or already
unthrottled. Then `osascript -e 'tell application id "<bundle>" to quit'`, waits up to 10 s for
exit (it never force-kills; if the app stays open it reports `still_running` and does not reopen),
then `open -a "<app name>" --args --disable-background-timer-throttling --disable-renderer-backgrounding`.

**Decoy-safe detection.** A line of `ps` output counts as the browser only when it _begins_ with
its path: after trimming leading blanks it starts with `/`, and everything before
`/<App>.app/Contents/MacOS/<executable>` contains no whitespace and no quote. `tail -f "<path>"`,
`/bin/echo <path>`, `grep <path>` or `sudo <path>` (the path only in the arguments) is not a running
browser, so it can neither trigger nor suppress a relaunch.

**Absolute tool paths.** `ps` is run as `/bin/ps`, the quit as `/usr/bin/osascript`, the reopen as
`/usr/bin/open`; the PATH is never searched.

## What was and was not verified

Verified with fakes only: detector rules, argv of every command, validation and injection refusal,
password absence in all outputs, opt-in defaults (zero Runner calls when off), once-per-outage,
protected blocking, schema refusals. **Not verified:** any real `networksetup`, tmux, `ps` or
browser behaviour, the `networksetup` output formats, real Wi-Fi joins (the phase exit criterion
"hotspot join tested on a real Mac" is **UNMET**), or any real network probe.
