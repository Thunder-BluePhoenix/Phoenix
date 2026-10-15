// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { ALL_DISPLAY_STATES, STATE_VISUALS } from "@phoenix/pet-states";
import type { SoundEvent } from "@phoenix/pet-assets";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mountFawkes,
  type EmoteEvent,
  type FawkesController,
  type InteractionTimers,
  type SoundPlayer,
} from "../src";

/** A manual clock: nothing fires until the test advances time. */
type FakeTimers = InteractionTimers & { advance(ms: number): void };

function fakeTimers(): FakeTimers {
  let now = 10_000;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    random: () => 0,
    setTimeout(fn, ms) {
      const id = nextId++;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(handle) {
      pending.delete(handle as number);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, t]) => t.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
  };
}

let container: HTMLElement;
let pet: FawkesController;
let timers: FakeTimers;
let emotes: EmoteEvent[];
let sounds: SoundEvent[];

const soundPlayer: SoundPlayer = {
  trigger: async (event) => {
    sounds.push(event);
    return "played";
  },
};

function mount(over: { greetOnMount?: boolean; reducedMotion?: boolean } = {}) {
  pet = mountFawkes(container, {
    size: 100,
    reducedMotion: over.reducedMotion ?? false,
    interactions: { timers, sounds: soundPlayer, greetOnMount: over.greetOnMount ?? false },
  });
  pet.on("emote", (e) => emotes.push(e));
}

const attr = (name: string) => pet.element.getAttribute(name);
const moveCursor = (x: number, y: number) =>
  document.dispatchEvent(
    new PointerEvent("pointermove", { clientX: x, clientY: y, bubbles: true }),
  );
const click = () => pet.element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const look = () => ({
  x: parseFloat(pet.element.style.getPropertyValue("--fawkes-look-x") || "0"),
  y: parseFloat(pet.element.style.getPropertyValue("--fawkes-look-y") || "0"),
});

beforeEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  timers = fakeTimers();
  emotes = [];
  sounds = [];
  pet?.element.isConnected;
});
afterEach(() => pet?.destroy());

describe("renderer: interactions are opt-in", () => {
  it("a plain mount has no emotes, no gaze, and unchanged behaviour", () => {
    pet = mountFawkes(container, { reducedMotion: false });
    click();
    document.dispatchEvent(new PointerEvent("pointermove", { clientX: 5, clientY: 5 }));
    expect(attr("data-emote")).toBeNull();
    expect(pet.element.style.getPropertyValue("--fawkes-look-x")).toBe("");
  });
});

describe("renderer: emotes", () => {
  it("greets on launch and clears the emote when it ends", () => {
    mount({ greetOnMount: true });
    expect(attr("data-emote")).toBe("greet");
    expect(attr("data-emote-variant")).toBe("wave");
    expect(sounds).toEqual(["launch"]);
    timers.advance(1_800);
    expect(attr("data-emote")).toBeNull();
    // The greeting starts during mount, before a listener can attach; its end is observable.
    expect(emotes.map((e) => `${e.phase}:${e.emote}`)).toEqual(["end:greet"]);
  });

  it("hovering blinks and grows the eyes", () => {
    mount();
    pet.element.dispatchEvent(new PointerEvent("pointerenter"));
    expect(attr("data-emote")).toBe("hover");
    timers.advance(1_200);
    expect(attr("data-emote")).toBeNull();
  });

  it("a click pokes; three clicks inside the window go dizzy then recover", () => {
    mount();
    click();
    expect(attr("data-emote")).toBe("poke");
    expect(sounds).toEqual(["poke"]);
    timers.advance(300);
    click();
    timers.advance(300);
    click();
    expect(attr("data-emote")).toBe("dizzy");
    timers.advance(2_400);
    expect(attr("data-emote")).toBe("recover");
    timers.advance(800);
    expect(attr("data-emote")).toBeNull();
    expect(sounds).toEqual(["poke", "poke", "dizzy", "recover"]);
  });

  it("two clicks do not make it dizzy", () => {
    mount();
    click();
    timers.advance(200);
    click();
    expect(attr("data-emote")).toBe("poke");
    expect(emotes.filter((e) => e.emote === "dizzy")).toEqual([]);
  });

  it("clicks outside the window do not make it dizzy", () => {
    mount();
    click();
    timers.advance(700);
    click();
    timers.advance(700);
    click();
    expect(emotes.filter((e) => e.emote === "dizzy")).toEqual([]);
  });

  it("still delivers the activate event on a click", () => {
    mount();
    let activated = 0;
    pet.on("activate", () => activated++);
    click();
    expect(activated).toBe(1);
  });
});

