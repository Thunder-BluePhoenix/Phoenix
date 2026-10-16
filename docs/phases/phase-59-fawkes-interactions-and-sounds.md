# Phase 59 — Fawkes Interactions, Emotes & Sounds

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | 🟨 Interactions, emotes and a procedural sound library with its policy built and unit-tested; no sound ever played, no host wires sounds or the desktop follow behaviour, emote artwork not looked at |
| Depends on | [Phase 10 — Animation System & P0 States](phase-10-animation-system-p0-states.md) |
| Unblocks | [Phase 61 — Wardrobe, Per-Source Fawkes & Visible Capabilities](phase-61-wardrobe-and-per-source-fawkes.md), [Phase 91 — Fawkes Rebirth, Milestones, Skin Packs & Accessibility](phase-91-fawkes-rebirth-and-skins.md) |

## Goal

Make Fawkes a character you can interact with, with original motion and sound.

## Tasks — parity with Coucou

- [x] Greeting on launch (`pet/runtime/src/interaction-engine.ts`, `fawkes.ts`, `FawkesAvatar.tsx`; tests `interaction-engine.test.ts` "launch greeting", `fawkes-interactions.test.ts`, `fawkes-avatar-interactions.test.tsx`). Every mounted `FawkesAvatar` greets by default (opt out with `interactive={false}`).
- [x] Eyes follow the cursor (`gazeTarget`, `smoothGaze`, a `pointermove` listener in `fawkes.ts`; tests `interaction-engine.test.ts` "cursor tracking", `fawkes-interactions.test.ts` "gaze follows the cursor"). Inside the page only; it does not follow the cursor outside the window.
- [x] Hover: blinks, eyes grow; click: squish + annoyed; 3 fast clicks: dizzy (tests `interaction-engine.test.ts` "hover" and "poke and dizzy", `fawkes-interactions.test.ts`, `fawkes-avatar-interactions.test.tsx`)
- [x] Emotes with real triggers; happy jump when an agent finishes (the jump needs a fresh `agent.completed` event in the state snapshot, once per event id: `interaction-engine.test.ts` "completion jump", `fawkes-interactions.test.ts` "completion jump needs a real event"). The motion CSS is checked as text (`pet/assets/test/emotes.test.ts`); nobody has looked at the artwork rendered.
- [ ] Sound set for events, a sounds folder to replace any sound, mute. Built and tested: seven procedurally generated sounds (`pet/assets/src/sounds.ts`, `pet/assets/test/sounds.test.ts`), the player with mute and volume (`pet/runtime/src/sounds.ts`, `sounds.test.ts`), WAV validation of user files, and `FawkesAvatar` accepts a `sounds` player. Not built: any host that creates the player (nothing in `apps/` calls `createSoundPlayer`), a settings control, and the desktop code that reads a real sounds folder (only an injected resolver interface exists). The browser audio backend was tested against fakes; no audio was ever played.
- [ ] On the desktop: follows the cursor, flies home on an alert and back. Only the pure state machine exists (`pet/runtime/src/follow.ts`, test `follow.test.ts`); it is not wired into `apps/desktop`, so the floating Fawkes does not follow the cursor or fly home.

## Tasks — Phoenix improvements

- [x] All motion respects reduced motion with a still pose (Phase 10 rule): gaze is off and every emote has a still pose in CSS (`emotes.test.ts` "gaze is neutralised", per-emote still pose; `interaction-engine.test.ts`, `fawkes-interactions.test.ts`, `fawkes-avatar-interactions.test.tsx` "holds a still pose under reduced motion"; `follow.test.ts` "reduced motion makes flights instant")
- [ ] Sounds respect quiet mode and quiet hours, and are off by default. The policy does (`sounds.test.ts`: off by default, mute, quiet via an injected `isQuiet()`, `inQuietHours` including midnight wrap and a malformed window counted as quiet), but nothing yet connects `isQuiet()` to Phoenix's real quiet mode and quiet hours settings, because no host creates a player.
- [x] Every emote maps to a real event; Fawkes never fakes a state (Tech Spec §10): an emote sets only `data-emote`, never `data-state`/`data-animation`/`aria-label`, ends at once on an urgent state, and has a bounded duration and a real source (`interaction-engine.test.ts` "real state always wins", `fawkes-interactions.test.ts` "interaction emotes are never agent states")

## Deliverables

- pet/assets: original emotes and sounds (CC BY-SA 4.0): `pet/assets/src/emotes.ts`, `pet/assets/src/sounds.ts`
- pet/runtime interactions: `interaction-engine.ts`, `interaction.ts`, `follow.ts`, `sounds.ts`

## Exit criteria

- [x] Interaction tests for hover, poke, dizzy and cursor tracking (`pet/runtime/test/interaction-engine.test.ts`, `fawkes-interactions.test.ts`, `apps/web/test/fawkes-avatar-interactions.test.tsx`; 152 tests passed in one run of `pet/` plus the avatar and island web tests, made while writing this)
- [x] Asset provenance in the licence inventory ([INVENTORY.md](../licenses/INVENTORY.md): the emote motion and the procedural sound set)

## Implementation notes

Sounds are generated at run time from note descriptions; there is no sampled or third-party audio. They are off by default and play only for a real event, with sounds enabled, not muted, volume above zero and not quiet. Not verified: that any of it is audible or pleasant, the Web Audio backend against a real `AudioContext`, and what the emote artwork looks like. The whole phase is exercised by unit tests and a happy-dom render only.

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
