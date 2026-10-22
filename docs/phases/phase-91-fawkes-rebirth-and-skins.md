# Phase 91 — Fawkes Rebirth, Milestones, Skin Packs & Accessibility

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Low |
| Status | 🟨 Built as code and a component and wired into Core and the web app; every check is simulated (fakes, a real running Core fed by fake GitHub events, rendered components). **Not done:** any CI adapter other than GitHub, the registry skin-pack kind and install UI, spoken announcements, real artwork beyond the CSS pulse, a real CI run. Neither exit criterion is met |
| Depends on | [Phase 59 — Fawkes Interactions, Emotes & Sounds](phase-59-fawkes-interactions-and-sounds.md), [Phase 42 — Capability Registry & v0.9 Release](phase-42-capability-registry.md) |
| Unblocks | — |

## Goal

Make Fawkes' identity count, for everyone.

## Tasks

- [ ] Rebirth animation when an error streak is fixed (e.g. CI red → green), only on a real recovery. A celebration gate (only after a real recovery outcome, monotonic ids) and the `FawkesRebirth` component (CSS pulse only) are built; `FawkesRebirthService` feeds the gate from the GitHub capability's CI events and `RebirthAvatar` is mounted. Simulated. Unticked: no real CI run, GitHub is the only adapter.
- [ ] Opt-in milestones (first green build of the week, PR streaks); nothing to farm. Milestones are opt-in (`fawkes.rebirth` `milestones`, default false) with a Settings section. Simulated. Unticked.
- [ ] Skin packs through the capability registry, with licence and provenance checks. A skin installer with hash, provenance and signer checks is built. **Unticked:** the registry has no skin-pack kind.
- [ ] Spoken state changes and a high-contrast Fawkes. Reduced motion is respected. The high-contrast setting (`fawkes.rebirth` `highContrast`, default false) is passed to the component; simulated only. **Not built:** no speech backend (`speak` is not supplied). Unticked.

## Deliverables

- `core/runtime/src/fawkes-rebirth`: celebration gate and skin installer; `service.ts` (`FawkesRebirthService`) subscribes to `github.ci.passed|failed` and `github.pr.merged|closed` (only `source === "github"`, which `POST /api/events` refuses to accept), keys a pipeline by a hash of repository + workflow + branch (so a red feature branch is not fixed by green main), feeds `createCelebrationGate` and publishes the ephemeral core event `fawkes.celebration` with payload `{kind, id}` only (never stored in history; listed in `LIVE_EPHEMERAL` in `core/api/src/websocket.ts`). The skin installer is not wired.
- Settings `fawkes.rebirth` `{milestones, highContrast}` (both default false; rebirth has no switch) via `GET/PUT /api/fawkes/rebirth`, audited as `fawkes.rebirth.settings.changed`.
- Web: `apps/web/src/core/rebirth.ts` (hooks), `RebirthAvatar.tsx` wrapping `FawkesAvatar` in the navbar, floating and island views, and `FawkesRebirthSettings.tsx` (Settings section). `FawkesRebirth.tsx` strings are in namespace `fawkesRebirth`, including `fawkesRebirth.settings.*`, in all ten locales (nine machine-translated, unreviewed). See [fawkes-rebirth.md](../fawkes-rebirth.md).
- Tests: `core/runtime/test/fawkes-rebirth-wiring.test.ts` (6) and `apps/web/test/rebirth-mount.test.tsx` (7).

## Exit criteria

- [ ] Rebirth plays only after a real recovery event. **Simulated only:** the gate released a celebration only after a recovery outcome in tests, and fake GitHub events reached the mounted avatar through a running Core. No real CI run fed it.
- [ ] A community skin installs with its licence shown. **Unmet.** There is no registry skin-pack kind and no install UI or consent.

## Implementation notes

### What was built

- **Celebration gate:** fires only after a real recovery outcome, with monotonic ids.
- **Skin installer:** hash, provenance and signer checks.
- **`FawkesRebirth` component:** i18n namespace `fawkes-rebirth` in English and nine locales (machine-translated, unreviewed); reduced motion respected; CSS pulse only; milestones opt-in.
- Documentation: [fawkes-rebirth.md](../fawkes-rebirth.md).

### Deviations

- Spoken state changes were not built (no speech backend). A high-contrast Fawkes is not claimed here.

### What was not built

Any CI adapter other than GitHub, a registry skin-pack kind and install UI/consent, spoken announcements (`speak` is not supplied), and real artwork beyond the CSS pulse.

### What was not run

Any real CI recovery (only fake GitHub events), any real skin pack install, any display. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
