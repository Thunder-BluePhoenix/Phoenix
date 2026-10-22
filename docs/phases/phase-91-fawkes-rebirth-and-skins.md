# Phase 91 — Fawkes Rebirth, Milestones, Skin Packs & Accessibility

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Low |
| Status | 🟨 Built as code and a component, tested with fakes; every check is simulated. **Not wired:** no real CI adapter feeds the gate, no registry skin-pack kind, no consent UI, no speech backend, and `FawkesRebirth` is not mounted. Neither exit criterion is met |
| Depends on | [Phase 59 — Fawkes Interactions, Emotes & Sounds](phase-59-fawkes-interactions-and-sounds.md), [Phase 42 — Capability Registry & v0.9 Release](phase-42-capability-registry.md) |
| Unblocks | — |

## Goal

Make Fawkes' identity count, for everyone.

## Tasks

- [ ] Rebirth animation when an error streak is fixed (e.g. CI red → green), only on a real recovery. A celebration gate (only after a real recovery outcome, monotonic ids) and the `FawkesRebirth` component (CSS pulse only) are built. Simulated. Unticked: no real CI adapter feeds the gate and the component is not mounted.
- [ ] Opt-in milestones (first green build of the week, PR streaks); nothing to farm. Milestones are opt-in in the component. Unticked: no consent UI.
- [ ] Skin packs through the capability registry, with licence and provenance checks. A skin installer with hash, provenance and signer checks is built. **Unticked:** the registry has no skin-pack kind.
- [ ] Spoken state changes and a high-contrast Fawkes. Reduced motion is respected. **Not built:** no speech backend. A high-contrast Fawkes is not claimed. Unticked.

## Deliverables

- `core/runtime/src/fawkes-rebirth`: celebration gate and skin installer. Built, not wired.
- `apps/web/src/components/FawkesRebirth.tsx` with i18n namespace `fawkes-rebirth` (English plus nine machine-translated, unreviewed locales). Built, not mounted. See [fawkes-rebirth.md](../fawkes-rebirth.md).

## Exit criteria

- [ ] Rebirth plays only after a real recovery event. **Simulated only:** the gate released a celebration only after a recovery outcome in tests. No real recovery event feeds it and the component is not mounted.
- [ ] A community skin installs with its licence shown. **Unmet.** There is no registry skin-pack kind and no consent UI.

## Implementation notes

### What was built

- **Celebration gate:** fires only after a real recovery outcome, with monotonic ids.
- **Skin installer:** hash, provenance and signer checks.
- **`FawkesRebirth` component:** i18n namespace `fawkes-rebirth` in English and nine locales (machine-translated, unreviewed); reduced motion respected; CSS pulse only; milestones opt-in.
- Documentation: [fawkes-rebirth.md](../fawkes-rebirth.md).

### Deviations

- Spoken state changes were not built (no speech backend). A high-contrast Fawkes is not claimed here.

### What was not built

A real CI adapter feeding the gate, a registry skin-pack kind, a consent UI, a speech backend, and mounting of the component.

### What was not run

Any real CI recovery, any real skin pack install, any display. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
