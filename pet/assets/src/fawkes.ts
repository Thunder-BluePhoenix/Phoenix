// SPDX-License-Identifier: CC-BY-SA-4.0
// Copyright (C) 2026 Phoenix contributors
//
// Fawkes v2 — original Phoenix artwork.
// This file is intentionally compatible with the existing
// @phoenix/pet-assets FawkesAsset contract.

import { ANIMATIONS } from "@phoenix/pet-states";
import type { FawkesAsset } from "./types";

/**
 * Fawkes v2 visual direction:
 * - compact/chubby young phoenix
 * - oversized expressive eye
 * - rounded wing
 * - soft belly
 * - compact flame crest
 * - small flame-feather tail
 *
 * The runtime still controls state through:
 *   data-animation="breathe|focus|think|..."
 *
 * Keep the SVG self-contained so it can be safely bundled by the
 * framework-free pet runtime.
 */
const svg = `<svg
  class="fawkes-svg"
  viewBox="0 0 64 64"
  xmlns="http://www.w3.org/2000/svg"
  aria-hidden="true"
  focusable="false"
>
  <g class="fawkes-figure">

    <!-- Tail -->
    <g class="fawkes-tail">
      <path class="tail-feather tail-back"
        d="M22 46 C15 43 8 45 4 51 C10 49 15 50 20 53 Z"/>
      <path class="tail-feather tail-mid"
        d="M23 49 C17 49 12 53 10 60 C15 56 19 56 24 54 Z"/>
      <path class="tail-feather tail-core"
        d="M23 47 C18 46 14 48 11 52 C16 50 19 50 23 51 Z"/>
    </g>

    <!-- Rounded body -->
    <path
      class="fawkes-body"
      d="M16 40
         C16 31 22 25 31 24
         C41 23 49 29 51 38
         C53 47 47 55 37 57
         C27 58 18 52 16 44
         C15.7 42.5 15.7 41 16 40 Z"
    />

    <!-- Soft belly -->
    <path
      class="fawkes-belly"
      d="M29 40
         C29 35 33 32 38 33
         C43 33.5 46 37.5 45 43
         C44 48 41 51 36 51
         C31 50.5 29 46 29 40 Z"
    />

    <!-- Rounded wing -->
    <path
      class="fawkes-wing"
      d="M30 36
         C24 35 19 39 18 45
         C18 49 20 52 24 53
         C24 50 27 50 29 52
         C31 49 34 44 34 40
         C34 38 32 36.5 30 36 Z"
    />

    <!-- Fluffy chest accents -->
    <path
      class="fawkes-fluff"
      d="M29 42
         C27 43 27 46 30 47
         C29 49 32 51 35 50
         C37 52 40 50 40 48
         C43 47 43 44 41 43
         C38 45 33 45 29 42 Z"
    />

    <!-- Head -->
    <path
      class="fawkes-head"
      d="M25 30
         C24 24 27 18 34 17
         C42 16 48 21 49 28
         C50 34 46 39 40 40
         C33 41 27 37 25 30 Z"
    />

    <!-- Flame crest -->
    <g class="fawkes-crest">
      <path class="crest-outer"
        d="M29 23
           C25 18 26 12 31 6
           C31 12 34 15 35 20 Z"/>
      <path class="crest-outer"
        d="M34 20
           C33 13 36 7 42 3
           C41 10 41 16 39 22 Z"/>
      <path class="crest-outer"
        d="M39 23
           C42 18 47 16 52 16
           C48 20 45 24 41 27 Z"/>

      <path class="fawkes-crest-core"
        d="M31 21
           C29 17 29 14 31 11
           C32 15 33 18 33 21 Z"/>
      <path class="fawkes-crest-core"
        d="M36 21
           C35 16 37 12 40 8
           C39 13 39 17 38 21 Z"/>
    </g>

    <!-- Face -->
    <g class="fawkes-face">

      <!-- Cheeks -->
      <circle class="fawkes-cheek cheek-left" cx="29" cy="32" r="2.2"/>
      <circle class="fawkes-cheek cheek-right" cx="44" cy="32" r="2.2"/>

      <!-- Eye -->
      <g class="fawkes-eye">
        <ellipse cx="39.5" cy="28.5" rx="4.1" ry="4.6"/>
        <ellipse
          class="fawkes-eye-glint"
          cx="41"
          cy="26.8"
          rx="1.35"
          ry="1.5"
        />
        <circle class="fawkes-eye-pupil" cx="39.7" cy="29" r="1.3"/>
      </g>

      <!-- Eyelid for sleep -->
      <path
        class="fawkes-eyelid"
        d="M35.8 28.8 Q39.6 32.2 43.2 28.8"
      />

      <!-- Tiny beak -->
      <path
        class="fawkes-beak"
        d="M47 30 L56 32.4 L47 35 Z"
      />
      <path
        class="fawkes-beak-lower"
        d="M47 33 L54 33.4 L47 35.2 Z"
      />

      <!-- Tiny smile line -->
      <path
        class="fawkes-mouth"
        d="M47 35 Q49 36 51 35"
      />
    </g>
  </g>
</svg>`;

