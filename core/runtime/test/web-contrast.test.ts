// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// WCAG 2.x contrast for the colours the web app's stylesheets define (apps/web). This does not
// render anything: it reads the theme variables and checks the pairs that actually meet each other
// on screen, so a colour tweak that drops below the minimum fails here instead of in a user's
// eyes. Lives with the Node-typed tests because it reads the CSS files straight from disk.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** `--name: #hex` pairs declared in the block that starts at `open` and ends at its closing brace. */
function variables(css: string, open: RegExp): Record<string, string> {
  const start = css.search(open);
  expect(start, `${open} not found`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  let end = start;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  const out: Record<string, string> = {};
  for (const m of css.slice(start, end).matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) {
    out[m[1]!] = m[2]!;
  }
  return out;
}

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const web = (file: string) =>
  readFileSync(new URL(`../../../apps/web/src/${file}`, import.meta.url), "utf8");
const main = web("styles.css");
const floating = web("floating/floating.css");

const themes = {
  light: variables(main, /:root\s*\{/),
  dark: {
    ...variables(main, /:root\s*\{/),
    ...variables(main, /@media \(prefers-color-scheme: dark\)\s*\{/),
  },
};
const floatingThemes = {
  light: variables(floating, /:root\s*\{/),
  dark: {
    ...variables(floating, /:root\s*\{/),
    ...variables(floating, /@media \(prefers-color-scheme: dark\)\s*\{/),
  },
};

describe.each(["light", "dark"] as const)("%s theme", (name) => {
  const t = themes[name];

  it("text colours meet 4.5:1 on the page and on cards", () => {
    for (const color of [
      "--text",
      "--muted",
      "--danger-text",
      "--warning-text",
      "--success-text",
      "--info-text",
      "--accent-text",
    ]) {
      for (const surface of ["--bg", "--surface"]) {
        const ratio = contrast(t[color]!, t[surface]!);
        expect(ratio, `${color} ${t[color]} on ${surface} ${t[surface]}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
  });

  it("white text on a filled primary button meets 4.5:1", () => {
    expect(
      contrast("#ffffff", t["--accent-fill"]!),
      `--accent-fill ${t["--accent-fill"]}`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("colours used only for borders, dots and rings meet 3:1 on the page", () => {
    for (const color of ["--danger", "--warning", "--success", "--info", "--accent"]) {
      expect(contrast(t[color]!, t["--bg"]!), `${color} ${t[color]}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("the floating recording pill's text meets 4.5:1 on its bubble", () => {
    const f = floatingThemes[name];
    expect(contrast(f["--danger-text"]!, f["--bubble-bg"]!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("semantic colours are not used raw for text", () => {
  // A `color: var(--danger)` would bypass the AA-safe variants above and pass the tests unnoticed.
  it.each([
    ["styles.css", main],
    ["floating/floating.css", floating],
  ])("%s", (_file, css) => {
    const raw = [...css.matchAll(/^\s+color:\s*var\(--(danger|warning|success|info|accent)[,)]/gm)];
    expect(raw.map((m) => m[0].trim())).toEqual([]);
  });
});
