// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { AnimationName } from "@phoenix/pet-states";

/** A Fawkes character: artwork + motion. Runtime logic never lives here. */
export interface FawkesAsset {
  id: string;
  name: string;
  /** SPDX licence of the artwork (ADR-0018). */
  license: string;
  author: string;
  /** Inline SVG markup. Parts use the classes fawkes-figure, -body, -wing, -crest, -eye, -tail. */
  svg: string;
  /**
   * CSS providing keyframes for each animation. Selectors target
   * `.fawkes[data-animation="<name>"]`. The runtime disables all of it under reduced motion.
   */
  css: string;
  /** Animations this asset implements; the runtime warns about missing ones in tests. */
  animations: readonly AnimationName[];
}
