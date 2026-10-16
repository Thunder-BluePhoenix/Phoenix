// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { BUILTIN_OUTFITS, type OutfitPack } from "@phoenix/pet-assets";
import { ALL_DISPLAY_STATES } from "@phoenix/pet-states";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mountFawkes, type FawkesController } from "../src";

let container: HTMLElement;
let pet: FawkesController;
beforeEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(() => pet?.destroy());

const outfit = (id: string): OutfitPack => BUILTIN_OUTFITS.find((o) => o.id === id)!;
const layers = () => [...pet.element.querySelectorAll("[data-outfit-slot]")];
const animated = () => pet.element.querySelectorAll("[data-outfit-animation]");

describe("outfit rendering", () => {
  it("draws the layers over the Fawkes SVG and leaves the state contract alone", () => {
    pet = mountFawkes(container, { reducedMotion: false, actionHint: "Open Pet Panel" });
    pet.update({ state: "WORKING", explanation: "Building" });
    const before = {
      state: pet.element.getAttribute("data-state"),
      label: pet.element.getAttribute("aria-label"),
      anim: pet.element.getAttribute("data-animation"),
      live: pet.element.querySelector(".fawkes-sr")!.textContent,
    };
    pet.setOutfit(outfit("ember-scarf"));
    expect(layers().length).toBe(2);
    expect(pet.element.querySelectorAll(".fawkes-outfit").length).toBeGreaterThan(0);
    expect({
      state: pet.element.getAttribute("data-state"),
      label: pet.element.getAttribute("aria-label"),
      anim: pet.element.getAttribute("data-animation"),
      live: pet.element.querySelector(".fawkes-sr")!.textContent,
    }).toEqual(before);
    // The base artwork is untouched.
    expect(pet.element.querySelector(".fawkes-body")).not.toBeNull();
    pet.setOutfit(null);
    expect(layers()).toHaveLength(0);
  });

  it("never changes state, label or live region for any state, with or without an outfit", () => {
    pet = mountFawkes(container, { reducedMotion: false });
    for (const state of ALL_DISPLAY_STATES) {
      pet.setOutfit(null);
      pet.update({ state, explanation: "x" });
      const bare = pet.element.getAttribute("aria-label");
      pet.setOutfit(outfit("dusk-nightcap"));
      pet.update({ state, explanation: "x" });
      expect(pet.element.getAttribute("aria-label")).toBe(bare);
      expect(pet.element.getAttribute("data-state")).toBe(state);
    }
  });

  it("animates a layer when motion is allowed, with a built-in keyframe and no inline style", () => {
    pet = mountFawkes(container, { reducedMotion: false, outfit: outfit("hearth-lantern") });
    expect(animated().length).toBeGreaterThan(0);
    for (const el of animated()) {
      expect(el.getAttribute("data-outfit-animation")).toMatch(/^fawkes-[a-z-]+$/);
      expect(el.getAttribute("style")).toBeNull();
    }
    const css = document.getElementById("phoenix-fawkes-base")!.textContent!;
    expect(css).toContain('[data-outfit-animation="fawkes-pulse"]');
    expect(css).not.toMatch(/url\(|@import/);
  });

  it("under reduced motion renders only still variants and no animation attribute", () => {
    pet = mountFawkes(container, { reducedMotion: true, outfit: outfit("hearth-lantern") });
    expect(layers().length).toBeGreaterThan(0);
    expect(animated()).toHaveLength(0);
    expect(pet.element.querySelector("[data-outfit-motion='still']")).not.toBeNull();
    expect(pet.element.outerHTML).not.toMatch(/data-outfit-animation|animation:/);
  });

  it("switches to the still variant live when reduced motion is turned on, and back", () => {
    pet = mountFawkes(container, { reducedMotion: false, outfit: outfit("dusk-nightcap") });
    expect(animated().length).toBeGreaterThan(0);
    pet.setReducedMotion(true);
    expect(animated()).toHaveLength(0);
    pet.setReducedMotion(false);
    expect(animated().length).toBeGreaterThan(0);
  });

  it("draws the aura behind the character and everything else on the figure", () => {
    pet = mountFawkes(container, { reducedMotion: true, outfit: outfit("dusk-nightcap") });
    const svg = pet.element.querySelector("svg")!;
    expect(svg.firstElementChild!.classList.contains("fawkes-outfit")).toBe(true);
    expect(
      svg.querySelector(".fawkes-figure > .fawkes-outfit [data-outfit-slot='head']"),
    ).not.toBeNull();
  });

  it("draws every built-in outfit with the same number of elements in still and animated form", () => {
    pet = mountFawkes(container, { reducedMotion: true });
    for (const o of BUILTIN_OUTFITS) {
      pet.setReducedMotion(true);
      pet.setOutfit(o);
      expect(layers(), o.id).toHaveLength(o.layers.length);
      pet.setReducedMotion(false);
      expect(layers(), o.id).toHaveLength(o.layers.length);
    }
  });

  it("refuses a pack that bypassed the validator and draws nothing from it", () => {
    pet = mountFawkes(container, { reducedMotion: false });
    const hostile = {
      ...outfit("ember-scarf"),
      layers: [{ slot: "head", svg: "<g><script>alert(1)</script></g>" }],
    } as unknown as OutfitPack;
    pet.setOutfit(hostile);
    expect(layers()).toHaveLength(0);
    expect(pet.element.querySelector("script")).toBeNull();
    expect(pet.element.innerHTML).not.toContain("alert");
  });

  it("builds nodes with createElementNS: an attribute value can never become markup", () => {
    pet = mountFawkes(container, { reducedMotion: false });
    const odd = {
      ...outfit("ember-scarf"),
      layers: [{ slot: "head", svg: '<path d="M1 1 L2 2" onclick="x"/>' }],
    } as unknown as OutfitPack;
    pet.setOutfit(odd);
    expect(layers()).toHaveLength(0);
    expect(pet.element.querySelector("[onclick]")).toBeNull();
  });

  it("removes the old outfit when a new one is set", () => {
    pet = mountFawkes(container, { reducedMotion: true });
    pet.setOutfit(outfit("ember-scarf"));
    pet.setOutfit(outfit("cinder-crest"));
    expect(pet.element.querySelectorAll("[data-outfit='ember-scarf']")).toHaveLength(0);
    expect(pet.element.querySelectorAll("[data-outfit='cinder-crest']").length).toBeGreaterThan(0);
  });
});
