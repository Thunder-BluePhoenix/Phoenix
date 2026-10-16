// SPDX-License-Identifier: CC-BY-SA-4.0
// Copyright (C) 2026 Phoenix contributors
//
// Seasonal outfits for auto-season: a blossom sprig, sunbeam shades, a maple drift and a frostwool beanie.
// Original artwork by Phoenix contributors, drawn as plain SVG fragments on Fawkes' 64x64 canvas.
// Nothing here is traced, generated from a reference or taken from another product.
import type { OutfitPack } from "../types";

const AUTHOR = "Phoenix contributors";
const LICENSE = "CC-BY-SA-4.0";

const SUN_RAYS =
  '<circle cx="56" cy="9" r="3.4" fill="#ffd43b"/><path d="M56 2 V3.8 M56 14.2 V16 M49 9 H50.8 M61.2 9 H63 M51 4 L52.3 5.3 M59.7 12.7 L61 14 M61 4 L59.7 5.3 M52.3 12.7 L51 14" fill="none" stroke="#fab005" stroke-width="1" stroke-linecap="round"/>';
const SNOW =
  '<polygon points="8 6.8 8.55 9.05 10.77 8.4 9.1 10 10.77 11.6 8.55 10.95 8 13.2 7.45 10.95 5.23 11.6 6.9 10 5.23 8.4 7.45 9.05" fill="#a5d8ff"/><polygon points="56 10.4 56.45 12.22 58.25 11.7 56.9 13 58.25 14.3 56.45 13.78 56 15.6 55.55 13.78 53.75 14.3 55.1 13 53.75 11.7 55.55 12.22" fill="#a5d8ff"/><polygon points="58 36 58.35 37.39 59.73 37 58.7 38 59.73 39 58.35 38.61 58 40 57.65 38.61 56.27 39 57.3 38 56.27 37 57.65 37.39" fill="#d0ebff"/>';
const LEAVES =
  '<polygon points="8 9.8 9.12 12.46 11.99 12.7 9.81 14.59 10.47 17.4 8 15.9 5.53 17.4 6.19 14.59 4.01 12.7 6.88 12.46" fill="#e8590c"/><polygon points="57 6.6 57.88 8.79 60.23 8.95 58.43 10.46 59 12.75 57 11.5 55 12.75 55.57 10.46 53.77 8.95 56.12 8.79" fill="#c92a2a"/><polygon points="56 47 56.82 48.87 58.85 49.07 57.33 50.43 57.76 52.43 56 51.4 54.24 52.43 54.67 50.43 53.15 49.07 55.18 48.87" fill="#f08c00"/>';

export const seasonalOutfits: readonly OutfitPack[] = [
  {
    format: "phoenix-outfit",
    version: 1,
    id: "blossom-sprig",
    name: "Blossom Sprig",
    author: AUTHOR,
    license: LICENSE,
    season: "spring",
    layers: [
      {
        slot: "head",
        svg: '<path d="M26 24 C28 20 31 19 34 19" fill="none" stroke="#51cf66" stroke-width="1.2" stroke-linecap="round"/><circle cx="30" cy="17.9" r="1.9" fill="#fcc2d7"/><circle cx="27.53" cy="19.7" r="1.9" fill="#fcc2d7"/><circle cx="28.47" cy="22.6" r="1.9" fill="#fcc2d7"/><circle cx="31.53" cy="22.6" r="1.9" fill="#fcc2d7"/><circle cx="32.47" cy="19.7" r="1.9" fill="#fcc2d7"/><circle cx="30" cy="20.5" r="1.2" fill="#fab005"/><circle cx="46" cy="18.9" r="1.5" fill="#fcc2d7"/><circle cx="43.53" cy="20.7" r="1.5" fill="#fcc2d7"/><circle cx="44.47" cy="23.6" r="1.5" fill="#fcc2d7"/><circle cx="47.53" cy="23.6" r="1.5" fill="#fcc2d7"/><circle cx="48.47" cy="20.7" r="1.5" fill="#fcc2d7"/><circle cx="46" cy="21.5" r="1.2" fill="#fab005"/>',
      },
    ],
  },
  {
    format: "phoenix-outfit",
    version: 1,
    id: "sunbeam-shades",
    name: "Sunbeam Shades",
    author: AUTHOR,
    license: LICENSE,
    season: "summer",
    layers: [
      {
        slot: "eyes",
        svg: '<line x1="34" y1="28" x2="27" y2="27" stroke="#fab005" stroke-width="1"/><circle cx="39.5" cy="28.5" r="5.6" fill="#343a40" opacity="0.8" stroke="#fab005" stroke-width="1"/><path d="M37 26.2 L39 25.2" fill="none" stroke="#ffffff" stroke-width="0.9" stroke-linecap="round" opacity="0.7"/>',
      },
      {
        slot: "aura",
        svg: SUN_RAYS,
        still: SUN_RAYS,
        animation: "fawkes-pulse",
      },
    ],
  },
  {
    format: "phoenix-outfit",
    version: 1,
    id: "maple-drift",
    name: "Maple Drift",
    author: AUTHOR,
    license: LICENSE,
    season: "autumn",
    layers: [
      {
        slot: "aura",
        svg: LEAVES,
        still: LEAVES,
        animation: "fawkes-float",
      },
      {
        slot: "head",
        svg: '<polygon points="31 17.6 31.88 19.79 34.23 19.95 32.43 21.46 33 23.75 31 22.5 29 23.75 29.57 21.46 27.77 19.95 30.12 19.79" fill="#e8590c"/>',
      },
    ],
  },
  {
    format: "phoenix-outfit",
    version: 1,
    id: "frostwool-beanie",
    name: "Frostwool Beanie",
    author: AUTHOR,
    license: LICENSE,
    season: "winter",
    layers: [
      {
        slot: "head",
        svg: '<path d="M26 26.5 C27 14 41 11.5 49 24 C42 21.5 33 22 26 26.5 Z" fill="#1c7ed6"/><path d="M24.5 27.5 C32 21 42 21 49 25.5" fill="none" stroke="#e7f5ff" stroke-width="2.4" stroke-linecap="round"/><circle cx="37" cy="12.5" r="3" fill="#e7f5ff"/>',
      },
      {
        slot: "aura",
        svg: SNOW,
        still: SNOW,
        animation: "fawkes-float",
      },
    ],
  },
];
