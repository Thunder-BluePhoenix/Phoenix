# MPRIS capability (Phase 68)

Shows what an **MPRIS media player** on this Linux machine is playing (Spotify, VLC, mpv, Rhythmbox,
a browser tab and anything else that follows the freedesktop MPRIS D-Bus interface) and controls it
through [`playerctl`](https://github.com/altdesktop/playerctl). Linux (and, never run, Windows: see below), no account, no network, no
web API. No cover art: `now_playing` reports text and numbers only.

**Nothing here was run on a real Linux machine.** It was written against `playerctl`'s README and
source and tested only with a fake runner (`testing/fake-playerctl.ts`); no `playerctl` binary, no
D-Bus session and no player was ever started. The Windows route has never run on Windows (see below).

## Safety

- One process seam, `src/playerctl.ts`: `execFile("playerctl", args)` with an argument list and no
  shell, a 5 s timeout, an output cap (default 64 KB, hard maximum 256 KB; more is refused as
  `too_large`). stderr and exit codes are not forwarded: a failure reads "The player did not answer".
- Every argument is a fixed word (`play-pause`, `next`, `loop Track`), a whole number checked against a
  range (`position` seconds 0..86400, `volume` 0..100 sent as `0.00`..`1.00`), or a **player name** that
  matched `^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`. A name cannot start with `-`, so it can never look like an
  option, and has no `,` (a player list), `%` (the `%any` wildcard), space, quote, newline or other
  control character. The name travels as ONE argument, `--player=NAME`. The check runs in the command
  schema, in the settings schema and again in the handler.
- The `--format` template for `now_playing` is a constant (`METADATA_FORMAT`) with no input in it.
  What a player reports (title, artist, album) is untrusted text: control and bidi characters become
  spaces, it is clipped to 200 characters, and it is never put in an argument or run.
- `playerctl --list-all` is read first: Phoenix reports `not_running` and starts nothing when no player
  matches. Names in that list that do not match the pattern are ignored.
- Control commands are side effect `write`: each **asks for your confirmation every time** and is
  audited. The approval prompt shows the chosen `player` (`x-phoenix-confirm`).

## Commands

| Command                          | Side effect | Notes                                                                                          |
| -------------------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `now_playing`                    | read        | state, title, artist, album, `position_s`, `duration_s`, `volume` (0-100), `shuffle`, `repeat` |
| `play_pause`, `next`, `previous` | write       |                                                                                                |
| `seek` `{position_s}`            | write       | integer 0..86400 (`playerctl position N`)                                                      |
| `set_volume` `{volume}`          | write       | integer 0..100                                                                                 |
| `set_shuffle` `{enabled}`        | write       | `playerctl shuffle On/Off`                                                                     |
| `set_repeat` `{mode}`            | write       | `off` (None), `one` (Track), `all` (Playlist)                                                  |

Every command takes an optional `player` (a name from `playerctl --list-all`). The settings take an
optional `player` too (used when a call names none) and `poll_ms`. With neither, `playerctl` picks the
first player it finds.

## Platforms

`process.platform` must be `linux` (playerctl) or `win32` (the PowerShell route below). Elsewhere every command
fails with "works on Linux only", nothing is run or polled, and health is `degraded` ("Unsupported ..."). macOS keeps the
Spotify and Apple Music capabilities. If `playerctl` is not installed, calls fail with a message saying so.

## Events and Fawkes

`mpris.track.playing` / `mpris.track.paused` (ephemeral). No `state_rules`: no existing Fawkes state
means listening to music (see the Spotify README).

## Windows: built, NEVER RUN ON WINDOWS (`src/windows.ts`)

On `win32` the same commands run one **fixed Windows PowerShell 5.1 script** (`WINDOWS_SCRIPT`, a constant)
against the system's current media session (the WinRT `GlobalSystemMediaTransportControlsSessionManager`,
Windows 10 1809+). It was written from Microsoft's
[`GlobalSystemMediaTransportControlsSession` reference](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssession)
and the PowerShell await recipe in [WindowsMediaController issue 8](https://github.com/DubyaDude/WindowsMediaController/issues/8),
and tested only as a pure script string, an output parser and a fake runner (`test/windows.test.ts`) on a
non-Windows machine. **No PowerShell, WinRT type or media session was ever involved.**

- No input is interpolated into the script. A command word (a fixed list of seven) and one argument (digits,
  `on`/`off` or `off`/`one`/`all`) travel in the child's environment (`PHOENIX_MEDIA_COMMAND`,
  `PHOENIX_MEDIA_ARG`); the script's `switch` has exactly those arms and re-validates the argument. The
  script reads no other environment variable. A test fails if it can start a process, evaluate text or reach a network.
- `powershell.exe` is taken from `%SystemRoot%\System32\WindowsPowerShell\v1.0` (not PATH), with an argument
  list and no shell: `-NoProfile -NonInteractive -EncodedCommand`, 5 s timeout, 16 KiB output cap; stderr and
  the exit code are not forwarded.
- WinRT `IAsyncOperation`s are awaited through `WindowsRuntimeSystemExtensions.AsTask` found by reflection,
  with a 3 s bound. This is the part that cannot be trusted until it has run on Windows.
- Only the **current session** is addressed: a `player` name (in a command or the settings) is refused, not
  ignored. **No volume control**: the session API has none, so `set_volume` fails with a fixed message.
  There is no cover art. Position is converted from 100-ns ticks to whole seconds.
- Available: `now_playing`, `play_pause`, `next`, `previous`, `seek`, `set_shuffle`, `set_repeat`
  (`off`/`one`/`all` = `None`/`Track`/`List`). Every control is a `write` that asks, as on Linux.
- Unconfirmed until run on Windows: the reflection await, the property names (`PlaybackStatus`, `Title`,
  `Artist`, `AlbumTitle`, `GetTimelineProperties()`, `IsShuffleActive`, `AutoRepeatMode`), the enum names,
  `TryChangePlaybackPositionAsync` taking ticks, and the output format. A session that refuses a command
  prints `refused` and the capability says so.

## Not built / not verified

- Never run against a real `playerctl`, D-Bus session or player. The `--format` variables
  (`status`, `title`, `artist`, `album`, `mpris:length`, `position`, `volume`, `shuffle`, `loop`), the
  `Playing`/`Paused`/`Stopped` and `None`/`Track`/`Playlist` words, the `On`/`Off` shuffle words and the
  `position`/`volume` argument forms come from playerctl's README and source and are unconfirmed on a
  live system; so are the fields a given player leaves out (empty fields are dropped).
- Players differ in what they allow (`CanSeek`, `CanControl`); `playerctl` may exit 0 and do nothing.
- No cover art, no per-player list command, no `playerctld` handling.
