// SPDX-License-Identifier: CC-BY-SA-4.0
// Copyright (C) 2026 Phoenix contributors
//
// Everyday outfits: an ember scarf, a cinder crest, a dusk nightcap and a hearth lantern.
// Original artwork by Phoenix contributors, drawn as plain SVG fragments on Fawkes' 64x64 canvas.
// Nothing here is traced, generated from a reference or taken from another product.
import type { OutfitPack } from "../types";

const AUTHOR = "Phoenix contributors";
const LICENSE = "CC-BY-SA-4.0";

export const everydayOutfits: readonly OutfitPack[] = [
  {
    format: "phoenix-outfit",
    version: 1,
    id: "ember-scarf",
    name: "Ember Scarf",
    author: AUTHOR,
    license: LICENSE,
    layers: [
      {
        slot: "neck",
        svg: '<path d="M25 37 C30 43 40 43 46 36 L47.5 40.5 C41 47 30 47 24 42 Z" fill="#c92a2a"/><path d="M27 41.5 C32 46 39 46 44 41" fill="none" stroke="#ffd43b" stroke-width="1.1" stroke-linecap="round"/>',
      },
      {
        slot: "neck",
        svg: '<path d="M28 44 L25.5 54 L31 52.5 L32.5 45 Z" fill="#c92a2a"/><path d="M26 51 L31.3 49.7" fill="none" stroke="#ffd43b" stroke-width="1.1" stroke-linecap="round"/>',
        still:
          '<path d="M28 44 L25.5 54 L31 52.5 L32.5 45 Z" fill="#c92a2a"/><path d="M26 51 L31.3 49.7" fill="none" stroke="#ffd43b" stroke-width="1.1" stroke-linecap="round"/>',
        animation: "fawkes-tail-trail",
      },
    ],
  },
  {
    format: "phoenix-outfit",
    version: 1,
    id: "cinder-crest",
    name: "Cinder Crest",
    author: AUTHOR,
    license: LICENSE,
    layers: [
      {
        slot: "head",
        svg: '<path d="M27 23 C32 19.5 42 19.5 48.5 25" fill="none" stroke="#fab005" stroke-width="1.6" stroke-linecap="round"/><circle cx="37.5" cy="20.4" r="1.5" fill="#e03131"/>',
      },
      {
        slot: "head",
        svg: '<path d="M33 19 C30 12.5 33 6.5 38 1 C38 7 41 10 41 14 C43 11 44.5 9.5 46.5 8.5 C46.5 13.5 44.5 17.5 42 20 Z" fill="#ff922b"/><path d="M36 18 C35 14 37 10.5 39 7.5 C40 11 40.5 14.5 39.5 18.5 Z" fill="#ffe066"/>',
        still:
          '<path d="M33 19 C30 12.5 33 6.5 38 1 C38 7 41 10 41 14 C43 11 44.5 9.5 46.5 8.5 C46.5 13.5 44.5 17.5 42 20 Z" fill="#ff922b"/><path d="M36 18 C35 14 37 10.5 39 7.5 C40 11 40.5 14.5 39.5 18.5 Z" fill="#ffe066"/>',
        animation: "fawkes-ember",
      },
    ],
  },
  {
    format: "phoenix-outfit",
    version: 1,
    id: "dusk-nightcap",
    name: "Dusk Nightcap",
    author: AUTHOR,
    license: LICENSE,
    layers: [
      {
        slot: "head",
        svg: '<path d="M26 26 C27 15 39 10.5 47.5 21 C41.5 19.5 33 21 26 26 Z" fill="#4263eb"/><path d="M24.5 27 C32 20.5 42 20.5 49 25.5" fill="none" stroke="#dbe4ff" stroke-width="2.4" stroke-linecap="round"/><path d="M44 16.5 C52 14.5 56 20.5 55 27" fill="none" stroke="#4263eb" stroke-width="3" stroke-linecap="round"/><circle cx="55" cy="29" r="2.6" fill="#f1f3f5"/>',
      },
      {
        slot: "aura",
        svg: '<path d="M52 9 H57 L52 15 H57" fill="none" stroke="#868e96" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M58 3 H61 L58 7 H61" fill="none" stroke="#868e96" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/>',
        still:
          '<path d="M52 9 H57 L52 15 H57" fill="none" stroke="#868e96" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M58 3 H61 L58 7 H61" fill="none" stroke="#868e96" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/>',
        animation: "fawkes-float",
      },
    ],
  },
  {
    format: "phoenix-outfit",
    version: 1,
    id: "hearth-lantern",
    name: "Hearth Lantern",
    author: AUTHOR,
    license: LICENSE,
    layers: [
      {
        slot: "aura",
        svg: '<circle cx="49" cy="50" r="9" fill="#ffe066" opacity="0.32"/>',
        still: '<circle cx="49" cy="50" r="9" fill="#ffe066" opacity="0.32"/>',
        animation: "fawkes-pulse",
      },
      {
        slot: "held",
        svg: '<path d="M46 45.5 C46 41 52 41 52 45.5" fill="none" stroke="#495057" stroke-width="1" stroke-linecap="round"/><rect x="45" y="45" width="8" height="9" rx="1.5" fill="#ffd43b" stroke="#495057" stroke-width="1"/><path d="M49 52.5 C47 50.5 48.5 49 49 47 C49.5 49 51 50.5 49 52.5 Z" fill="#f76707"/>',
      },
    ],
  },
];
