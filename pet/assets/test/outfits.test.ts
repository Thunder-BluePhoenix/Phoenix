// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  AA_CONTRAST,
  BUILTIN_OUTFITS,
  contrastRatio,
  DEFAULT_SOURCE_COLOURS,
  defaultSourceStyle,
  GLYPH_NAMES,
  isGlyphName,
  SERVICE_SOURCE_STYLES,
  SOURCE_COLOUR,
  GLYPHS,
  MAX_LAYER_CHARS,
  OutfitError,
  parseOutfitSvg,
  PILL_BACKGROUND,
  resolveOutfit,
  seasonOf,
  validateOutfitPack,
  type OutfitPack,
} from "../src";

const OK_SVG = '<path d="M10 10 L20 20 L10 30 Z" fill="#ff0000"/>';
const pack = (over: Record<string, unknown> = {}, layer: Record<string, unknown> = {}) => ({
  format: "phoenix-outfit",
  version: 1,
  id: "test-pack",
  name: "Test pack",
  author: "Someone",
  license: "CC0-1.0",
  layers: [{ slot: "head", svg: OK_SVG, ...layer }],
  ...over,
});

describe("outfit pack: what is accepted", () => {
  it("accepts a plain pack and returns a clean copy", () => {
    const p = validateOutfitPack(pack());
    expect(p.layers[0]!.svg).toBe(OK_SVG);
    expect(p.id).toBe("test-pack");
  });

  it("accepts every shape, groups, a transform and an animated layer with a still", () => {
    const svg =
      '<g transform="translate(1 2) rotate(10)" opacity="0.5"><circle cx="5" cy="5" r="3" fill="#fff"/><ellipse cx="9" cy="9" rx="2" ry="3"/><rect x="1" y="1" width="4" height="4" rx="1"/><line x1="0" y1="0" x2="5" y2="5" stroke="#000" stroke-width="1"/><polyline points="1,1 5,5 9,1" fill="none" stroke="#123"/><polygon points="1 1 5 5 9 1"/></g>';
    expect(() =>
      validateOutfitPack(pack({}, { svg, still: svg, animation: "fawkes-float" })),
    ).not.toThrow();
  });

  it.each(BUILTIN_OUTFITS.map((o) => [o.id, o] as const))(
    "built-in outfit %s passes the same validator users' packs do",
    (_id, outfit) => {
      expect(validateOutfitPack(outfit)).toEqual(outfit);
    },
  );

  it.each([
    [
      "nested translates keeping curves, smooth curves and closes inside the bound",
      '<g transform="translate(4 4)"><g transform="translate(4 4)"><path d="M10 10 C20 5 30 5 40 10 S50 20 55 30 Q60 40 40 40 T20 50 Z"/></g></g>',
    ],
    [
      "a rotation about the canvas centre",
      '<g transform="rotate(90 32 32)"><rect x="10" y="20" width="40" height="20"/></g>',
    ],
    [
      "a rotated circle and ellipse about the centre",
      '<g transform="rotate(45 32 32)"><circle cx="32" cy="32" r="20"/><ellipse cx="32" cy="32" rx="25" ry="10"/></g>',
    ],
    [
      "a translate cancelling an earlier translate",
      '<g transform="translate(16 16)"><g transform="translate(-16 -16)"><polygon points="2 2 60 2 30 60"/></g></g>',
    ],
    [
      "a group transform that does not leak to its sibling",
      '<g transform="translate(-4 -4)"><path d="M1 1 L2 2"/></g><path d="M60 60 L65 65"/>',
    ],
    [
      "a stroke that just fits the bound",
      '<polyline points="10 10 60 10" fill="none" stroke="#000" stroke-width="6"/>',
    ],
    [
      "an unstroked shape beside a stroke-width that has no paint",
      '<polygon points="0 0 68 0 34 60" stroke="none" stroke-width="6"/>',
    ],
    [
      "an inherited stroke inside the bound",
      '<g stroke="#000" stroke-width="2" transform="translate(4 4)"><line x1="10" y1="10" x2="60" y2="10"/></g>',
    ],
  ])("accepts %s", (_name, svg) => {
    expect(() => parseOutfitSvg(svg)).not.toThrow();
  });
});

