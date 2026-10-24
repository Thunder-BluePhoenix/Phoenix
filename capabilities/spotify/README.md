# Spotify capability (Phase 68)

Shows what the **local Spotify desktop app** is playing and controls it. macOS only. It talks to the
app through AppleScript (`osascript`); it uses no Spotify account, token or web API.

## Safety

- Every script is a hard-coded constant in `src/scripts.ts`. Nothing (track title, volume, seek position)
  is ever put into script text. Values travel as separate `osascript` arguments, read in AppleScript with
  `item N of argv`, after being checked as whole numbers / booleans / a fixed word list.
  `execFile("osascript", ["-e", SCRIPT, ...args])`, no shell.
- Every script that talks to Spotify first checks `application "Spotify" is not running` and returns
  `not_running`. Phoenix never launches the app.
- Text coming back from the player is cleaned in AppleScript (control characters and the field
  separator removed), then clipped and cleaned again in `parse.ts`. It is data, never an instruction.
- The first run makes macOS ask whether Phoenix may control Spotify (System Settings > Privacy &
  Security > Automation). If refused, health shows that in words.

## Commands

| Command                          | Side effect | Notes                                                                                                                              |
| -------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `now_playing`                    | read        | state, title, artist, album, `position_s`, `duration_s`, `volume` (0-100), `shuffle`, `repeat` (`off`/`all`), `cover_url`, `cover` |
| `play_pause`, `next`, `previous` | write       |                                                                                                                                    |
| `seek` `{position_s}`            | write       | integer 0..86400                                                                                                                   |
| `set_volume` `{volume}`          | write       | integer 0..100 (Spotify's own volume)                                                                                              |
| `set_shuffle` `{enabled}`        | write       |                                                                                                                                    |
| `set_repeat` `{mode}`            | write       | `off` or `all`. Spotify's scripting interface has one repeat switch, so there is no repeat-one                                     |

`write` commands **ask for your confirmation every time** (the permission gateway's rule for
`write`/`execute`/`external`/`production`), and are written to the audit log. That is deliberate and
makes a quick pause an approval: it can be relaxed later through the approval-rules feature, not here.

## Cover art

The web UI's CSP is `img-src 'self' data:`, so a remote image can never be shown and the CSP is not
loosened. Instead `now_playing` fetches the cover itself, **only from `https://*.scdn.co`** (no
redirects, no port, no credentials in the URL, 400 KB max, 5 s), checks the first bytes are really JPEG,
PNG or WebP, and returns an inline `data:` URI as `cover`. Anything else is dropped (`cover` absent).
`cover_url` is the https URL the app reported, for reference only.

## Events and Fawkes

`spotify.track.playing` (playback starts or the track changes) and `spotify.track.paused` (paused,
stopped, app closed). Both are **ephemeral** (live subscribers only; not stored). While watched, the
player is polled every 5 s (`poll_ms`, minimum 2 s).

**No `state_rules`.** Fawkes' ten states are fixed (ADR-0019) and none means "enjoying music";
mapping playback to WORKING or SUCCESS would tell the user Phoenix is busy. "Fawkes dances while it
plays" therefore needs a new, music-specific state and animation, which this phase was told not to add.

## Not verified

Run only against a fake runner: no real Spotify was started or controlled. The AppleScript was compiled
(`osacompile`) for syntax and the `is running` check was run on a Mac where Spotify is not installed,
so the dictionary terms (`player state`, `artwork url`, `repeating`, ...) are from Spotify's published
scripting dictionary and unconfirmed. Off macOS the capability reports `unsupported` and health `degraded`; Linux players
(including Spotify) are handled by the separate `mpris` capability (`capabilities/mpris`), and Windows is not
implemented.
