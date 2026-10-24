# Phase 59 — Fawkes Interactions, Emotes & Sounds

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | 🟨 Interactions, emotes and a procedural sound library with its policy built and unit-tested; the web app now hosts the sound player with a Settings section and real quiet mode and quiet hours (tested with fakes only); no sound ever played, no desktop sounds-folder reader, desktop follow-the-pointer driven from the web page behind an off-by-default setting and tested only with fakes (never run on a real display), emote artwork not looked at |
| Depends on | [Phase 10 — Animation System & P0 States](phase-10-animation-system-p0-states.md) |
| Unblocks | [Phase 61 — Wardrobe, Per-Source Fawkes & Visible Capabilities](phase-61-wardrobe-and-per-source-fawkes.md), [Phase 91 — Fawkes Rebirth, Milestones, Skin Packs & Accessibility](phase-91-fawkes-rebirth-and-skins.md) |

## Goal

Make Fawkes a character you can interact with, with original motion and sound.

## Tasks — parity with Coucou

- [x] Greeting on launch (`pet/runtime/src/interaction-engine.ts`, `fawkes.ts`, `FawkesAvatar.tsx`; tests `interaction-engine.test.ts` "launch greeting", `fawkes-interactions.test.ts`, `fawkes-avatar-interactions.test.tsx`). Every mounted `FawkesAvatar` greets by default (opt out with `interactive={false}`).
- [x] Eyes follow the cursor (`gazeTarget`, `smoothGaze`, a `pointermove` listener in `fawkes.ts`; tests `interaction-engine.test.ts` "cursor tracking", `fawkes-interactions.test.ts` "gaze follows the cursor"). Inside the page only; it does not follow the cursor outside the window.
- [x] Hover: blinks, eyes grow; click: squish + annoyed; 3 fast clicks: dizzy (tests `interaction-engine.test.ts` "hover" and "poke and dizzy", `fawkes-interactions.test.ts`, `fawkes-avatar-interactions.test.tsx`)
- [x] Emotes with real triggers; happy jump when an agent finishes (the jump needs a fresh `agent.completed` event in the state snapshot, once per event id: `interaction-engine.test.ts` "completion jump", `fawkes-interactions.test.ts` "completion jump needs a real event"). The motion CSS is checked as text (`pet/assets/test/emotes.test.ts`); nobody has looked at the artwork rendered.
- [ ] Sound set for events, a sounds folder to replace any sound, mute. Built and tested: seven procedurally generated sounds (`pet/assets/src/sounds.ts`, `pet/assets/test/sounds.test.ts`), the player with mute and volume (`pet/runtime/src/sounds.ts`, `sounds.test.ts`), WAV validation of user files, and `FawkesAvatar` accepts a `sounds` player. The web app now creates the player (`apps/web/src/core/sounds.ts`: `SoundHost`, mounted in `App`, `FloatingApp` and `IslandApp`), with a Settings section (switch off by default, volume 0-100, a preview button per event; `apps/web/src/components/SoundSettings.tsx`, `ui.sounds` in Core) and tests in `apps/web/test/sounds.test.tsx`. Not built: the desktop code that reads a real sounds folder (only the injected `SoundOverrideResolver` interface exists, no host passes one; the Rust/Tauri side is untouched). The browser audio backend was tested against fakes; no audio was ever played. See [fawkes-sounds.md](../fawkes-sounds.md).
- [ ] On the desktop: follows the cursor, flies home on an alert and back. Built behind a Settings opt-in (**off by default**): the floating page (`apps/web/src/floating/`: `follow-shell.ts`, `follow-driver.ts`, `use-follow-cursor.ts`) feeds `followStep` and executes its commands. See "Desktop follow" below. Unticked because **nothing ran on a real desktop display**: the pointer reads, window moves, multi-monitor clamping, Wayland (where the pointer position may be unavailable) and the feel of the flight are all unobserved.

## Tasks — Phoenix improvements

- [x] All motion respects reduced motion with a still pose (Phase 10 rule): gaze is off and every emote has a still pose in CSS (`emotes.test.ts` "gaze is neutralised", per-emote still pose; `interaction-engine.test.ts`, `fawkes-interactions.test.ts`, `fawkes-avatar-interactions.test.tsx` "holds a still pose under reduced motion"; `follow.test.ts` "reduced motion makes flights instant")
- [ ] Sounds respect quiet mode and quiet hours, and are off by default. The policy does (`sounds.test.ts`: off by default, mute, quiet via an injected `isQuiet()`, `inQuietHours` including midnight wrap and a malformed window counted as quiet), and the web host now connects `isQuiet()` to Phoenix's real quiet mode (notification switch off), quiet hours (the Proactive `quietHours`, judged with the clock at play time), the emergency stop and the demo, failing silent when Core cannot say (`apps/web/test/sounds.test.tsx`, shown with a fake backend and fake Core only; each rule was mutation-checked; no sound was heard). Sounds also wait for a user gesture. Left unticked: nothing was heard on a real device and the desktop windows were only run in happy-dom.
- [x] Every emote maps to a real event; Fawkes never fakes a state (Tech Spec §10): an emote sets only `data-emote`, never `data-state`/`data-animation`/`aria-label`, ends at once on an urgent state, and has a bounded duration and a real source (`interaction-engine.test.ts` "real state always wins", `fawkes-interactions.test.ts` "interaction emotes are never agent states")

## Desktop follow (floating Fawkes follows the pointer and flies home)

All evidence is simulated: Vitest with fake timers, a fake `FollowShell` and a fake Core in happy-dom. Nothing ran on a real display.

