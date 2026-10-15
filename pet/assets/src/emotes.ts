// SPDX-License-Identifier: CC-BY-SA-4.0
// Copyright (C) 2026 Phoenix contributors
//
// Fawkes interaction emotes: original motion for the Fawkes v2 artwork.

/**
 * Motion for the transient interaction emotes (Phase 59). Selectors target
 * `.fawkes[data-emote="<name>"]`. The attribute is set by the runtime for a short, bounded time and
 * never replaces `data-state` / `data-animation`, so an emote can never be mistaken for an agent
 * state.
 *
 * Rules (enforced by test/emotes.test.ts):
 * - only `transform` and `opacity` are animated, every keyframe loop starts at the neutral pose;
 * - every emote has a distinct still pose under `data-reduced-motion="true"`, where all animation
 *   (including the cursor-following pupil) is off;
 * - the cursor-following gaze is a CSS-variable offset on the pupil, applied by the runtime only
 *   when motion is allowed.
 */
export const EMOTE_CSS = `
/* ---------- Gaze: the runtime sets --fawkes-look-x / --fawkes-look-y (user units) ---------- */

.fawkes-eye-pupil,
.fawkes-eye-glint {
  transform: translate(var(--fawkes-look-x, 0px), var(--fawkes-look-y, 0px));
}

.fawkes[data-reduced-motion="true"] .fawkes-eye-pupil,
.fawkes[data-reduced-motion="true"] .fawkes-eye-glint {
  transform: none;
}

/* ---------- Keyframes ---------- */

@keyframes fawkes-emote-wave {
  0%, 100% { transform: rotate(0); }
  50% { transform: rotate(-32deg); }
}

@keyframes fawkes-emote-hop {
  0%, 100% { transform: translateY(0); }
  45% { transform: translateY(-4px); }
}

@keyframes fawkes-emote-eye-grow {
  0% { transform: scale(1); }
  20% { transform: scale(1.2); }
  35% { transform: scale(1.2, 0.08); }
  50% { transform: scale(1.2); }
  100% { transform: scale(1.2); }
}

@keyframes fawkes-emote-squish {
  0% { transform: scale(1); }
  25% { transform: scale(1.12, 0.82); }
  60% { transform: scale(0.97, 1.05); }
  100% { transform: scale(1); }
}

@keyframes fawkes-emote-annoyed {
  0% { transform: scaleY(1); }
  20% { transform: scaleY(0.55); }
  80% { transform: scaleY(0.55); }
  100% { transform: scaleY(1); }
}

@keyframes fawkes-emote-wobble {
  0%, 100% { transform: rotate(0); }
  25% { transform: rotate(-9deg); }
  75% { transform: rotate(9deg); }
}

@keyframes fawkes-emote-spin {
  0% { transform: rotate(0); }
  100% { transform: rotate(360deg); }
}

@keyframes fawkes-emote-shake-off {
  0%, 100% { transform: rotate(0); }
  20% { transform: rotate(-5deg); }
  45% { transform: rotate(4deg); }
  70% { transform: rotate(-2deg); }
}

@keyframes fawkes-emote-crest-perk {
  0%, 100% { transform: scaleY(1); }
  40% { transform: scaleY(1.14); }
}

@keyframes fawkes-emote-jump {
  0%, 100% { transform: translateY(0) scale(1); }
  15% { transform: translateY(0) scale(1.08, 0.9); }
  45% { transform: translateY(-9px) scale(0.96, 1.06); }
  75% { transform: translateY(0) scale(1.06, 0.92); }
}

@keyframes fawkes-emote-flap {
  0%, 100% { transform: rotate(0); }
  30% { transform: rotate(-38deg); }
  60% { transform: rotate(-6deg); }
}

/* ---------- greet (launch) ---------- */

.fawkes[data-emote="greet"][data-emote-variant="wave"] .fawkes-wing {
  transform-origin: 75% 10%;
  animation: fawkes-emote-wave 0.6s ease-in-out 3;
}

.fawkes[data-emote="greet"][data-emote-variant="hop"] .fawkes-figure {
  animation: fawkes-emote-hop 0.6s ease-in-out 3;
}

/* ---------- hover: blink, eyes grow ---------- */

.fawkes[data-emote="hover"] .fawkes-eye {
  animation: fawkes-emote-eye-grow 1.2s ease-in-out 1 forwards;
}

/* ---------- poke (click): squish + annoyed ---------- */

.fawkes[data-emote="poke"] .fawkes-figure {
  transform-origin: 50% 100%;
  animation: fawkes-emote-squish 0.7s ease-out 1;
}

.fawkes[data-emote="poke"] .fawkes-eye {
  animation: fawkes-emote-annoyed 0.7s ease-in-out 1;
}

/* ---------- dizzy (three fast clicks) ---------- */

.fawkes[data-emote="dizzy"] .fawkes-figure {
  animation: fawkes-emote-wobble 0.6s ease-in-out 4;
}

.fawkes[data-emote="dizzy"] .fawkes-eye {
  animation: fawkes-emote-spin 0.8s linear 3;
}

/* ---------- recover (after dizzy) ---------- */

.fawkes[data-emote="recover"] .fawkes-figure {
  animation: fawkes-emote-shake-off 0.8s ease-out 1;
}

.fawkes[data-emote="recover"] .fawkes-crest {
  animation: fawkes-emote-crest-perk 0.8s ease-out 1;
}

/* ---------- jump (a real completion event) ---------- */

.fawkes[data-emote="jump"] .fawkes-figure {
  transform-origin: 50% 100%;
  animation: fawkes-emote-jump 1.1s ease-out 1;
}

.fawkes[data-emote="jump"] .fawkes-wing {
  transform-origin: 75% 10%;
  animation: fawkes-emote-flap 0.55s ease-in-out 2;
}

/* ---------- Reduced motion: still poses (no animation, distinct from each other) ---------- */

.fawkes[data-reduced-motion="true"][data-emote="greet"][data-emote-variant="wave"] .fawkes-wing {
  transform: rotate(-30deg);
}

.fawkes[data-reduced-motion="true"][data-emote="greet"][data-emote-variant="hop"] .fawkes-figure {
  transform: translateY(-2px);
}

.fawkes[data-reduced-motion="true"][data-emote="hover"] .fawkes-eye {
  transform: scale(1.2);
}

.fawkes[data-reduced-motion="true"][data-emote="poke"] .fawkes-figure {
  transform: scale(1.08, 0.88);
}

.fawkes[data-reduced-motion="true"][data-emote="poke"] .fawkes-eye {
  transform: scaleY(0.55);
}

.fawkes[data-reduced-motion="true"][data-emote="dizzy"] .fawkes-figure {
  transform: rotate(-10deg);
}

.fawkes[data-reduced-motion="true"][data-emote="dizzy"] .fawkes-eye {
  transform: rotate(45deg);
}

.fawkes[data-reduced-motion="true"][data-emote="recover"] .fawkes-crest {
  transform: scaleY(1.1);
}

.fawkes[data-reduced-motion="true"][data-emote="jump"] .fawkes-figure {
  transform: translateY(-4px);
}

.fawkes[data-reduced-motion="true"][data-emote="jump"] .fawkes-wing {
  transform: rotate(-38deg);
}
`;
