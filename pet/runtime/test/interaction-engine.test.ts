// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ALL_DISPLAY_STATES, EMOTE_VISUALS, INTERACTION_EMOTES } from "@phoenix/pet-states";
import { describe, expect, it } from "vitest";
import {
  createInteractionEngine,
  DEFAULT_INTERACTION_CONFIG,
  gazeTarget,
  smoothGaze,
  type InteractionChange,
} from "../src";

function setup(rng = 0) {
  const clock = { now: 1_000 };
  const engine = createInteractionEngine({ now: () => clock.now, random: () => rng });
  const changes: InteractionChange[] = [];
  engine.subscribe((c) => changes.push(c));
  const advance = (ms: number) => {
    clock.now += ms;
    engine.step();
  };
  const started = () => changes.flatMap((c) => (c.kind === "emote-start" ? [c.active.emote] : []));
  return { engine, clock, advance, changes, started };
}

describe("launch greeting", () => {
  it("greets once on launch, bound to the launch event, then ends by itself", () => {
    const { engine, advance, started } = setup();
    expect(engine.launch()).toBe(true);
    expect(engine.active()).toMatchObject({
      emote: "greet",
      source: "app.launch",
      variant: "wave",
    });
    advance(EMOTE_VISUALS.greet.durationMs - 1);
    expect(engine.active()?.emote).toBe("greet");
    advance(1);
    expect(engine.active()).toBeNull();
    expect(started()).toEqual(["greet"]);
  });

  it("picks the greeting variant with the injected RNG", () => {
    expect(setup(0.99).engine.launch()).toBe(true);
    const hop = setup(0.99);
    hop.engine.launch();
    expect(hop.engine.active()?.variant).toBe("hop");
  });
});

describe("hover", () => {
  it("blinks/grows the eyes once, then respects a cooldown", () => {
    const { engine, advance, started } = setup();
    expect(engine.hover()).toBe(true);
    expect(engine.active()?.source).toBe("pointer.hover");
    advance(EMOTE_VISUALS.hover.durationMs);
    expect(engine.hover()).toBe(false); // still cooling down
    advance(DEFAULT_INTERACTION_CONFIG.hoverCooldownMs);
    expect(engine.hover()).toBe(true);
    expect(started()).toEqual(["hover", "hover"]);
  });
});

describe("poke and dizzy", () => {
  it("a single click squishes and looks annoyed", () => {
    const { engine } = setup();
    expect(engine.click()).toBe("poke");
    expect(engine.active()).toMatchObject({ emote: "poke", source: "pointer.click" });
  });

  it("three clicks inside the window make Fawkes dizzy, then it recovers", () => {
    const { engine, advance, started } = setup();
    expect(engine.click()).toBe("poke");
    advance(300);
    expect(engine.click()).toBe("poke");
    advance(300);
    expect(engine.click()).toBe("dizzy");
    expect(engine.active()?.source).toBe("pointer.click.burst");
    advance(EMOTE_VISUALS.dizzy.durationMs);
    expect(engine.active()).toMatchObject({ emote: "recover", source: "emote.dizzy.end" });
    advance(EMOTE_VISUALS.recover.durationMs);
    expect(engine.active()).toBeNull();
    expect(started()).toEqual(["poke", "poke", "dizzy", "recover"]);
  });

  it("two clicks, or three clicks spread outside the window, do not make it dizzy", () => {
    const { engine, advance, started } = setup();
    engine.click();
    advance(100);
    engine.click();
    expect(started()).toEqual(["poke", "poke"]);

    const slow = setup();
    const gap = DEFAULT_INTERACTION_CONFIG.clickWindowMs / 2 + 100;
    slow.engine.click();
    slow.advance(gap);
    slow.engine.click();
    slow.advance(gap); // first click is now outside the window
    slow.engine.click();
    expect(slow.started()).toEqual(["poke", "poke", "poke"]);
  });

  it("restarts the count after a dizzy burst", () => {
    const { engine, advance, started } = setup();
    for (let i = 0; i < 3; i++) {
      engine.click();
      advance(100);
    }
    advance(5_000);
    engine.click();
    expect(started().filter((e) => e === "dizzy")).toHaveLength(1);
    expect(started().at(-1)).toBe("poke");
  });

  it("a poke never interrupts a higher priority dizzy", () => {
    const { engine, advance } = setup();
    for (let i = 0; i < 3; i++) {
      engine.click();
      advance(50);
    }
    expect(engine.active()?.emote).toBe("dizzy");
    engine.hover();
    expect(engine.active()?.emote).toBe("dizzy");
  });
});