- **Setting:** Settings → Fawkes → "Let the floating Fawkes follow my mouse pointer (desktop app only)". It is `follow_cursor` in `GET/POST /api/pet/settings` (Core, `PetSettings`), **off by default**; only a stored `true` turns it on, only a real boolean is accepted, a change publishes `pet.settings.changed` so the floating window reacts without a reload. Nothing is read or moved while it is off. The ten-locale text is in `apps/web/src/i18n/*/follow.ts` (non-English machine-translated and unreviewed).
- **Where the pointer comes from, and why no Rust changed:** the floating page reads Tauri's own core window commands `plugin:window|cursor_position`, `outer_position`, `outer_size`, `scale_factor`, `is_visible` and `monitor_from_point` (`follow-shell.ts`). They are in `core:window:default`, which is part of `core:default`, which `capabilities/default.json` already grants to the `fawkes` and `fawkes-island` windows (checked in `gen/schemas/acl-manifests.json`). So **no new capability, permission, crate or Rust code** was added, and the window is moved only through the existing allow-listed `move_window_by`, which still refuses every window but the floating one. The pill (a remote page) has no `core:window` read beyond what `core:default` already gave it and does not use this. The pointer read is a read of the screen position only; it is not a global keyboard or mouse hook and asks for no macOS Input Monitoring or Accessibility permission (Tauri's `cursor_position` uses the platform's ordinary position query).
- **Driver:** `FollowDriver` runs the existing pure machine (`pet/runtime/src/follow.ts`). Polls the pointer every 100 ms only in the `following` phase; flights step every 33 ms with an ease-out and snap onto the target; the target is the pointer plus 16 CSS pixels (never under it), clamped so the whole window stays inside the monitor's work area. Home is where Fawkes was when following began (or where the person last dropped it). An alert (an urgent display state: needs you, error, recording; never OFFLINE) flies home; clearing it returns to the pointer. Holding Fawkes (drag) stops all moves and resumes after the drop.
- **Reduced motion** (Settings choice, or the system setting under "auto"): no glide ever; a move is one instant jump and happens only after the pointer has rested for two polls.
- **Quiet and emergency stop:** the driver is suspended (no reads, no moves, Fawkes stays where it is) until Phoenix has said it is not quiet. It asks `SoundHost.quietNow()`, the same answer sounds use (quiet mode, quiet hours, the emergency stop, the demo; missing answers count as quiet), every 5 s, and the emergency stop (`GET /api/security/kill-switch` and `security.kill_switch.*` events) at once. Turning following off, and only that, sends Fawkes back home.
- **Hidden:** the window's visibility is read every second; a hidden window is never moved, and nothing starts until it has been seen shown.
- **Gives up quietly:** if the pointer cannot be read five times in a row (some Wayland sessions), following stops for that run rather than guessing.
- **Tests:** `apps/web/test/follow-driver.test.ts` (21: off by default, suspended, follow and glide, clamping, reduced motion, fly home and back, drag hold, switch-off, quiet, hidden, unreadable pointer, unreadable window, dispose, parsing, the Tauri bridge uses only `plugin:window|` commands), `apps/web/test/floating-follow.test.tsx` (8: default off, opt-in, browser, quiet mode, emergency stop at once and mid-follow, alert flight, reduced motion), `apps/web/test/settings.test.tsx` (the checkbox sends only `follow_cursor`), `core/runtime/test/privacy.test.ts` (default off, validation, one field at a time, event). Each was shown to fail with its key line disabled (driver ignoring suspension, FloatingApp ignoring the setting, Core defaulting to on).
- **Not verified:** a real pointer, real windows, more than one monitor or mixed scale factors, the Windows/Linux `cursor_position` behaviour, Wayland, how the transparent window feels while moving, and whether a Fawkes that follows the pointer interferes with clicks. The click-through region of the island is unrelated to the floating window.

## Deliverables

- pet/assets: original emotes and sounds (CC BY-SA 4.0): `pet/assets/src/emotes.ts`, `pet/assets/src/sounds.ts`
- pet/runtime interactions: `interaction-engine.ts`, `interaction.ts`, `follow.ts`, `sounds.ts`
- apps/web sound host and Settings: `core/sounds.ts`, `components/SoundSettings.tsx` (see [fawkes-sounds.md](../fawkes-sounds.md))

## Exit criteria

- [x] Interaction tests for hover, poke, dizzy and cursor tracking (`pet/runtime/test/interaction-engine.test.ts`, `fawkes-interactions.test.ts`, `apps/web/test/fawkes-avatar-interactions.test.tsx`; 152 tests passed in one run of `pet/` plus the avatar and island web tests, made while writing this)
- [x] Asset provenance in the licence inventory ([INVENTORY.md](../licenses/INVENTORY.md): the emote motion and the procedural sound set)

## Implementation notes

Sounds are generated at run time from note descriptions; there is no sampled or third-party audio. They are off by default and play only for a real event, with sounds enabled, not muted, volume above zero and not quiet. The web app host (`apps/web/src/core/sounds.ts`) makes "not quiet" mean Phoenix's real quiet mode, quiet hours, emergency stop and demo, read from Core at play time, and waits for a user gesture; the Settings section has the switch, the volume and a preview per event. The user sounds folder reader for the desktop is NOT built. Not verified: that any of it is audible or pleasant, the Web Audio backend against a real `AudioContext`, and what the emote artwork looks like. The whole phase is exercised by unit tests and a happy-dom render only.

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.
- Own assets only: nothing from Coucou's Mochi, sounds or icons.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
