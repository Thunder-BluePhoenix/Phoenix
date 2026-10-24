# MPRIS capability (Phase 68)

Shows what an **MPRIS media player** on this Linux machine is playing (Spotify, VLC, mpv, Rhythmbox,
a browser tab and anything else that follows the freedesktop MPRIS D-Bus interface) and controls it
through [`playerctl`](https://github.com/altdesktop/playerctl). Linux only, no account, no network, no
web API. No cover art: `now_playing` reports text and numbers only.

**Nothing here was run on a real Linux machine.** It was written against `playerctl`'s README and
source and tested only with a fake runner (`testing/fake-playerctl.ts`); no `playerctl` binary, no
D-Bus session and no player was ever started. Windows is not implemented (see below).

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

`process.platform` must be `linux`. Elsewhere every command fails with "works on Linux only", no
`playerctl` is run, nothing is polled, and health is `degraded` ("Unsupported ..."). macOS keeps the
Spotify and Apple Music capabilities. If `playerctl` is not installed, calls fail with a message saying so.

## Events and Fawkes

`mpris.track.playing` / `mpris.track.paused` (ephemeral). No `state_rules`: no existing Fawkes state
means listening to music (see the Spotify README).

## Windows: not implemented

A Windows media-session reader would need the WinRT `GlobalSystemMediaTransportControlsSessionManager`
through PowerShell. Reading its results needs awaiting WinRT async operations from Windows PowerShell
5.1 through reflection, which cannot be checked faithfully without a Windows machine, and nothing was
run. Windows is left unsupported rather than shipping an untested script.

## Not built / not verified

- Never run against a real `playerctl`, D-Bus session or player. The `--format` variables
  (`status`, `title`, `artist`, `album`, `mpris:length`, `position`, `volume`, `shuffle`, `loop`), the
  `Playing`/`Paused`/`Stopped` and `None`/`Track`/`Playlist` words, the `On`/`Off` shuffle words and the
  `position`/`volume` argument forms come from playerctl's README and source and are unconfirmed on a
  live system; so are the fields a given player leaves out (empty fields are dropped).
- Players differ in what they allow (`CanSeek`, `CanControl`); `playerctl` may exit 0 and do nothing.
- No cover art, no per-player list command, no `playerctld` handling.