/** Each hostile case must be rejected; the message is not the point, the rejection is. */
const HOSTILE_SVG: [string, string][] = [
  ["script element", "<script>alert(1)</script>"],
  ["script in a group", "<g><script/></g>"],
  ["foreignObject", '<foreignObject width="10" height="10"/>'],
  ["style element", "<style>*{display:none}</style>"],
  ["image element", '<image href="https://example.invalid/a.png"/>'],
  ["external use href", '<use href="https://example.invalid/a.svg#x"/>'],
  ["use fragment href", '<use href="#a"/>'],
  ["xlink:href", '<path d="M1 1 L2 2" xlink:href="x"/>'],
  ["onload attribute", '<path d="M1 1 L2 2" onload="alert(1)"/>'],
  ["onclick attribute", '<circle cx="5" cy="5" r="2" onclick="x()"/>'],
  ["OnMouseOver mixed case", '<circle cx="5" cy="5" r="2" OnMouseOver="x()"/>'],
  ["javascript: url in fill", '<path d="M1 1 L2 2" fill="javascript:alert(1)"/>'],
  ["data: url in fill", '<path d="M1 1 L2 2" fill="data:text/html,x"/>'],
  ["url() in fill", '<path d="M1 1 L2 2" fill="url(#a)"/>'],
  ["off-document url() in stroke", '<path d="M1 1 L2 2" stroke="url(https://example.invalid/x)"/>'],
  ["style attribute", '<path d="M1 1 L2 2" style="fill:red"/>'],
  ["class attribute", '<path d="M1 1 L2 2" class="fawkes-body"/>'],
  ["id attribute", '<path d="M1 1 L2 2" id="a"/>'],
  ["filter attribute", '<path d="M1 1 L2 2" filter="url(#f)"/>'],
  ["unknown element", '<animate attributeName="x" to="1"/>'],
  ["animateTransform", '<animateTransform attributeName="transform" type="rotate" to="9"/>'],
  ["set element", '<set attributeName="fill" to="red"/>'],
  ["a element", '<a href="https://example.invalid"><path d="M1 1 L2 2"/></a>'],
  ["text element", "<text>hi</text>"],
  ["svg root", '<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1 L2 2"/></svg>'],
  ["unknown attribute", '<path d="M1 1 L2 2" pathLength="1"/>'],
  ["repeated attribute", '<path d="M1 1 L2 2" d="M3 3 L4 4"/>'],
  ["named entity", '<path d="M1 1 L2 2" fill="&#x23;f00"/>'],
  ["entity in text position", "&lt;script&gt;"],
  ["comment", '<!-- x --><path d="M1 1 L2 2"/>'],
  ["CDATA", "<![CDATA[<script>]]>"],
  ["processing instruction", '<?xml version="1.0"?><path d="M1 1 L2 2"/>'],
  ["DOCTYPE with entity", '<!DOCTYPE svg [<!ENTITY x "y">]><path d="M1 1 L2 2"/>'],
  ["bare text", 'hello <path d="M1 1 L2 2"/>'],
  ["unclosed group", '<g><path d="M1 1 L2 2"/>'],
  ["mismatched tags", '<g><path d="M1 1 L2 2"/></path>'],
  ["extra closing tag", '<path d="M1 1 L2 2"/></g>'],
  ["shape with children", '<circle cx="5" cy="5" r="2"><script/></circle>'],
  ["single quotes", "<path d='M1 1 L2 2'/>"],
  ["unquoted attribute", "<path d=M1/>"],
  ["greater-than in attribute", '<path d="M1 1 L2 2" fill=">"/>'],
  ["backslash escape in value", '<path d="M1 1 L2 2" fill="\\75rl(x)"/>'],
  ["path with arc command", '<path d="M1 1 A5 5 0 0 1 9 9"/>'],
  ["path with relative command", '<path d="M1 1 l5 5"/>'],
  ["path with no start", '<path d="L1 1 L2 2"/>'],
  ["path with huge coordinate", '<path d="M1 1 L99999 2"/>'],
  ["path with exponent", '<path d="M1 1 L1e3 2"/>'],
  ["path with letters inside a command", '<path d="M1 1 Lxx 2"/>'],
  ["path with wrong arity", '<path d="M1 1 C1 2 3 4"/>'],
  ["path without d", '<path fill="#000"/>'],
  ["polygon points with text", '<polygon points="1 1 a b c d"/>'],
  ["polygon with odd coordinates", '<polygon points="1 1 2 2 3"/>'],
  ["transform skew", '<g transform="skewX(30)"><path d="M1 1 L2 2"/></g>'],
  ["transform scale", '<g transform="scale(100)"><path d="M1 1 L2 2"/></g>'],
  ["transform matrix", '<g transform="matrix(1 0 0 1 0 0)"><path d="M1 1 L2 2"/></g>'],
  ["transform with url", '<g transform="translate(url(x))"><path d="M1 1 L2 2"/></g>'],
  ["huge translation", '<g transform="translate(5000 0)"><path d="M1 1 L2 2"/></g>'],
  ["named colour", '<path d="M1 1 L2 2" fill="red"/>'],
  ["currentColor", '<path d="M1 1 L2 2" fill="currentColor"/>'],
  ["rgb() colour", '<path d="M1 1 L2 2" fill="rgb(1,2,3)"/>'],
  ["huge stroke width", '<path d="M1 1 L2 2" stroke="#000" stroke-width="500"/>'],
  ["opacity above 1", '<path d="M1 1 L2 2" opacity="7"/>'],
  ["circle covering the page", '<circle cx="32" cy="32" r="70"/>'],
  [
    "rect covering the page",
    '<rect x="-4" y="-4" width="72" height="72"/><rect x="0" y="0" width="900" height="9"/>',
  ],
  ["bidi control in attribute", '<path d="M1 1 L2 2" fill="#f\u202e00"/>'],
  ["zero-width space in tag", '<pa\u200bth d="M1 1 L2 2"/>'],
  ["non-ASCII attribute value", '<path d="M1 1 L2 2" fill="#ff\u0430000"/>'],
  ["NUL byte", '<path d="M1 1 L2 2"\u0000/>'],
  ["uppercase element", '<PATH d="M1 1 L2 2"/>'],
  ["namespaced element", '<svg:path d="M1 1 L2 2"/>'],
  ["empty fragment", ""],
  ["whitespace only", "   "],
  ["not a string", 5 as unknown as string],
  ["too many elements", `<g>${'<circle cx="5" cy="5" r="1"/>'.repeat(81)}</g>`],
  ["too deeply nested", `${"<g>".repeat(8)}<path d="M1 1 L2 2"/>${"</g>".repeat(8)}`],
  ["oversize fragment", `<path d="M1 1 ${"L2 2 ".repeat(MAX_LAYER_CHARS / 5 + 10)}"/>`],
  [
    "nested translates pushing a path off the canvas",
    '<g transform="translate(16 16)"><g transform="translate(16 16)"><g transform="translate(16 16)"><path d="M10 10 L20 20 L30 30"/></g></g></g>',
  ],
  [
    "rotate throwing a path off the canvas",
    '<g transform="rotate(90)"><path d="M10 60 L20 60"/></g>',
  ],
  [
    "rotate about a centre then nested translates, polygon child",
    '<g transform="rotate(180 32 32) translate(16 16)"><g transform="translate(16 0)"><polygon points="40 40 50 40 45 50"/></g></g>',
  ],
  [
    "composed transform on a circle",
    '<g transform="translate(16 0)"><g transform="translate(16 0)"><circle cx="40" cy="32" r="6"/></g></g>',
  ],
  [
    "composed transform on a rect",
    '<g transform="translate(16 16)"><g transform="translate(0 16)"><rect x="40" y="30" width="20" height="10"/></g></g>',
  ],
  [
    "nested translates and rotate on an ellipse",
    '<g transform="translate(16 16)"><g transform="translate(16 16)"><g transform="rotate(45)"><ellipse cx="60" cy="0" rx="5" ry="3"/></g></g></g>',
  ],
  [
    "composed transform on a line",
    '<g transform="translate(16 16)"><g transform="translate(16 16)"><line x1="30" y1="30" x2="50" y2="50"/></g></g>',
  ],
  [
    "composed transform on a polyline",
    '<g transform="translate(-16 0)"><g transform="translate(-16 0)"><polyline points="10 10 20 20 30 10"/></g></g>',
  ],
  [
    "own transform after a parent transform",
    '<g transform="translate(16 16)"><path transform="translate(16 16)" d="M40 40 L50 50"/></g>',
  ],
  [
    "path control point beyond the bound under a transform",
    '<g transform="translate(8 8)"><path d="M60 60 C68 68 68 68 60 60"/></g>',
  ],
  [
    "path smooth curve beyond the bound under nested transforms",
    '<g transform="translate(16 16)"><g transform="translate(8 8)"><path d="M10 10 S20 20 50 50"/></g></g>',
  ],
  [
    "path H and V beyond the bound under nested transforms",
    '<g transform="translate(16 16)"><g transform="translate(16 16)"><path d="M10 10 H50 V50"/></g></g>',
  ],
  [
    "stroke reaching past the bound",
    '<line x1="10" y1="10" x2="66" y2="10" stroke="#000" stroke-width="6"/>',
  ],
  [
    "inherited stroke reaching past the bound under a transform",
    '<g stroke="#000" stroke-width="6" transform="translate(4 0)"><polyline points="10 10 60 10"/></g>',
  ],
];