const css = `
.fawkes-svg {
  width: 100%;
  height: 100%;
  overflow: visible;
}

.fawkes-svg * {
  transform-box: fill-box;
  transform-origin: center;
}

/* ---------- Character palette ---------- */

.fawkes-body {
  fill: var(--fawkes-primary, #e8590c);
}

.fawkes-head {
  fill: var(--fawkes-primary, #e8590c);
}

.fawkes-belly {
  fill: var(--fawkes-belly, #ffe8cc);
}

.fawkes-fluff {
  fill: var(--fawkes-belly, #ffe8cc);
  opacity: 0.92;
}

.fawkes-wing {
  fill: var(--fawkes-wing, #c2410c);
  transform-origin: 75% 10%;
}

.fawkes-tail {
  transform-origin: 95% 35%;
}

.fawkes-tail .tail-feather {
  fill: var(--fawkes-flame, #f76707);
}

.fawkes-tail .tail-core {
  fill: var(--fawkes-flame-core, #fcc419);
}

.fawkes-crest {
  transform-origin: 50% 100%;
}

.fawkes-crest .crest-outer {
  fill: var(--fawkes-flame, #f76707);
}

.fawkes-crest .fawkes-crest-core {
  fill: var(--fawkes-flame-core, #fcc419);
}

.fawkes-cheek {
  fill: var(--fawkes-cheek, #ff8787);
  opacity: 0.55;
}

.fawkes-eye ellipse {
  fill: var(--fawkes-eye, #1b1b1f);
}

.fawkes-eye-glint {
  fill: #fff;
}

.fawkes-eye-pupil {
  fill: #111113;
}

.fawkes-beak {
  fill: var(--fawkes-beak, #fab005);
}

.fawkes-beak-lower {
  fill: var(--fawkes-beak-shade, #e67700);
}

.fawkes-mouth {
  fill: none;
  stroke: var(--fawkes-eye, #1b1b1f);
  stroke-width: 0.9;
  stroke-linecap: round;
  opacity: 0.65;
}

.fawkes-eyelid {
  fill: none;
  stroke: var(--fawkes-eye, #1b1b1f);
  stroke-width: 1.6;
  stroke-linecap: round;
  opacity: 0;
}

/* ---------- Base motion primitives ---------- */

@keyframes fawkes-breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.035); }
}

@keyframes fawkes-blink {
  0%, 91%, 100% { transform: scaleY(1); }
  94% { transform: scaleY(0.08); }
}

@keyframes fawkes-ember {
  0%, 100% { transform: scaleY(1); }
  50% { transform: scaleY(1.07); }
}

@keyframes fawkes-flicker {
  0%, 100% {
    transform: scaleY(1) skewX(0);
  }
  30% {
    transform: scaleY(1.12) skewX(-4deg);
  }
  70% {
    transform: scaleY(0.96) skewX(3deg);
  }
}

@keyframes fawkes-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(1px); }
}

@keyframes fawkes-tilt {
  0%, 100% { transform: rotate(0); }
  50% { transform: rotate(-7deg); }
}

@keyframes fawkes-glance {
  0%, 100% { transform: translate(0,0); }
  50% { transform: translate(-0.7px, -1px); }
}

@keyframes fawkes-lean {
  0%, 100% {
    transform: translateX(0) rotate(0);
  }
  50% {
    transform: translateX(2px) rotate(4deg);
  }
}

@keyframes fawkes-hop {
  0%, 100% {
    transform: translateY(0) rotate(0);
  }
  35% {
    transform: translateY(-7px) rotate(-4deg);
  }
  65% {
    transform: translateY(0) rotate(0);
  }
}

@keyframes fawkes-wave {
  0%, 60%, 100% { transform: rotate(0); }
  30% { transform: rotate(-28deg); }
}

@keyframes fawkes-flap {
  0%, 100% { transform: rotate(0); }
  50% { transform: rotate(-38deg); }
}

@keyframes fawkes-shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-1.8px); }
  75% { transform: translateX(1.8px); }
}

@keyframes fawkes-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.58; }
}

@keyframes fawkes-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}

@keyframes fawkes-tail-trail {
  0%, 100% { transform: rotate(0); }
  50% { transform: rotate(9deg); }
}

@keyframes fawkes-doze {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.018); }
}

/* ---------- State animations ---------- */

/* IDLE */
.fawkes[data-animation="breathe"] .fawkes-figure {
  animation: fawkes-breathe 4s ease-in-out infinite;
}

.fawkes[data-animation="breathe"] .fawkes-eye {
  animation: fawkes-blink 5s infinite;
}

.fawkes[data-animation="breathe"] .fawkes-crest {
  animation: fawkes-ember 3s ease-in-out infinite;
}

/* WORKING */
.fawkes[data-animation="focus"] .fawkes-figure {
  animation: fawkes-bob 1.4s ease-in-out infinite;
}

.fawkes[data-animation="focus"] .fawkes-crest {
  animation: fawkes-flicker 0.7s ease-in-out infinite;
}

.fawkes[data-animation="focus"] .fawkes-eye {
  animation: fawkes-blink 4s infinite;
}

/* THINKING */
.fawkes[data-animation="think"] .fawkes-figure {
  animation: fawkes-tilt 2.4s ease-in-out infinite;
}

.fawkes[data-animation="think"] .fawkes-eye {
  animation: fawkes-glance 2.4s ease-in-out infinite;
}

/* LISTENING */
.fawkes[data-animation="listen"] .fawkes-figure {
  animation: fawkes-lean 1.6s ease-in-out infinite;
}

/* WAITING */
.fawkes[data-animation="attention"] .fawkes-figure {
  animation: fawkes-hop 1.25s ease-in-out infinite;
}

.fawkes[data-animation="attention"] .fawkes-wing {
  animation: fawkes-wave 1.25s ease-in-out infinite;
}

/* SUCCESS */
.fawkes[data-animation="celebrate"] .fawkes-figure {
  animation: fawkes-hop 0.9s ease-out 2;
}

.fawkes[data-animation="celebrate"] .fawkes-wing {
  animation: fawkes-flap 0.3s ease-in-out 6;
}

.fawkes[data-animation="celebrate"] .fawkes-crest {
  animation: fawkes-flicker 0.45s ease-in-out 4;
}

/* WARNING */
.fawkes[data-animation="caution"] .fawkes-figure {
  animation: fawkes-shake 0.5s ease-in-out 3;
}

.fawkes[data-animation="caution"] .fawkes-crest .crest-outer {
  fill: var(--fawkes-warning, #f08c00);
}

/* ERROR */
.fawkes[data-animation="alarm"] .fawkes-figure {
  animation: fawkes-shake 0.4s ease-in-out 3;
}

.fawkes[data-animation="alarm"] .fawkes-crest {
  animation: fawkes-pulse 1.6s ease-in-out 1.2s infinite;
}

.fawkes[data-animation="alarm"] .fawkes-crest .crest-outer {
  fill: var(--fawkes-danger, #e03131);
}

/* RECORDING */
.fawkes[data-animation="record"] .fawkes-crest {
  animation: fawkes-pulse 2s ease-in-out infinite;
}

/* DEPLOYING */
.fawkes[data-animation="fly"] .fawkes-figure {
  animation: fawkes-float 1.2s ease-in-out infinite;
}

.fawkes[data-animation="fly"] .fawkes-wing {
  animation: fawkes-flap 0.4s ease-in-out infinite;
}

.fawkes[data-animation="fly"] .fawkes-tail {
  animation: fawkes-tail-trail 1.2s ease-in-out infinite;
}

/* SLEEP */
.fawkes[data-animation="sleep"] .fawkes-figure {
  animation: fawkes-doze 6s ease-in-out infinite;
  opacity: 0.76;
}

.fawkes[data-animation="sleep"] .fawkes-eye {
  opacity: 0;
}

.fawkes[data-animation="sleep"] .fawkes-eyelid {
  opacity: 1;
}

.fawkes[data-animation="sleep"] .fawkes-crest {
  transform: scaleY(0.8);
}

/* OFFLINE */
.fawkes[data-animation="offline"] .fawkes-figure {
  filter: grayscale(1);
  opacity: 0.5;
}

/* ---------- Reduced motion ---------- */

.fawkes[data-reduced-motion="true"][data-animation="focus"] .fawkes-crest {
  transform: scaleY(1.1);
}

.fawkes[data-reduced-motion="true"][data-animation="think"] .fawkes-figure {
  transform: rotate(-7deg);
}

.fawkes[data-reduced-motion="true"][data-animation="think"] .fawkes-eye {
  transform: translate(-0.7px, -1px);
}

.fawkes[data-reduced-motion="true"][data-animation="listen"] .fawkes-figure {
  transform: translateX(2px) rotate(4deg);
}

.fawkes[data-reduced-motion="true"][data-animation="attention"] .fawkes-figure {
  transform: translateY(-3px);
}

.fawkes[data-reduced-motion="true"][data-animation="attention"] .fawkes-wing {
  transform: rotate(-28deg);
}

.fawkes[data-reduced-motion="true"][data-animation="celebrate"] .fawkes-wing {
  transform: rotate(-38deg);
}

.fawkes[data-reduced-motion="true"][data-animation="caution"] .fawkes-figure {
  transform: rotate(3deg);
}

.fawkes[data-reduced-motion="true"][data-animation="alarm"] .fawkes-crest {
  transform: scaleY(0.9);
}

.fawkes[data-reduced-motion="true"][data-animation="record"] .fawkes-crest {
  opacity: 0.8;
}

.fawkes[data-reduced-motion="true"][data-animation="fly"] .fawkes-figure {
  transform: translateY(-3px);
}

.fawkes[data-reduced-motion="true"][data-animation="fly"] .fawkes-wing {
  transform: rotate(-38deg);
}
`;

export const fawkes: FawkesAsset = {
  id: "fawkes",
  name: "Fawkes",
  license: "CC-BY-SA-4.0",
  author: "Phoenix contributors",
  svg,
  css,
  animations: ANIMATIONS,
};
