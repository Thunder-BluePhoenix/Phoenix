# Apple Music capability (Phase 68)

Shows what the **Music app** (Apple Music) on this Mac is playing and controls it, through
AppleScript (`osascript`). macOS only, no account, no network, no web API. Cover art is read from the
Music app itself (see "Cover art"); nothing is fetched.

## Safety

Same design as the Spotify capability: hard-coded scripts (`src/scripts.ts`), `execFile("osascript",
["-e", SCRIPT, ...args])` with no shell, validated values passed only as `argv` arguments, an
`application "Music" is not running` check before anything that would launch the app, and player text
cleaned and clipped. The repeat mode travels as one of the words `off`, `one`, `all` after Phoenix has
checked it against that list; the script compares it, it never evaluates it.

macOS asks once whether Phoenix may control Music (System Settings > Privacy & Security > Automation).

## Commands

| Command                          | Side effect | Notes                                                                                                                       |
| -------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| `now_playing`                    | read        | state, title, artist, album, `position_s`, `duration_s`, `volume` (0-100), `shuffle`, `repeat` (`off`/`one`/`all`), `cover` |
| `play_pause`, `next`, `previous` | write       |                                                                                                                             |
| `seek` `{position_s}`            | write       | integer 0..86400                                                                                                            |
| `set_volume` `{volume}`          | write       | integer 0..100                                                                                                              |
| `set_shuffle` `{enabled}`        | write       |                                                                                                                             |
| `set_repeat` `{mode}`            | write       | `off`, `one`, `all`                                                                                                         |

`write` commands **ask for your confirmation every time** and are audited.

## Cover art

The web UI's CSP is `img-src 'self' data:` (`apps/desktop/src-tauri/tauri.conf.json`), so, as for
Spotify, the CSP is not loosened and `now_playing` returns the cover as an inline `data:` URI in `cover`.
`COVER_SCRIPT` (a constant, no argument, so no track or user text can reach it; it first checks the app
is running and never launches it) returns `raw data of artwork 1 of current track`, which `osascript`
prints as a `«data tdta<hex>»` literal. The runner is told to refuse more than about 800 KB of output
(`maxOutputBytes`, kind `too_large`), and `src/cover.ts` then requires the literal to be exactly that
shape, decodes it, refuses more than **400 KB** of image (the Spotify cap), and checks the first bytes:
**PNG or JPEG only**. SVG, HTML, WebP, GIF, TIFF and garbage are refused, whatever the script said. No temp
file is written. Any error, a 5 s timeout, a closed app, a track with no artwork or a refused image
means `cover` is absent and the rest of `now_playing` is unchanged; the cover never throws to the UI.
The cover is asked for once per track (title, artist, album and length); a failed read is retried on the
next call. The web side re-checks it (`validCover` in `apps/web/src/core/media.ts`).

## Events and Fawkes

`apple_music.track.playing` / `apple_music.track.paused` (ephemeral). The event prefix uses an
underscore because event types may not contain `-`; the capability id is `apple-music`. No `state_rules`:
no existing Fawkes state means listening to music (see the Spotify README).

## Not built / not verified

- Run only against a fake runner; no real Music app was controlled and no real artwork was read.
  AppleScript was compiled for syntax only. Dictionary terms (`song repeat`, `shuffle enabled`,
  `player state`, `raw data of artwork 1`) follow Apple's Music dictionary and are unconfirmed; in
  particular the `«data tdta<hex>»` output of `raw data` is as documented for AppleScript data, not
  observed. Music artwork is often a TIFF or other type for local files: such a cover is refused
  (no cover), not converted. Streamed Apple Music tracks may expose no artwork to scripts at all. Linux and Windows are unsupported (health `degraded`).