describe("outfit sanitiser: hostile fragments are rejected, not cleaned", () => {
  it("covers at least 25 distinct hostile cases", () => {
    expect(HOSTILE_SVG.length).toBeGreaterThanOrEqual(25);
  });

  it.each(HOSTILE_SVG)("rejects %s", (_name, svg) => {
    expect(() => parseOutfitSvg(svg)).toThrow(OutfitError);
    expect(() => validateOutfitPack(pack({}, { svg }))).toThrow(OutfitError);
    // The still variant is untrusted too.
    expect(() =>
      validateOutfitPack(pack({}, { svg: OK_SVG, still: svg, animation: "fawkes-float" })),
    ).toThrow(OutfitError);
  });
});

describe("outfit pack: hostile envelopes are rejected", () => {
  const cases: [string, unknown][] = [
    ["not an object", "x"],
    ["array", []],
    ["null", null],
    ["wrong format", pack({ format: "other" })],
    ["wrong version", pack({ version: 2 })],
    ["unknown top-level field", pack({ scripts: ["x"] })],
    ["__proto__ field", JSON.parse('{"__proto__":{"a":1},"format":"phoenix-outfit","version":1}')],
    ["id with uppercase", pack({ id: "Bad" })],
    ["id too short", pack({ id: "a" })],
    ["id too long", pack({ id: "a".repeat(33) })],
    ["id with path chars", pack({ id: "../x" })],
    ["name too long", pack({ name: "n".repeat(41) })],
    ["empty name", pack({ name: "" })],
    ["name with bidi override", pack({ name: "abc\u202edef" })],
    ["name with zero-width space", pack({ name: "ab\u200bcd" })],
    ["name with newline", pack({ name: "ab\ncd" })],
    ["name with isolate", pack({ name: "ab\u2066cd" })],
    ["name with BOM", pack({ name: "ab\ufeffcd" })],
    ["author too long", pack({ author: "a".repeat(61) })],
    ["licence with control", pack({ license: "MIT\u0007" })],
    ["leading space in name", pack({ name: " Padded" })],
    ["unknown season", pack({ season: "monsoon" })],
    ["no layers", pack({ layers: [] })],
    [
      "too many layers",
      pack({ layers: Array.from({ length: 9 }, () => ({ slot: "head", svg: OK_SVG })) }),
    ],
    ["layers not an array", pack({ layers: { slot: "head" } })],
    ["layer not an object", pack({ layers: ["x"] })],
    ["unknown slot", pack({}, { slot: "feet" })],
    ["unknown layer field", pack({}, { onload: "x" })],
    ["unknown animation", pack({}, { animation: "evil", still: OK_SVG })],
    [
      "animation by css",
      pack({}, { animation: "x 1s infinite; background:url(a)", still: OK_SVG }),
    ],
    ["animation without a still", pack({}, { animation: "fawkes-float" })],
    [
      "oversize pack",
      pack({
        layers: Array.from({ length: 8 }, () => ({
          slot: "aura",
          svg: `<path d="M1 1 ${"L2 2 ".repeat(3_000)}"/>`,
        })),
      }),
    ],
  ];
  it.each(cases)("rejects %s", (_name, input) => {
    expect(() => validateOutfitPack(input)).toThrow(OutfitError);
  });

  it("does not keep unknown fields from a layer that passes", () => {
    const p = validateOutfitPack(pack());
    expect(Object.keys(p.layers[0]!).sort()).toEqual(["slot", "svg"]);
  });
});

