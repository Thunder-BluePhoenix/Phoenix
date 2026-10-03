// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ANIMATIONS } from "@phoenix/pet-states";
import { describe, expect, it } from "vitest";
import { placeholderFawkes } from "../src";

describe("placeholder Fawkes asset", () => {
  it("declares an artwork licence and author", () => {
    expect(placeholderFawkes.license).toBe("CC-BY-SA-4.0");
    expect(placeholderFawkes.author).toBeTruthy();
  });

  it("provides CSS for every animation the runtime can request", () => {
    for (const name of ANIMATIONS) {
      expect(placeholderFawkes.css).toContain(`[data-animation="${name}"]`);
    }
  });

  it("exposes the named parts animations rely on", () => {
    for (const part of [
      "fawkes-figure",
      "fawkes-body",
      "fawkes-wing",
      "fawkes-crest",
      "fawkes-eye",
      "fawkes-tail",
    ]) {
      expect(placeholderFawkes.svg).toContain(`class="${part}"`);
    }
    expect(placeholderFawkes.svg).toContain('aria-hidden="true"');
  });

  it("contains no scripts or external references", () => {
    expect(placeholderFawkes.svg).not.toMatch(/<script|href=|url\(/i);
    expect(placeholderFawkes.css).not.toMatch(/url\(|@import/i);
  });
});
