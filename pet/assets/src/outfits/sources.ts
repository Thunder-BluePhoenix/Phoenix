// SPDX-License-Identifier: CC-BY-SA-4.0
// Copyright (C) 2026 Phoenix contributors
//
// Per-source identity for Fawkes pills (Phase 61): a colour and a small glyph for each coding agent
// and capability. The glyphs are original, simple geometric shapes on a 16x16 canvas. A pill never
// relies on colour alone: it always carries the glyph and a text label as well.

/** `agent:<slug>` for a coding agent, `capability:<id>` for a Phoenix capability. */
export const SOURCE_ID = /^(?:agent|capability):[a-z0-9][a-z0-9_-]{0,63}$/;
export const SOURCE_COLOUR = /^#[0-9a-f]{6}$/;
/** Most per-source entries Core stores. */
export const MAX_SOURCES = 64;

export const GLYPH_NAMES = [
  "spark",
  "diamond",
  "triangle",
  "square",
  "ring",
  "bars",
  "hexagon",
  "cross",
  "wave",
  "crescent",
] as const;
export type GlyphName = (typeof GLYPH_NAMES)[number];

/** SVG markup for each glyph (16x16, filled with currentColor). Bundled, never user supplied. */
export const GLYPHS: Record<GlyphName, { label: string; markup: string }> = {
  spark: {
    label: "Spark",
    markup: '<path d="M8 1 L9.8 6.2 L15 8 L9.8 9.8 L8 15 L6.2 9.8 L1 8 L6.2 6.2 Z"/>',
  },
  diamond: { label: "Diamond", markup: '<path d="M8 1 L14 8 L8 15 L2 8 Z"/>' },
  triangle: { label: "Triangle", markup: '<path d="M8 2 L14.5 13.5 L1.5 13.5 Z"/>' },
  square: { label: "Square", markup: '<rect x="3" y="3" width="10" height="10" rx="1.5"/>' },
  ring: {
    label: "Ring",
    markup:
      '<path fill-rule="evenodd" d="M8 1.5 A6.5 6.5 0 1 1 7.99 1.5 Z M8 5 A3 3 0 1 0 8.01 5 Z"/>',
  },
  bars: {
    label: "Bars",
    markup: '<path d="M2 3 H14 V5.5 H2 Z M2 6.8 H14 V9.3 H2 Z M2 10.6 H14 V13 H2 Z"/>',
  },
  hexagon: { label: "Hexagon", markup: '<path d="M8 1 L14 4.5 V11.5 L8 15 L2 11.5 V4.5 Z"/>' },
  cross: { label: "Cross", markup: '<path d="M6 2 H10 V6 H14 V10 H10 V14 H6 V10 H2 V6 H6 Z"/>' },
  wave: {
    label: "Wave",
    markup: '<path d="M1 9 C3 4 5 4 8 8 C11 12 13 12 15 7 V11 C13 16 11 16 8 12 C5 8 3 8 1 13 Z"/>',
  },
  crescent: {
    label: "Crescent",
    markup: '<path d="M11 1.5 A7 7 0 1 0 14.5 11 A5.5 5.5 0 0 1 11 1.5 Z"/>',
  },
};

export const isGlyphName = (value: unknown): value is GlyphName =>
  typeof value === "string" && Object.hasOwn(GLYPHS, value);

/**
 * Default colours: each meets WCAG AA (4.5:1) on the pill background (pinned by test), so a source is
 * readable before the user picks anything.
 */
export const DEFAULT_SOURCE_COLOURS = [
  "#1971c2",
  "#c2255c",
  "#237a36",
  "#c2410c",
  "#7048e8",
  "#0b7285",
  "#a61e4d",
  "#5f3dc4",
] as const;

export interface SourceStyle {
  colour: string;
  glyph: GlyphName;
  show: boolean;
}

/** FNV-1a: stable across runs, so a source keeps its default look. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** The look a source has until the user changes it. */
export function defaultSourceStyle(id: string): SourceStyle {
  const h = hash(id);
  return {
    colour: DEFAULT_SOURCE_COLOURS[h % DEFAULT_SOURCE_COLOURS.length]!,
    glyph: GLYPH_NAMES[(h >>> 8) % GLYPH_NAMES.length]!,
    show: true,
  };
}

/**
 * Every pill paints its own surface, whatever the page theme, so one contrast check holds in the
 * navbar, the Pet Panel, the floating window and the dark island.
 */
export const PILL_BACKGROUND = "#ffffff";

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two #rrggbb colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** WCAG AA for normal text; the Wardrobe warns below it. */
export const AA_CONTRAST = 4.5;