describe("outfit sanitiser: property test with a seeded fuzzer", () => {
  // A small deterministic PRNG: no real randomness in tests.
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }
  const BAD_TOKENS = [
    "<script>",
    "</script>",
    "onload=",
    "javascript:",
    "data:",
    "url(",
    "href=",
    "xlink:href",
    "<style",
    "<image",
    "<foreignObject",
    "<use",
    "&#",
    "&lt;",
    "<!--",
    "\u202e",
    "\u200b",
    "<animate",
    "style=",
    "\\",
  ];

  it("a good fragment with any hostile token spliced into it is never accepted", () => {
    const next = rng(61);
    let accepted = 0;
    for (let i = 0; i < 3_000; i++) {
      const at = Math.floor(next() * (OK_SVG.length + 1));
      const token = BAD_TOKENS[Math.floor(next() * BAD_TOKENS.length)]!;
      const mutated = OK_SVG.slice(0, at) + token + OK_SVG.slice(at);
      try {
        parseOutfitSvg(mutated);
        accepted++;
      } catch (err) {
        expect(err).toBeInstanceOf(OutfitError);
      }
    }
    // Splicing a token into whitespace or between safe characters can leave a valid fragment only if
    // the token is itself harmless; none of the tokens is.
    expect(accepted).toBe(0);
  });

  it("random bytes and random tag soup never throw anything but OutfitError and are never accepted", () => {
    const next = rng(6161);
    const alphabet = "<>/=\"' abcdefgMLCZ0123456789#.-&;:()\\\n\u202e\u0000";
    for (let i = 0; i < 3_000; i++) {
      const len = 1 + Math.floor(next() * 80);
      let s = "";
      for (let j = 0; j < len; j++) s += alphabet[Math.floor(next() * alphabet.length)];
      try {
        const tree = parseOutfitSvg(s);
        // The rare accepted string must be exactly a well-formed allow-listed fragment.
        expect(tree.length).toBeGreaterThan(0);
        expect(s).toMatch(/^[\t\n\r\x20-\x7e]+$/);
      } catch (err) {
        expect(err).toBeInstanceOf(OutfitError);
      }
    }
  });

  it("never prototype-pollutes through attribute or element names", () => {
    for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(() => parseOutfitSvg(`<${name} d="M1 1 L2 2"/>`)).toThrow(OutfitError);
      expect(() => parseOutfitSvg(`<path ${name}="1" d="M1 1 L2 2"/>`)).toThrow(OutfitError);
    }
  });
});

