# Apple Music capability (Phase 68)

Shows what the **Music app** (Apple Music) on this Mac is playing and controls it, through
AppleScript (`osascript`). macOS only, no account, no network, no web API.

## Safety

Same design as the Spotify capability: hard-coded scripts (`src/scripts.ts`), `execFile("osascript",
["-e", SCRIPT, ...args])` with no shell, validated values passed only as `argv` arguments, an
`application "Music" is not running` check before anything that would launch the app, and player text
cleaned and clipped. The repeat mode travels as one of the words `off`, `one`, `all` after Phoenix has
checked it against that list; the script compares it, it never evaluates it.

macOS asks once whether Phoenix may control Music (System Settings > Privacy & Security > Automation).

## Commands

| Command                          | Side effect | Notes                                                                                                              |
| -------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| `now_playing`                    | read        | state, title, artist, album, `position_s`, `duration_s`, `volume` (0-100), `shuffle`, `repeat` (`off`/`one`/`all`) |
| `play_pause`, `next`, `previous` | write       |                                                                                                                    |
| `seek` `{position_s}`            | write       | integer 0..86400                                                                                                   |
| `set_volume` `{volume}`          | write       | integer 0..100                                                                                                     |
| `set_shuffle` `{enabled}`        | write       |                                                                                                                    |
| `set_repeat` `{mode}`            | write       | `off`, `one`, `all`                                                                                                |

`write` commands **ask for your confirmation every time** and are audited.

## Events and Fawkes

`apple_music.track.playing` / `apple_music.track.paused` (ephemeral). The event prefix uses an
underscore because event types may not contain `-`; the capability id is `apple-music`. No `state_rules`:
no existing Fawkes state means listening to music (see the Spotify README).

## Not built / not verified

- No cover art: Music exposes artwork only as raw picture data through AppleScript; converting and
  validating it was out of scope. (GAP)
- Run only against a fake runner; no real Music app was controlled. AppleScript was compiled for syntax
  only. Dictionary terms (`song repeat`, `shuffle enabled`, `player state`) follow Apple's Music
  dictionary and are unconfirmed. Linux and Windows are unsupported (health `degraded`).
