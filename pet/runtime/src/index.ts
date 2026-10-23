// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
export * from "./fawkes";
export * from "./interaction";
export * from "./interaction-engine";
export * from "./follow";
export * from "./sounds";
export { BASE_CSS } from "./styles";
export { applyOutfit, OUTFIT_CSS } from "./outfit";
// The web app depends on the runtime, not on the asset package: what it needs of the outfit format comes through here.
export {
  AA_CONTRAST,
  BUILTIN_OUTFITS,
  contrastRatio,
  defaultSourceStyle,
  GLYPH_NAMES,
  GLYPHS,
  OutfitError,
  PILL_BACKGROUND,
  resolveOutfit,
  seasonOf,
  SOUND_EVENTS,
  validateOutfitPack,
  type GlyphName,
  type OutfitPack,
  type SoundEvent,
  type SourceStyle,
} from "@phoenix/pet-assets";
