# pet/assets

Fawkes character assets. Licensed **CC BY-SA 4.0** (ADR-0018), separate from the GPL runtime code. Provenance: [licence inventory](../../docs/licenses/INVENTORY.md).

- `src/fawkes.ts`: Fawkes (Phase 10). Original SVG artwork plus CSS keyframes for every animation, and a still pose per state for reduced motion.

![Fawkes in every state](../../docs/images/fawkes-states.svg)

Rules every asset follows (enforced by `test/assets.test.ts`):

- Animate only `transform` and `opacity` (cheap, compositor-friendly); idle runs at most three slow loops.
- Every loop starts at the neutral pose, so any state can interrupt any other.
- Under reduced motion every state keeps a distinct still pose.
- No scripts, external references or element ids.

After changing the artwork, regenerate the previews: `npx tsx scripts/render-fawkes-gallery.ts`.
