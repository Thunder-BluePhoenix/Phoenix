// SPDX-License-Identifier: CC-BY-SA-4.0
// Copyright (C) 2026 Phoenix contributors
//
// Placeholder Fawkes (Phase 07): original artwork made for Phoenix, replaced by
// the final character in Phase 10. Artwork licence per ADR-0018.
import { ANIMATIONS } from "@phoenix/pet-states";
import type { FawkesAsset } from "./types";

const svg = `<svg class="fawkes-svg" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <g class="fawkes-figure">
    <path class="fawkes-tail" d="M16 44 Q5 49 6 60 Q14 55 21 50 Z"/>
    <ellipse class="fawkes-body" cx="32" cy="38" rx="16" ry="15"/>
    <ellipse class="fawkes-belly" cx="35" cy="42" rx="9" ry="8"/>
    <path class="fawkes-wing" d="M22 33 Q13 40 20 51 Q29 47 31 38 Z"/>
    <g class="fawkes-crest">
      <path d="M28 25 Q23 13 29 6 Q30 16 33 23 Z"/>
      <path d="M33 23 Q33 9 40 4 Q38 14 37 24 Z"/>
      <path d="M37 24 Q43 15 49 14 Q43 20 41 27 Z"/>
    </g>
    <path class="fawkes-beak" d="M46 34 L55 36.5 L46 39 Z"/>
    <g class="fawkes-eye">
      <circle cx="39" cy="32" r="3"/>
      <circle class="fawkes-eye-glint" cx="40" cy="31" r="1"/>
    </g>
  </g>
</svg>`;

const css = `
.fawkes-svg { width: 100%; height: 100%; overflow: visible; }
.fawkes-svg * { transform-box: fill-box; transform-origin: center; }
.fawkes-tail, .fawkes-crest path { fill: var(--fawkes-flame, #f59f00); }
.fawkes-body { fill: var(--fawkes-primary, #e8590c); }
.fawkes-belly { fill: var(--fawkes-belly, #ffd8a8); }
.fawkes-wing { fill: var(--fawkes-wing, #c2410c); transform-origin: 80% 10%; }
.fawkes-beak { fill: var(--fawkes-beak, #fcc419); }
.fawkes-eye circle { fill: var(--fawkes-eye, #1b1b1f); }
.fawkes-eye .fawkes-eye-glint { fill: #fff; }

@keyframes fawkes-breathe { 0%,100% { transform: scale(1); } 50% { transform: scale(1.04); } }
@keyframes fawkes-blink { 0%,94%,100% { transform: scaleY(1); } 97% { transform: scaleY(0.1); } }
@keyframes fawkes-flicker { 0%,100% { transform: scaleY(1); } 50% { transform: scaleY(1.15) skewX(-4deg); } }
@keyframes fawkes-tilt { 0%,100% { transform: rotate(0); } 50% { transform: rotate(-7deg); } }
@keyframes fawkes-lean { 0%,100% { transform: translateX(0); } 50% { transform: translateX(2px) rotate(3deg); } }
@keyframes fawkes-bounce { 0%,100% { transform: translateY(0); } 40% { transform: translateY(-5px); } }
@keyframes fawkes-hop { 0% { transform: translateY(0); } 30% { transform: translateY(-8px) rotate(-5deg); } 60% { transform: translateY(0); } 100% { transform: translateY(0); } }
@keyframes fawkes-flap { 0%,100% { transform: rotate(0); } 50% { transform: rotate(-35deg); } }
@keyframes fawkes-shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-2px); } 75% { transform: translateX(2px); } }
@keyframes fawkes-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.75; } }
@keyframes fawkes-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }

.fawkes[data-animation="breathe"] .fawkes-figure { animation: fawkes-breathe 4s ease-in-out infinite; }
.fawkes[data-animation="breathe"] .fawkes-eye { animation: fawkes-blink 5s infinite; }
.fawkes[data-animation="focus"] .fawkes-crest { animation: fawkes-flicker 0.6s ease-in-out infinite; }
.fawkes[data-animation="think"] .fawkes-figure { animation: fawkes-tilt 2.4s ease-in-out infinite; }
.fawkes[data-animation="listen"] .fawkes-figure { animation: fawkes-lean 1.6s ease-in-out infinite; }
.fawkes[data-animation="attention"] .fawkes-figure { animation: fawkes-bounce 1s ease-in-out infinite; }
.fawkes[data-animation="celebrate"] .fawkes-figure { animation: fawkes-hop 0.9s ease-out 2; }
.fawkes[data-animation="celebrate"] .fawkes-wing { animation: fawkes-flap 0.3s ease-in-out 6; }
.fawkes[data-animation="caution"] .fawkes-figure { animation: fawkes-shake 0.5s ease-in-out 3; }
.fawkes[data-animation="alarm"] .fawkes-figure { animation: fawkes-shake 0.4s ease-in-out infinite; }
.fawkes[data-animation="alarm"] .fawkes-crest path { fill: var(--fawkes-danger, #e03131); }
.fawkes[data-animation="record"] .fawkes-figure { animation: fawkes-pulse 2s ease-in-out infinite; }
.fawkes[data-animation="fly"] .fawkes-figure { animation: fawkes-float 1.2s ease-in-out infinite; }
.fawkes[data-animation="fly"] .fawkes-wing { animation: fawkes-flap 0.4s ease-in-out infinite; }
.fawkes[data-animation="sleep"] .fawkes-figure { animation: fawkes-breathe 6s ease-in-out infinite; opacity: 0.7; }
.fawkes[data-animation="sleep"] .fawkes-eye { transform: scaleY(0.1); }
.fawkes[data-animation="offline"] .fawkes-figure { filter: grayscale(1); opacity: 0.5; }
`;

export const placeholderFawkes: FawkesAsset = {
  id: "fawkes-placeholder",
  name: "Fawkes (placeholder)",
  license: "CC-BY-SA-4.0",
  author: "Phoenix contributors",
  svg,
  css,
  animations: ANIMATIONS,
};