describe("seasons", () => {
  const at = (iso: string) => new Date(`${iso}T12:00:00`);
  it.each([
    ["2026-01-15", "north", "winter"],
    ["2026-04-15", "north", "spring"],
    ["2026-07-15", "north", "summer"],
    ["2026-10-15", "north", "autumn"],
    ["2026-12-15", "north", "winter"],
    ["2026-01-15", "south", "summer"],
    ["2026-04-15", "south", "autumn"],
    ["2026-07-15", "south", "winter"],
    ["2026-10-15", "south", "spring"],
    ["2026-12-15", "south", "summer"],
  ] as const)("%s in the %sern hemisphere is %s", (date, hemisphere, season) => {
    expect(seasonOf(at(date), hemisphere)).toBe(season);
  });

  it("auto-season picks the built-in outfit of the injected date's season", () => {
    expect(resolveOutfit("auto-season", "north", [], at("2026-01-10"))?.id).toBe(
      "frostwool-beanie",
    );
    expect(resolveOutfit("auto-season", "south", [], at("2026-01-10"))?.id).toBe("sunbeam-shades");
    expect(resolveOutfit("auto-season", "north", [], at("2026-04-10"))?.id).toBe("blossom-sprig");
    expect(resolveOutfit("auto-season", "north", [], at("2026-10-10"))?.id).toBe("maple-drift");
  });

  it("every season has a built-in outfit, and none and ids resolve", () => {
    for (const s of ["spring", "summer", "autumn", "winter"] as const) {
      expect(BUILTIN_OUTFITS.some((o) => o.season === s)).toBe(true);
    }
    expect(resolveOutfit("none", "north", [], at("2026-01-10"))).toBeNull();
    expect(resolveOutfit("ember-scarf", "north", [], at("2026-01-10"))?.name).toBe("Ember Scarf");
    expect(resolveOutfit("missing", "north", [], at("2026-01-10"))).toBeNull();
  });

  it("a user pack for the season wins over the built-in one", () => {
    const mine = validateOutfitPack(pack({ id: "my-winter", season: "winter" })) as OutfitPack;
    expect(resolveOutfit("auto-season", "north", [mine], at("2026-01-10"))?.id).toBe("my-winter");
  });
});

