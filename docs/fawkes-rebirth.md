<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Phoenix contributors -->

# Fawkes rebirth, milestones, skin packs and accessibility (Phase 91)

Three injectable pieces. All evidence is simulated: tests use injected fakes, no real CI provider, registry, network, speech engine or OS setting is touched.

## Celebration gate — `core/runtime/src/fawkes-rebirth/events.ts`

`createCelebrationGate({ milestones?, now? })` turns authoritative, ordered adapter outcomes (`BuildOutcome`, `PullRequestOutcome`) into `Celebration`s. It never reads `PetState`.

- **Rebirth** only for a `failed` build followed by a newer (higher `sequence`) `passed` build on the **same** `stream`. A green result with no remembered failure (first event, after `reset()`/restart, another pipeline), an `unknown` result, a stale or repeated sequence, or a timestamp more than 60 s in the future never celebrates. Rebirth is not a milestone and works with milestones off.
- **Milestones** are off unless `milestones: true`: `first-green-week` (first passing build per pipeline per ISO UTC week) and `pr-streak` (fires exactly when the third distinct PR in a row is merged; a closed PR resets it; the same PR id repeated does not count).
- Streams/items must match `^[a-zA-Z0-9._:-]{1,128}$`; at most 128 streams of each kind are tracked (oldest evicted). State is in-memory only: no persistence, user identity, scores, badges or points.

## Skin packs — `core/runtime/src/fawkes-rebirth/skins.ts`

`installSkin(id, version, expectedLicense, host)` bridges a **verified registry entry** to the existing `phoenix-outfit` v1 wardrobe format. Order: `preview` → check entry (id/version match, `signature_status: "verified"`, signer key id, 64-hex index digest, licence equal to the licence the user was shown and consented to, artifact digest and size ≤ 100 kB) → `fetch` (host-supplied, permission-gated and audited; never a URL from the pack) → size + SHA-256 check → strict UTF-8 JSON parse → host `validate` (`validateOutfitPack`: allow-listed SVG, no scripts/external refs) → pack id/licence must match the registry entry → `install`. Any failure throws before `install`. The pack carries no code.

The host UI must display the licence and provenance (signer key id) and obtain explicit consent before calling it.

## Web — `apps/web/src/components/FawkesRebirth.tsx`

Wraps the existing `FawkesAvatar`. Props: `celebration` (`{kind, id}` from the gate; each `id` is handled once), `milestonesEnabled`, `highContrast`, `spokenChanges`, `reducedMotion`, `speak`.

- Short original CSS pulse (`fawkes-rebirth.css`); no assets. Skipped when `reducedMotion` is set and by `prefers-reduced-motion: reduce`.
- A polite `role="status"` live region announces every shown celebration; `spokenChanges` additionally calls the injected `speak(text)` once per delivery.
- Milestones are ignored (not queued, not replayed later) unless `milestonesEnabled`.
- `highContrast` gives a black disc, white outline and greyscale/contrast-boosted art; `forced-colors` uses system colours.
- Strings use `useT()`, namespace `fawkesRebirth` (`en/fawkes-rebirth.ts` and nine locales; machine-translated, unreviewed).

## Tests

`core/runtime/test/fawkes-rebirth.test.ts`, `apps/web/test/fawkes-rebirth.test.tsx`.

## Host wiring still required

- Feed CI/PR adapter outcomes into one `createCelebrationGate` per authenticated session and map results to `FawkesCelebration` with a monotonic `id`.
- Settings toggles for milestones, high contrast, spoken changes; pass `reducedMotion` from the pet reduced-motion setting; supply a `speak` backed by an OS/web speech engine.
- A `SkinInstaller` implemented over `RegistryService.preview`, the gateway-checked artifact fetch (audited), `validateOutfitPack`, and the outfit import route; a UI showing licence + signer before consent.
- Import `FawkesRebirth` where `FawkesAvatar` is mounted.

## Limitations

No real CI adapter or registry skin source exists yet; the registry has no skin-pack kind wired. "A community skin installs with its licence shown" is covered only for the installer logic with fakes, not an end-user flow. No original rebirth artwork beyond the CSS pulse. Spoken output depends on a host speech backend that is not provided.