describe("completion jump", () => {
  it("jumps only for a real completion event, once per event id", () => {
    const { engine, started } = setup();
    expect(engine.completion("")).toBe(false);
    expect(started()).toEqual([]);
    expect(engine.completion("evt-1")).toBe(true);
    expect(engine.active()).toMatchObject({ emote: "jump", source: "event.completion" });
    expect(engine.completion("evt-1")).toBe(false);
  });
});

describe("real state always wins", () => {
  it.each(
    ALL_DISPLAY_STATES.filter((s) =>
      ["ERROR", "WAITING", "RECORDING", "SLEEPING", "OFFLINE"].includes(s),
    ),
  )("no emote starts while %s is shown", (state) => {
    const { engine, started } = setup();
    engine.setRealState(state);
    expect(engine.launch()).toBe(false);
    expect(engine.hover()).toBe(false);
    expect(engine.click()).toBeNull();
    expect(engine.completion("evt")).toBe(false);
    expect(started()).toEqual([]);
  });

  it("a running emote is cut short the moment an urgent state arrives", () => {
    const { engine, changes } = setup();
    engine.click();
    engine.setRealState("ERROR");
    expect(engine.active()).toBeNull();
    expect(changes.at(-1)).toMatchObject({ kind: "emote-end" });
  });

  it("an emote never outlasts its duration and every emote has a real source", () => {
    for (const emote of INTERACTION_EMOTES) {
      const { source, durationMs } = EMOTE_VISUALS[emote];
      expect(source).toMatch(/^(app|pointer|emote|event)\./);
      expect(durationMs).toBeLessThanOrEqual(3_000);
    }
  });
});

describe("cursor tracking", () => {
  it("clamps the gaze to the unit disc however far the cursor is", () => {
    for (const [dx, dy] of [
      [10_000, 0],
      [-5_000, 5_000],
      [0, -1e9],
    ] as const) {
      const g = gazeTarget(dx, dy);
      expect(Math.hypot(g.x, g.y)).toBeCloseTo(1, 6);
    }
    expect(gazeTarget(80, 0)).toEqual({ x: 0.5, y: 0 });
  });

  it("keeps the gaze centred inside the dead zone and for non-finite input", () => {
    expect(gazeTarget(2, -2)).toEqual({ x: 0, y: 0 });
    expect(gazeTarget(Number.NaN, 4)).toEqual({ x: 0, y: 0 });
    expect(gazeTarget(Number.POSITIVE_INFINITY, 0)).toEqual({ x: 0, y: 0 });
  });

  it("smooths toward the target instead of jumping, and settles exactly", () => {
    const target = { x: 1, y: 0 };
    const first = smoothGaze({ x: 0, y: 0 }, target, 16, 90);
    expect(first.x).toBeGreaterThan(0);
    expect(first.x).toBeLessThan(0.5);
    let g = first;
    for (let i = 0; i < 200; i++) g = smoothGaze(g, target, 16, 90);
    expect(g).toEqual(target);
  });

  it("moves the eyes over successive frames and returns to centre when the cursor leaves", () => {
    const { engine, advance } = setup();
    engine.setCursorOffset(500, 0);
    advance(16);
    const early = engine.gaze().x;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(1);
    for (let i = 0; i < 100; i++) advance(16);
    expect(engine.gaze()).toEqual({ x: 1, y: 0 });
    engine.clearCursor();
    for (let i = 0; i < 100; i++) advance(16);
    expect(engine.gaze()).toEqual({ x: 0, y: 0 });
  });

  it("holds a still pose under reduced motion: no gaze, ever", () => {
    const { engine, advance } = setup();
    engine.setCursorOffset(500, 0);
    for (let i = 0; i < 100; i++) advance(16);
    expect(engine.gaze().x).toBe(1);
    engine.setReducedMotion(true);
    expect(engine.gaze()).toEqual({ x: 0, y: 0 });
    engine.setCursorOffset(500, 500);
    for (let i = 0; i < 20; i++) advance(16);
    expect(engine.gaze()).toEqual({ x: 0, y: 0 });
  });

  it("does not follow the cursor while an urgent state is shown", () => {
    const { engine, advance } = setup();
    engine.setRealState("WAITING");
    engine.setCursorOffset(500, 0);
    for (let i = 0; i < 20; i++) advance(16);
    expect(engine.gaze()).toEqual({ x: 0, y: 0 });
  });
});