describe("renderer: completion jump needs a real event", () => {
  const success = (over: Record<string, unknown> = {}) => ({
    state: "SUCCESS",
    explanation: "claude finished",
    key: "agents:completed:s1",
    conditions: [
      {
        key: "agents:completed:s1",
        eventId: "evt-1",
        eventType: "agent.completed",
        updatedAt: timers.now(),
        ...over,
      },
    ],
  });

  it("jumps when the snapshot carries a fresh agent.completed event", () => {
    mount();
    pet.update(success());
    expect(attr("data-emote")).toBe("jump");
    expect(attr("data-state")).toBe("SUCCESS"); // the real state is shown unchanged
    expect(sounds).toEqual(["completion"]);
  });

  it("does not jump for SUCCESS without a completion event, a stale one, or another cause", () => {
    mount();
    pet.update({ state: "SUCCESS", explanation: "Done" });
    pet.update(success({ updatedAt: timers.now() - 60_000, eventId: "old" }));
    pet.update(success({ eventType: "build.passed", eventId: "build" }));
    expect(attr("data-emote")).toBeNull();
    expect(emotes).toEqual([]);
  });

  it("jumps once per event even if the snapshot is delivered again", () => {
    mount();
    pet.update(success());
    timers.advance(1_100);
    pet.update(success());
    expect(emotes.filter((e) => e.emote === "jump" && e.phase === "start")).toHaveLength(1);
  });
});

describe("renderer: interaction emotes are never agent states", () => {
  it("leaves data-state/data-animation/aria-label on the real state for every emote", () => {
    mount({ greetOnMount: true });
    const seen: string[] = [];
    pet.on("emote", () =>
      seen.push(`${attr("data-state")}|${attr("data-animation")}|${attr("aria-label")}`),
    );
    pet.update({ state: "WORKING", explanation: "Building" });
    click();
    timers.advance(300);
    click();
    timers.advance(300);
    click();
    timers.advance(5_000);
    for (const s of new Set(seen)) {
      expect(s).toBe(`WORKING|${STATE_VISUALS.WORKING.animation}|Fawkes — Working. Building`);
    }
    expect(seen.length).toBeGreaterThan(3);
    for (const state of ALL_DISPLAY_STATES) {
      pet.update({ state });
      expect(attr("data-state")).toBe(state);
      expect(attr("data-emote")).not.toBe(state);
    }
  });

  it("an urgent state ends any emote at once and blocks new ones", () => {
    mount({ greetOnMount: true });
    pet.update({ state: "ERROR", explanation: "Build failed" });
    expect(attr("data-emote")).toBeNull();
    click();
    pet.element.dispatchEvent(new PointerEvent("pointerenter"));
    expect(attr("data-emote")).toBeNull();
    expect(sounds).toEqual(["launch", "failure"]); // the failure cue is for the real error
  });

  it("announces nothing for emotes (the live region only follows real state)", () => {
    mount();
    pet.update({ state: "WORKING", explanation: "Building" });
    const live = pet.element.querySelector(".fawkes-sr")!;
    const before = live.textContent;
    click();
    expect(live.textContent).toBe(before);
  });
});

describe("renderer: gaze follows the cursor", () => {
  it("turns the eyes toward the cursor, smoothed, and clamped", () => {
    mount();
    moveCursor(100_000, 0);
    timers.advance(16);
    const first = look();
    expect(first.x).toBeGreaterThan(0);
    timers.advance(2_000);
    const far = look();
    expect(far.x).toBeGreaterThan(first.x);
    expect(far.x).toBeLessThanOrEqual(1.3);
    expect(Math.abs(far.y)).toBeLessThan(0.3);
    moveCursor(1e12, 1e12);
    timers.advance(2_000);
    expect(Math.hypot(look().x / 1.3, look().y / 1.1)).toBeLessThanOrEqual(1.0001);
  });

  it("stops following under reduced motion and shows the still pose", () => {
    mount();
    moveCursor(100_000, 0);
    timers.advance(2_000);
    expect(look().x).toBeGreaterThan(0);
    pet.setReducedMotion(true);
    expect(attr("data-reduced-motion")).toBe("true");
    expect(look()).toEqual({ x: 0, y: 0 });
    moveCursor(0, 100_000);
    timers.advance(2_000);
    expect(look()).toEqual({ x: 0, y: 0 });
  });

  it("under reduced motion emotes still mark the still pose (CSS holds it, nothing animates)", () => {
    mount({ reducedMotion: true });
    click();
    expect(attr("data-emote")).toBe("poke");
    expect(attr("data-reduced-motion")).toBe("true");
    expect(document.head.textContent).toMatch(
      /\[data-reduced-motion="true"\]\[data-emote="poke"\] \.fawkes-figure/,
    );
  });
});

describe("renderer: lifecycle", () => {
  it("leaves no listeners or timers behind after destroy", () => {
    mount({ greetOnMount: true });
    moveCursor(500, 0);
    pet.destroy();
    const before = emotes.length;
    timers.advance(10_000);
    moveCursor(900, 900);
    expect(emotes.length).toBe(before);
  });
});
