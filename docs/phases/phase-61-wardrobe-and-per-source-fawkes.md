# Phase 61 — Wardrobe, Per-Source Fawkes & Visible Capabilities

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | Low |
| Status | 🟨 Eight original outfits, a strict outfit-pack sanitiser, the Wardrobe tab and per-source pills built and tested with component and unit tests; nothing was looked at on a real display; the desktop native "Wardrobe" menu entry was added in Phase 70 and checked only by a lifecycle test on the mock runtime |
| Depends on | [Phase 59 — Fawkes Interactions, Emotes & Sounds](phase-59-fawkes-interactions-and-sounds.md) |
| Unblocks | — |

## Goal

Personalise Fawkes and tell sources apart at a glance.

## Tasks — parity with Coucou

- [x] Wardrobe and seasonal outfits: the Wardrobe tab of the Pet Panel (`apps/web/src/components/Wardrobe.tsx`), opened by right-clicking the navbar Fawkes; "No outfit", "Follow the season" (northern or southern hemisphere) and the eight built-in outfits (`pet/assets/src/outfits.ts`, `pet/assets/src/outfits/everyday.ts`, `seasonal.ts`). Tests: `apps/web/test/wardrobe.test.tsx` ("Wardrobe", "Wardrobe entry point"), `pet/assets/test/outfits.test.ts` ("seasons").
- [ ] Wardrobe entry in the desktop's native right-click menu (floating Fawkes and island). The route constant `WARDROBE_ROUTE` exists in `apps/web/src/core/appearance.ts` and the web navbar used it alone when Phase 61 was built. Update (Phase 70): the desktop menu now has a "Wardrobe" entry that opens `/panel/wardrobe` (`apps/desktop/src-tauri/src/lib.rs`, `shortcuts.rs`; lifecycle test "Wardrobe opens the pet panel tab" on the mock runtime). Left unticked: nobody opened the real native menu or looked at the result.
- [x] A colour and a glyph per agent and per service (`pet/assets/src/outfits/sources.ts`, `core/runtime/src/appearance.ts`, `apps/web/src/components/SourcePills.tsx`). Deviation: the identity is a colour plus one of ten small geometric glyphs plus a text label, not a "mini character" ([gap register](../gaps.md)). Tests: `apps/web/test/wardrobe.test.tsx` ("source pills", "per-source settings"), `core/runtime/test/appearance.test.ts`.
- [x] Choose which tools and agents appear ("active pills"): a per-source "Show … in Fawkes" switch in the Wardrobe; a hidden source gets no pill. Tests: `wardrobe.test.tsx` ("'Show in Fawkes' off hides the source", "a capability with a running task gets a pill from the task list"), `appearance.test.ts`.

## Tasks — Phoenix improvements

- [x] User-chosen colour per source, saved as `#rrggbb`, with a text note of the contrast against the pill background and a warning below WCAG AA (`wardrobe.test.tsx` "saves a colour on blur and says its contrast", "warns, in text, when a colour is below WCAG AA"; `appearance.test.ts` validation cases).
- [x] Outfits as a separate asset pack format (`phoenix-outfit`, version 1) that users can import and delete, so the community can add original ones: `validateOutfitPack` in `pet/assets/src/outfits.ts` (a strict SVG allow-list that rejects a whole pack rather than cleaning it), Core import/list/delete routes in `core/api/src/appearance-routes.ts` and `core/runtime/src/appearance.ts` (at most 8 imported packs, 200 KB in total, re-validated when read back), the import box in the Wardrobe. Tests: `pet/assets/test/outfits.test.ts`, `appearance.test.ts` ("outfit packs"), `wardrobe.test.tsx` ("imports a pasted pack…", "refuses … in the browser without calling Core").

## Deliverables

- Outfit asset format + eight original outfits (built; see [licence inventory](../licenses/INVENTORY.md))
- Per-source "show in Fawkes" setting (built; stored by Core, shown in the Wardrobe)

## Exit criteria

- [ ] Outfits render in every Fawkes view, including reduced motion. Covered by component tests only (navbar, Pet Panel preview, the floating window and the island page rendered in happy-dom, and the still-only variants under reduced motion). No person looked at any outfit on a real display, in light or dark, at 1x or 2x, in the floating window or the island.

## Implementation notes

What exists and what its tests pin down:

- **Rendering.** `pet/runtime/src/outfit.ts` draws validated layers over the Fawkes SVG with `createElementNS`, never as markup. Under reduced motion only still variants are drawn and no animation attribute is set; switching reduced motion on or off changes the layers live. An outfit never changes Fawkes' state, accessible name or live region. A pack that bypassed the validator is refused at draw time (`pet/runtime/test/outfit.test.ts`).
- **Sanitiser.** Allow-list of elements, attributes, path commands, numbers and transforms, with bounds on element count, nesting, fragment size and the geometry reached through nested transforms. `pet/assets/test/outfits.test.ts` holds 90 hostile fragments and 32 hostile envelopes (counted in the file), two seeded 3,000-case fuzzers, and a prototype-pollution check. The nested-transform geometry bound was added after a static review.
- **Core.** `GET/POST /api/fawkes/appearance`, `POST /api/fawkes/packs`, `DELETE /api/fawkes/packs/:id`; a `fawkes.appearance.changed` event updates connected views without a reload; a body of 300,000 characters answers 413.
- **Pills.** A pill always carries its glyph and a text label (colour is never the only cue) and counts pills beyond the cap in text. The floating window shows pills for active agent sessions and running capability tasks. The island page also renders `ActiveSourcePills`, but no test exercises pills inside the island.

What was not done or not run: any look at pixels on a real display; the fit of floating and island pills at real sizes; a real click on the native "Wardrobe" context-menu entry that Phase 70 added to `apps/desktop` (lifecycle test on the mock runtime only); an independent audit of the sanitiser (only tests and a static review). Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.
- Own assets only.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