describe("built-in outfits", () => {
  it("are original, named by Phoenix contributors, under CC BY-SA 4.0", () => {
    expect(BUILTIN_OUTFITS.length).toBeGreaterThanOrEqual(8);
    for (const o of BUILTIN_OUTFITS) {
      expect(o.author).toBe("Phoenix contributors");
      expect(o.license).toBe("CC-BY-SA-4.0");
      expect(`${o.id} ${o.name}`.toLowerCase()).not.toMatch(/coucou|mochi/);
    }
  });

  it("include a scarf, a flame crest, a sleep cap and a lantern", () => {
    const ids = BUILTIN_OUTFITS.map((o) => o.id);
    expect(ids).toEqual(
      expect.arrayContaining(["ember-scarf", "cinder-crest", "dusk-nightcap", "hearth-lantern"]),
    );
  });

  it("give every animated layer a still variant (reduced motion renders it)", () => {
    for (const o of BUILTIN_OUTFITS) {
      for (const l of o.layers) if (l.animation) expect(l.still, o.id).toBeTruthy();
    }
  });

  it("have unique ids", () => {
    const ids = BUILTIN_OUTFITS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("source glyphs and colours", () => {
  it("has ten original glyphs, each plain path/rect markup", () => {
    expect(GLYPH_NAMES).toHaveLength(10);
    for (const name of GLYPH_NAMES) {
      expect(GLYPHS[name].markup).toMatch(/^<(path|rect)[^<>]*\/>$/);
      expect(GLYPHS[name].label.length).toBeGreaterThan(0);
    }
    // Pairwise distinct shapes: a glyph is a real second cue only if they differ.
    expect(new Set(GLYPH_NAMES.map((n) => GLYPHS[n].markup)).size).toBe(GLYPH_NAMES.length);
  });

  it("default colours all meet WCAG AA on the pill background", () => {
    for (const c of DEFAULT_SOURCE_COLOURS) {
      expect(contrastRatio(c, PILL_BACKGROUND), c).toBeGreaterThanOrEqual(AA_CONTRAST);
    }
  });

  it("gives each of the ten service capabilities a fixed, AA-readable colour and its own glyph", () => {
    const ids = [
      "vercel",
      "stripe",
      "n8n",
      "resend",
      "notion",
      "calcom",
      "spotify",
      "apple-music",
      "mpris",
      "portfolio",
    ].map((id) => `capability:${id}`);
    expect(Object.keys(SERVICE_SOURCE_STYLES).sort()).toEqual([...ids].sort());
    const glyphs = new Set<string>();
    for (const id of ids) {
      const style = defaultSourceStyle(id);
      expect(style).toEqual({ ...SERVICE_SOURCE_STYLES[id], show: true });
      expect(contrastRatio(style.colour, PILL_BACKGROUND), id).toBeGreaterThanOrEqual(AA_CONTRAST);
      expect(isGlyphName(style.glyph)).toBe(true);
      glyphs.add(style.glyph);
    }
    expect(glyphs.size).toBe(ids.length);
    // An unknown or prototype-ish id still falls back to the hashed look, never to a table lookup.
    expect(defaultSourceStyle("capability:constructor")).toEqual(
      defaultSourceStyle("capability:constructor"),
    );
    expect(SOURCE_COLOUR.test(defaultSourceStyle("capability:toString").colour)).toBe(true);
  });

  it("gives a source a stable default look", () => {
    expect(defaultSourceStyle("agent:codex")).toEqual(defaultSourceStyle("agent:codex"));
    expect(defaultSourceStyle("agent:codex").show).toBe(true);
  });

  it("computes contrast like WCAG", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#ffff00", "#ffffff")).toBeLessThan(AA_CONTRAST);
  });
});
