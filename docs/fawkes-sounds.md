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

## Strings

`apps/web/src/i18n/en/sounds.ts` and the nine locales. The nine non-English files are machine-translated and unreviewed.

## Tests

`apps/web/test/sounds.test.tsx` (28: off by default, on plays, volume, quiet mode, quiet hours with an injected clock including midnight wrap and time zone, malformed window, mute, emergency stop, demo, missing Core answers, gesture, failing and hanging backend, settings save, preview rules, the Settings section and the app host) and `core/runtime/test/ui-settings.test.ts` (sound settings routes, validation, auth, event). The player policy: `pet/runtime/test/sounds.test.ts`. Key lines were reverted one at a time to check the tests fail without them.

## Not done

- **The desktop user sounds folder** (replace any built-in sound with `<soundId>.wav`) is not built. Only the injected `SoundOverrideResolver` interface exists; no host passes one, and no Rust/Tauri code reads a real folder.
- No sound was heard on any device, and the Web Audio backend was only tested against fakes.
- The floating and island windows use the same host but were only run in happy-dom; their mute flag still comes from the desktop shell.
