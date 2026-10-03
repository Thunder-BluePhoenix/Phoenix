// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ANIMATIONS } from "@phoenix/pet-states";
import { describe, expect, it } from "vitest";
import { fawkes } from "../src";

/** @keyframes name → { stop selector → declarations } */
function keyframes(css: string) {
  const out = new Map<string, { stop: string; decls: string }[]>();
  for (const m of css.matchAll(/@keyframes ([\w-]+) \{(.*?)\}\s*\}/gs)) {
    const stops = [...m[2]!.matchAll(/([\d%,\s]+)\{([^}]*)/g)].map((s) => ({
      stop: s[1]!.trim(),
      decls: s[2]!.trim(),
    }));
    out.set(m[1]!, stops);
  }
  return out;
}

/** Rules for one animation, minus `animation:` declarations: what stays when motion stops. */
function stillPose(name: string): string {
  const rules = [...fawkes.css.matchAll(/^(\.fawkes\[[^{]*\]) ([^{]*)\{([^}]*)\}/gm)].filter((r) =>
    r[1]!.includes(`[data-animation="${name}"]`),
  );
  return rules
    .map((r) => `${r[2]!.trim()}{${r[3]!.replace(/animation:[^;]*;/g, "").trim()}}`)
    .filter((r) => !r.endsWith("{}"))
    .sort()
    .join(" ");
}

describe("Fawkes asset", () => {
  it("is original artwork under the declared artwork licence", () => {
    expect(fawkes.license).toBe("CC-BY-SA-4.0");
    expect(fawkes.author).toBe("Phoenix contributors");
  });

  it("provides motion for every animation the runtime can request", () => {
    for (const name of ANIMATIONS) {
      expect(fawkes.css).toContain(`[data-animation="${name}"]`);
    }
    expect(fawkes.animations).toEqual(ANIMATIONS);
  });

  it("exposes the named parts animations rely on", () => {
    for (const part of [
      "fawkes-figure",
      "fawkes-body",
      "fawkes-belly",
      "fawkes-wing",
      "fawkes-crest",
      "fawkes-eye",
      "fawkes-eyelid",
      "fawkes-tail",
    ]) {
      expect(fawkes.svg).toContain(`class="${part}"`);
    }
    expect(fawkes.svg).toContain('aria-hidden="true"');
  });

  it("contains no scripts, external references or ids that could clash between instances", () => {
    expect(fawkes.svg).not.toMatch(/<script|href=|url\(|\sid=/i);
    expect(fawkes.css).not.toMatch(/url\(|@import/i);
  });
});

describe("animation budget", () => {
  const frames = keyframes(fawkes.css);

  it("animates only transform and opacity (compositor-only, cheap at idle)", () => {
    expect(frames.size).toBeGreaterThan(10);
    for (const [name, stops] of frames) {
      for (const { decls } of stops) {
        const props = decls
          .split(";")
          .map((d) => d.split(":")[0]!.trim())
          .filter(Boolean);
        expect(
          props.every((p) => p === "transform" || p === "opacity"),
          name,
        ).toBe(true);
      }
    }
  });

  it("every loop starts at the neutral pose, so any state can interrupt any other", () => {
    const identity =
      /^(transform: ((scale|scaleY)\(1\)|(rotate|skewX|translateX|translateY)\(0\)|translate\(0,0\)|\s)+|opacity: 1);?$/;
    for (const [name, stops] of frames) {
      const first = stops.find((s) =>
        s.stop
          .split(",")
          .map((x) => x.trim())
          .includes("0%"),
      )!;
      expect(first, name).toBeTruthy();
      expect(first.decls, name).toMatch(identity);
    }
  });

  it("idle runs at most three slow loops", () => {
    const idle = [
      ...fawkes.css.matchAll(/\[data-animation="breathe"\][^{]*\{ animation: [\w-]+ ([\d.]+)s/g),
    ];
    expect(idle.length).toBeLessThanOrEqual(3);
    expect(idle.every((m) => Number(m[1]) >= 3)).toBe(true);
  });
});

describe("reduced motion", () => {
  it("every state keeps a distinct still pose when animation is off", () => {
    const poses = new Map(ANIMATIONS.map((a) => [a, stillPose(a)]));
    // IDLE is the neutral pose; everything else must look different from it and from each other.
    expect(poses.get("breathe")).toBe("");
    const others = ANIMATIONS.filter((a) => a !== "breathe").map((a) => poses.get(a));
    expect(others.every(Boolean)).toBe(true);
    expect(new Set(others).size).toBe(others.length);
  });
});
