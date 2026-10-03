// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { ALL_DISPLAY_STATES, STATE_VISUALS } from "@phoenix/pet-states";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mountFawkes, type DragEvent, type FawkesController } from "../src";

let container: HTMLElement;
let pet: FawkesController;

beforeEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(() => pet?.destroy());

const attr = (name: string) => pet.element.getAttribute(name);
const live = () => pet.element.querySelector(".fawkes-sr")!;
const rec = () => pet.element.querySelector<HTMLElement>(".fawkes-rec")!;

function pointer(type: string, x: number, y: number) {
  pet.element.dispatchEvent(
    new PointerEvent(type, { clientX: x, clientY: y, button: 0, pointerId: 1, bubbles: true }),
  );
}

describe("rendering", () => {
  it("mounts an accessible button starting in IDLE", () => {
    pet = mountFawkes(container, { actionHint: "Open Pet Panel" });
    expect(pet.element.tagName).toBe("BUTTON");
    expect(attr("type")).toBe("button");
    expect(attr("data-state")).toBe("IDLE");
    expect(attr("aria-label")).toBe("Fawkes — Idle. Open Pet Panel");
    expect(pet.element.querySelector("svg")).not.toBeNull();
  });

  it.each(ALL_DISPLAY_STATES)("renders %s with its animation, tone and text", (state) => {
    pet = mountFawkes(container);
    pet.update({ state, explanation: "Something specific" });
    const v = STATE_VISUALS[state];
    expect(attr("data-animation")).toBe(v.animation);
    expect(attr("data-tone")).toBe(v.tone);
    expect(attr("aria-label")).toBe(`Fawkes — ${v.label}. Something specific`);
    expect(pet.element.title).toBe(`Fawkes — ${v.label}. Something specific`);
  });

  it("falls back gracefully for unknown states", () => {
    pet = mountFawkes(container);
    pet.update({ state: "MYSTERY" });
    expect(attr("data-animation")).toBe("breathe");
  });

  it("applies the requested size", () => {
    pet = mountFawkes(container, { size: 96 });
    expect(pet.element.style.getPropertyValue("--fawkes-size")).toBe("96px");
  });

  it("injects styles once per document", () => {
    pet = mountFawkes(container);
    const second = mountFawkes(container);
    expect(document.querySelectorAll("#phoenix-fawkes-base")).toHaveLength(1);
    expect(document.querySelectorAll("style")).toHaveLength(2);
    second.destroy();
  });
});

describe("recording indicator", () => {
  it("stays visible and named even when a higher-priority state is shown", () => {
    pet = mountFawkes(container);
    pet.update({ state: "RECORDING", explanation: "Recording meeting", recording: true });
    expect(rec().hidden).toBe(false);
    pet.update({ state: "ERROR", explanation: "Build failed", recording: true });
    expect(rec().hidden).toBe(false);
    expect(attr("aria-label")).toBe("Fawkes — Error. Build failed. Recording active");
    pet.update({ state: "IDLE", recording: false });
    expect(rec().hidden).toBe(true);
  });
});

describe("announcements", () => {
  it("announces urgent states assertively and others politely", () => {
    pet = mountFawkes(container);
    pet.update({ state: "WORKING", explanation: "Build running" });
    expect(live().getAttribute("aria-live")).toBe("polite");
    expect(live().textContent).toBe("Fawkes — Working. Build running");
    pet.update({ state: "ERROR", explanation: "Build failed" });
    expect(live().getAttribute("aria-live")).toBe("assertive");
  });

  it("does not re-announce identical updates", () => {
    pet = mountFawkes(container);
    pet.update({ state: "WORKING", explanation: "A" });
    live().textContent = "sentinel";
    pet.update({ state: "WORKING", explanation: "A" });
    expect(live().textContent).toBe("sentinel");
  });
});

describe("motion", () => {
  it("honours forced reduced motion and can be toggled", () => {
    pet = mountFawkes(container, { reducedMotion: true });
    expect(attr("data-reduced-motion")).toBe("true");
    pet.setReducedMotion(false);
    expect(attr("data-reduced-motion")).toBe("false");
  });

  it("follows prefers-reduced-motion in auto mode", () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q.includes("reduce"),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    try {
      pet = mountFawkes(container);
      expect(attr("data-reduced-motion")).toBe("true");
    } finally {
      window.matchMedia = original;
    }
  });

  it("pauses animations while the page is hidden", () => {
    pet = mountFawkes(container);
    expect(attr("data-paused")).toBe("false");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(attr("data-paused")).toBe("true");
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(attr("data-paused")).toBe("false");
  });
});

describe("interaction", () => {
  it("emits activate on click", () => {
    pet = mountFawkes(container);
    let n = 0;
    pet.on("activate", () => n++);
    pet.element.click();
    expect(n).toBe(1);
  });

  it("drag emits deltas and suppresses the following click", () => {
    pet = mountFawkes(container, { draggable: true });
    const drags: DragEvent[] = [];
    let clicks = 0;
    pet.on("drag", (d) => void drags.push(d));
    pet.on("activate", () => clicks++);
    pointer("pointerdown", 10, 10);
    pointer("pointermove", 11, 10); // below threshold
    pointer("pointermove", 20, 15);
    pointer("pointermove", 25, 15);
    pointer("pointerup", 25, 15);
    pet.element.click();
    expect(drags).toEqual([
      { phase: "start", dx: 0, dy: 0 },
      { phase: "move", dx: 10, dy: 5 },
      { phase: "move", dx: 5, dy: 0 },
      { phase: "end", dx: 0, dy: 0 },
    ]);
    expect(clicks).toBe(0);
    pet.element.click();
    expect(clicks).toBe(1);
  });

  it("a tiny wobble is still a click", () => {
    pet = mountFawkes(container, { draggable: true });
    let clicks = 0;
    pet.on("activate", () => clicks++);
    pointer("pointerdown", 10, 10);
    pointer("pointermove", 12, 11);
    pointer("pointerup", 12, 11);
    pet.element.click();
    expect(clicks).toBe(1);
  });

  it("isolates faulty listeners and supports unsubscribe", () => {
    pet = mountFawkes(container);
    let n = 0;
    pet.on("activate", () => {
      throw new Error("bad");
    });
    const off = pet.on("activate", () => n++);
    pet.element.click();
    off();
    pet.element.click();
    expect(n).toBe(1);
  });

  it("destroy removes the element and listeners", () => {
    pet = mountFawkes(container);
    let n = 0;
    pet.on("activate", () => n++);
    const el = pet.element;
    pet.destroy();
    el.click();
    expect(container.contains(el)).toBe(false);
    expect(n).toBe(0);
  });
});
