// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { ALL_DISPLAY_STATES, ANIMATIONS, STATE_VISUALS, visualFor } from "../src";

describe("state → visual mapping", () => {
  it("covers every display state with a known animation and a text label", () => {
    expect(Object.keys(STATE_VISUALS).sort()).toEqual([...ALL_DISPLAY_STATES].sort());
    for (const v of Object.values(STATE_VISUALS)) {
      expect(ANIMATIONS).toContain(v.animation);
      expect(v.label.length).toBeGreaterThan(0);
    }
  });

  it("gives each event-driven state a distinct animation", () => {
    const animations = Object.values(STATE_VISUALS).map((v) => v.animation);
    expect(new Set(animations).size).toBe(animations.length);
  });

  it("marks states needing attention as urgent", () => {
    expect(visualFor("ERROR").urgent).toBe(true);
    expect(visualFor("WAITING").urgent).toBe(true);
    expect(visualFor("IDLE").urgent).toBe(false);
  });

  it("falls back to IDLE for unknown states", () => {
    expect(visualFor("PARTYING")).toBe(STATE_VISUALS.IDLE);
  });
});
