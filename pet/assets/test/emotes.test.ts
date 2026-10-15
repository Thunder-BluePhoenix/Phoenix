// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { INTERACTION_EMOTES } from "@phoenix/pet-states";
import { describe, expect, it } from "vitest";
import { EMOTE_CSS, fawkes } from "../src";

describe("emote artwork", () => {
  it("is wired into the Fawkes asset and has no external references", () => {
    expect(fawkes.emoteCss).toBe(EMOTE_CSS);
    expect(EMOTE_CSS).not.toMatch(/url\(|@import/i);
  });

  it("animates only transform and opacity", () => {
    for (const m of EMOTE_CSS.matchAll(/@keyframes ([\w-]+) \{(.*?)\n\}/gs)) {
      const props = [...m[2]!.matchAll(/([\w-]+):[^;]+;/g)].map((p) => p[1]);
      expect(props.length, m[1]).toBeGreaterThan(0);
      expect(
        props.every((p) => p === "transform" || p === "opacity"),
        m[1],
      ).toBe(true);
    }
  });

  it("every loop starts at the neutral pose", () => {
    for (const m of EMOTE_CSS.matchAll(/@keyframes ([\w-]+) \{\s*0%[^{]*\{ ([^}]*)\}/g)) {
      expect(m[2], m[1]).toMatch(
        /^transform: (rotate\(0\)|scale\(1\)|scaleY\(1\)|translateY\(0\)( scale\(1\))?)/,
      );
    }
  });

  it.each(INTERACTION_EMOTES)(
    "%s has motion and a distinct still pose under reduced motion",
    (emote) => {
      expect(EMOTE_CSS).toMatch(new RegExp(`\\[data-emote="${emote}"\\][^{]*\\{[^}]*animation:`));
      const still = [
        ...EMOTE_CSS.matchAll(
          new RegExp(
            `\\[data-reduced-motion="true"\\]\\[data-emote="${emote}"\\][^{]*\\{([^}]*)\\}`,
            "g",
          ),
        ),
      ].map((r) => r[1]!.trim());
      expect(still.length).toBeGreaterThan(0);
      expect(still.every((s) => !s.includes("animation"))).toBe(true);
    },
  );

  it("gaze is neutralised under reduced motion", () => {
    expect(EMOTE_CSS).toMatch(
      /\[data-reduced-motion="true"\] \.fawkes-eye-pupil[^{]*\{\s*transform: none/,
    );
  });
});
