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
  /**
   * CSS for the transient interaction emotes (`.fawkes[data-emote="<name>"]`) and the cursor gaze.
   * Injected after `css`, so an emote may override a state animation for its short duration.
   */
  emoteCss: string;
  /** Animations this asset implements; the runtime warns about missing ones in tests. */
  animations: readonly AnimationName[];
}

/** Where on Fawkes an outfit layer sits. Drawing order is fixed by the runtime, not by the pack. */
export type OutfitSlot = "head" | "eyes" | "body" | "neck" | "tail" | "aura" | "held";
/** The only motion a layer may ask for: keyframes that already ship with the Fawkes asset. */
export type OutfitAnimation =
  | "fawkes-breathe"
  | "fawkes-ember"
  | "fawkes-bob"
  | "fawkes-float"
  | "fawkes-pulse"
  | "fawkes-tail-trail"
  | "fawkes-doze";
export type OutfitSeason = "spring" | "summer" | "autumn" | "winter" | "any";

/** One layer of an outfit pack. Both fragments are in Fawkes' 64x64 coordinate space. */
export interface OutfitLayer {
  slot: OutfitSlot;
  /** Sanitised SVG fragment (no root element, no script, CSS or external reference). */
  svg: string;
  /** Fragment shown under reduced motion; required when `animation` is set. */
  still?: string;
  /** One of Phoenix's built-in keyframe names (OUTFIT_ANIMATIONS). */
  animation?: OutfitAnimation;
}

/** The community outfit pack format (`format: "phoenix-outfit"`, version 1). */
export interface OutfitPack {
  format: "phoenix-outfit";
  version: 1;
  id: string;
  name: string;
  author: string;
  license: string;
  season?: OutfitSeason;
  layers: OutfitLayer[];
}

/** A parsed SVG fragment node: only allow-listed elements and attributes ever reach this tree. */
export interface OutfitSvgNode {
  tag: string;
  attrs: [name: string, value: string][];
  children: OutfitSvgNode[];
}
