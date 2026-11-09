<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Phoenix contributors -->

# Fawkes sounds (Phase 59)

Short tones Fawkes makes for real events. All evidence is simulated: tests use a fake audio backend, a fake Core and happy-dom. Nobody has heard these sounds, and the Web Audio backend has not run on a real `AudioContext` in a real browser or the Tauri webview.

## The sounds

Seven original, procedurally generated sounds (`pet/assets/src/sounds.ts`: greet, poke, dizzy, recover, jump, waiting, error), made at run time from note descriptions. No sampled, recorded or third-party audio ships, and nothing from Coucou. Events map to sounds in `SOUND_EVENT_TABLE`: launch, poke, dizzy, recover, completion, needs-you, failure. Provenance: [INVENTORY.md](licenses/INVENTORY.md).

## The player policy — `pet/runtime/src/sounds.ts`

`createSoundPlayer({ backend, settings, isQuiet, resolver? })`: a sound plays only when sounds are enabled, not muted, the volume is above 0 and `isQuiet()` is false (checked again after any override file was read). A failing backend gives `"failed"`, never an exception. `SoundOutcome` also has `"no-gesture"`, which a host answers when the page has had no user gesture.

## The web host — `apps/web/src/core/sounds.ts`

One `SoundHost` per Core client (`soundHostFor`, `useSoundHost`) creates the pet's player and is mounted in `App` (navbar Fawkes), `FloatingApp` and `IslandApp` (a player injected by a test still wins there). The Settings section is `apps/web/src/components/SoundSettings.tsx`.

- **Off by default.** The switch and the volume (whole percent 0 to 100, default 60) live in Core, setting `ui.sounds`: `GET/POST /api/ui/sounds` (session token; strict validation; unknown fields refused), and a `ui.sounds.changed` event so every window follows. The host is silent until the saved settings have been read, and also when they cannot be read or are malformed.
- **`isQuiet()` is Phoenix's real quiet state, read from Core and judged at play time.** It is true when any of these holds, and also when any answer is missing (the host can only fail silent):
  - quiet mode: `GET /api/notifications/preferences` says `enabled: false` (Settings → Notifications → Quiet mode);
  - quiet hours: the Proactive preference `quietHours` from `GET /api/proactive`, evaluated with the host clock when the sound is about to play, same window rules as the notification policy (wraps midnight, own time zone, `start == end` is never, a malformed window counts as quiet). A Core without the proactive service (404) has no quiet hours;
  - the emergency stop: `GET /api/security/kill-switch` `engaged`, and at once on a `security.kill_switch.*` event;
  - the demo (the page's Core is the demo Core).
    Core's answers are cached at most 5 s; the clock is not cached.
- **Mute.** The desktop mute flag (`MuteState`, unknown counts as muted) wraps the player as before and also silences the Settings preview.
- **Autoplay.** A sound plays only after the page has had a user gesture (`navigator.userActivation.hasBeenActive`, or a trusted pointer, key or touch event seen by the host; a script-made event does not count). Before that the answer is `no-gesture` and nothing is created or played. The `AudioContext` is created on the first sound, never at load. A sound that does not finish within 10 s counts as failed.
- **Errors** are swallowed and reported as `failed`; the host never throws into the page.
- **Preview.** Settings has one button per event. A preview plays at the slider's volume even while sounds are OFF (that is how a person hears what they would turn on), but obeys every other rule: muted, volume 0, quiet mode, quiet hours, the emergency stop, the demo, no gesture. A silent preview says why. A preview never changes the saved switch.

## The user sounds folder (desktop only)

`<app data dir>/sounds/<id>.wav` replaces a built-in sound, where `<id>` is one of `greet`, `poke`, `dizzy`, `recover`, `jump`, `waiting`, `error` (the app data dir is Tauri's `app_data_dir`, the folder that holds `desktop.json`; Settings → Fawkes sounds shows the exact path in the desktop app). Creating the folder and the files is the user's job: Phoenix never creates, lists or writes it.

- **Shell side** (`apps/desktop/src-tauri/src/sounds_folder.rs`): one command, `sound_override`, with an optional `id` and no path argument. An id outside the fixed list of seven is refused before any file system call (`../x`, separators, NUL, other case, `greet.wav`). The file must be a regular file by `symlink_metadata` (a symlink, folder, FIFO or device is "no override"), is compared with the opened file (same device and inode on Unix; the open does not follow a link on Windows), is refused when empty or over 1 MiB, and is read with a bound one byte past the cap. It answers `{ folder, wav }`; without an `id` it only reports the folder. Only the floating (`fawkes`) and island (`fawkes-island`) windows may ask: the command checks the caller's label first and only `capabilities/default.json` grants `allow-sound-override` (the pill and browser capabilities do not). A symlinked folder itself is followed; only the file is checked.
- **Web side** (`apps/web/src/commands/sounds-shell.ts`, `SoundHost`): inside the Tauri shell the host passes a resolver to the pet player, which still runs `inspectWav` on the bytes (PCM WAV, at most 2 MiB and 5 seconds), so a bad file falls back to the built-in sound; a shell error also falls back. In an ordinary browser there is no resolver. Nothing is read while sounds are off, muted, at volume 0 or quiet; the previews use overrides too.
- **Settings** shows the folder path (read only) with the accepted names and limits, or, in a browser, a note that the folder is a desktop feature.
- **Tests:** `sounds_folder.rs` (13: all seven ids, missing, traversal-like ids, symlink and dangling symlink, oversize and exactly the cap, empty, folder named like a sound, FIFO, the folder is never created, caller labels, and a source-reading test of the wiring: caller checked before the read, no path argument, granted to the pet windows only, no listing/creating calls); `tests/lifecycle.rs` runs the real command through the mock runtime (pet window reads, another window is refused, bad ids refused); `apps/web/test/sounds-shell.test.tsx` (14: fake shell override, ids asked, validation fallback, failing shell, no shell, disabled reads nothing, preview, the Tauri bridge, the three id lists agree, the Settings text). A resolver that is not passed, or a caller check that is removed, fails the tests; the symlink and size rules each have a second line of defence in the code, so the tests only fail when both are removed.
- **Not verified:** no override file was ever played, no real webview called the command, and the Windows and Linux builds (including `FILE_FLAG_OPEN_REPARSE_POINT`) were not compiled or run here; the path text shown in Settings was not looked at on a real device.

## Strings

`apps/web/src/i18n/en/sounds.ts` and the nine locales. The nine non-English files are machine-translated and unreviewed.

## Tests

`apps/web/test/sounds.test.tsx` (28: off by default, on plays, volume, quiet mode, quiet hours with an injected clock including midnight wrap and time zone, malformed window, mute, emergency stop, demo, missing Core answers, gesture, failing and hanging backend, settings save, preview rules, the Settings section and the app host) and `core/runtime/test/ui-settings.test.ts` (sound settings routes, validation, auth, event). The player policy: `pet/runtime/test/sounds.test.ts`. Key lines were reverted one at a time to check the tests fail without them.

## Not done

- **The desktop user sounds folder** is built (see above) but nobody put a file in it and listened; it is only fake-tested and tested against a temporary directory and the mock Tauri runtime.
- No sound was heard on any device, and the Web Audio backend was only tested against fakes.
- The floating and island windows use the same host but were only run in happy-dom; their mute flag still comes from the desktop shell.
