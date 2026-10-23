<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Phoenix contributors -->

# Fawkes rebirth, milestones, skin packs and accessibility (Phase 91)

Three injectable pieces. All evidence is simulated: tests use injected fakes, a real running Core fed by fake GitHub events, and rendered components; no real CI provider, registry, network, speech engine or OS setting is touched. The gate and the component are now wired (see "How it is wired").

## Celebration gate — `core/runtime/src/fawkes-rebirth/events.ts`

`createCelebrationGate({ milestones?, now? })` turns authoritative, ordered adapter outcomes (`BuildOutcome`, `PullRequestOutcome`) into `Celebration`s. It never reads `PetState`.

- **Rebirth** only for a `failed` build followed by a newer (higher `sequence`) `passed` build on the **same** `stream`. A green result with no remembered failure (first event, after `reset()`/restart, another pipeline), an `unknown` result, a stale or repeated sequence, or a timestamp more than 60 s in the future never celebrates. Rebirth is not a milestone and works with milestones off.
- **Milestones** are off unless `milestones: true`: `first-green-week` (first passing build per pipeline per ISO UTC week) and `pr-streak` (fires exactly when the third distinct PR in a row is merged; a closed PR resets it; the same PR id repeated does not count).
- Streams/items must match `^[a-zA-Z0-9._:-]{1,128}$`; at most 128 streams of each kind are tracked (oldest evicted). State is in-memory only: no persistence, user identity, scores, badges or points.

## Skin packs — `core/runtime/src/fawkes-rebirth/skins.ts`

`installSkin(id, version, expectedLicense, host)` bridges a **verified registry entry** to the existing `phoenix-outfit` v1 wardrobe format. Order: `preview` → check entry (id/version match, `signature_status: "verified"`, signer key id, 64-hex index digest, licence equal to the licence the user was shown and consented to, artifact digest and size ≤ 100 kB) → `fetch` (host-supplied, permission-gated and audited; never a URL from the pack) → size + SHA-256 check → strict UTF-8 JSON parse → host `validate` (`validateOutfitPack`: allow-listed SVG, no scripts/external refs) → pack id/licence must match the registry entry → `install`. Any failure throws before `install`. The pack carries no code.

The local signed-registry path is wired: a strict `kind: "skin-pack"` entry is data-only and `CC-BY-4.0` only. `POST /api/registry/skins/:id/:version/install` has no request body, reads only a verified safe-basename artifact from the host-owned configured directory, and requires a Core `write` confirmation whose audited detail binds the exact id/version/licence/signer/index digest/artifact digest. It then uses `AppearanceRuntime.importPack`; manual imports remain separate. The Settings registry preview distinguishes skins from executable capabilities and shows licence, signer/index provenance and digest/size before the dedicated install request. All evidence remains local simulated fixtures; no community registry, network source or real skin install exists.

## Web — `apps/web/src/components/FawkesRebirth.tsx`

Wraps the existing `FawkesAvatar`. Props: `celebration` (`{kind, id}` from the gate; each `id` is handled once), `milestonesEnabled`, `highContrast`, `spokenChanges`, `reducedMotion`, `speak`.

- Short original CSS pulse (`fawkes-rebirth.css`); no assets. Skipped when `reducedMotion` is set and by `prefers-reduced-motion: reduce`.
- A polite `role="status"` live region announces every shown celebration; `spokenChanges` additionally calls the injected `speak(text)` once per delivery.
- Milestones are ignored (not queued, not replayed later) unless `milestonesEnabled`.
- `highContrast` gives a black disc, white outline and greyscale/contrast-boosted art; `forced-colors` uses system colours.
- Strings use `useT()`, namespace `fawkesRebirth` (`en/fawkes-rebirth.ts` and nine locales; machine-translated, unreviewed).

## Tests

`core/runtime/test/fawkes-rebirth.test.ts`, `apps/web/test/fawkes-rebirth.test.tsx`; wiring: `core/runtime/test/fawkes-rebirth-wiring.test.ts` (6) and `apps/web/test/rebirth-mount.test.tsx` (7).

## How it is wired

- **Core.** `FawkesRebirthService` (`core/runtime/src/fawkes-rebirth/service.ts`) subscribes to the GitHub capability's `github.ci.passed`, `github.ci.failed`, `github.pr.merged` and `github.pr.closed`. It only accepts events with `source === "github"`, which `POST /api/events` refuses to accept. A pipeline is keyed by a hash of repository + workflow + branch, so a red feature branch is not fixed by green main. Outcomes go into `createCelebrationGate`.
- **Event.** A celebration is published as an **ephemeral** core event `fawkes.celebration` with payload `{kind, id}` only: no repository, branch, workflow, title or person, and never stored in history. `core/api/src/websocket.ts` lists it in `LIVE_EPHEMERAL`.
- **Settings.** Settings key `fawkes.rebirth` holds `{milestones, highContrast}`, both default false (rebirth itself has no switch). `GET/PUT /api/fawkes/rebirth`; changes are audited as `fawkes.rebirth.settings.changed`.
- **Web.** `apps/web/src/core/rebirth.ts` (hooks); `RebirthAvatar.tsx` wraps `FawkesAvatar` in the navbar, floating and island views; Settings section: see `apps/web/src/components/FawkesRebirthSettings.tsx` (mounted in Settings). Strings are in namespace `fawkesRebirth`, including `fawkesRebirth.settings.*`, in all ten locales (nine machine-translated, unreviewed).

## Still not done

- Any CI adapter other than GitHub.
- Community skin publishing, remote discovery, real registry or real skin install; the signed skin-pack path uses local fixtures only.
- Spoken announcements: `speak` is not supplied.
- Real artwork beyond the CSS pulse.
- A real CI run: rebirth has only been fed by fake GitHub events.

## Limitations

No real CI adapter or registry skin source exists. Local data-only skin installation is tested using signed temporary fixtures only; it is not a community marketplace or real-world registry validation. No original rebirth artwork beyond the CSS pulse. Spoken output depends on a host speech backend that is not provided.
