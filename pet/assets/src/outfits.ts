// SPDX-License-Identifier: CC-BY-SA-4.0
// Copyright (C) 2026 Phoenix contributors
//
// Outfit packs (Phase 61): the community format, its strict validator and the built-in outfits.
//
// A pack carries SVG *fragments* for Fawkes' 64x64 canvas. Fragments are untrusted data, so the
// validator is a deliberately tiny grammar with an ALLOW-LIST of elements and attributes, not a
// sanitiser that strips things: anything outside the grammar rejects the whole pack, so a hostile
// pack never half-loads. The runtime builds DOM nodes from the parsed tree (never innerHTML), and
// Core runs the same validator again on import.
//
// What a fragment can say: g, path, circle, ellipse, rect, line, polyline, polygon; geometry
// numbers, hex or `none` paints, opacity, stroke width/cap/join and a translate/rotate transform.
// No text, comments, entities, ids, classes, styles, scripts, urls, hrefs or event attributes.
import type {
  OutfitAnimation,
  OutfitLayer,
  OutfitPack,
  OutfitSeason,
  OutfitSlot,
  OutfitSvgNode,
} from "./types";
import { everydayOutfits } from "./outfits/everyday";
import { seasonalOutfits } from "./outfits/seasonal";

export * from "./outfits/sources";

export const OUTFIT_SLOTS: readonly OutfitSlot[] = [
  "head",
  "eyes",
  "body",
  "neck",
  "tail",
  "aura",
  "held",
];
export const OUTFIT_SEASONS: readonly OutfitSeason[] = [
  "spring",
  "summer",
  "autumn",
  "winter",
  "any",
];

/** Keyframes that ship with the Fawkes asset; a pack can only pick one of these by name. */
export const OUTFIT_ANIMATIONS: Record<OutfitAnimation, string> = {
  "fawkes-breathe": "fawkes-breathe 4s ease-in-out infinite",
  "fawkes-ember": "fawkes-ember 3s ease-in-out infinite",
  "fawkes-bob": "fawkes-bob 2.4s ease-in-out infinite",
  "fawkes-float": "fawkes-float 3.6s ease-in-out infinite",
  "fawkes-pulse": "fawkes-pulse 2.8s ease-in-out infinite",
  "fawkes-tail-trail": "fawkes-tail-trail 2.2s ease-in-out infinite",
  "fawkes-doze": "fawkes-doze 5s ease-in-out infinite",
};

export const MAX_LAYERS = 8;
export const MAX_LAYER_CHARS = 20_000;
export const MAX_FRAGMENT_ELEMENTS = 80;
export const MAX_FRAGMENT_DEPTH = 6;
/** Serialised size of one pack, and of all user-imported packs together (contract: 200 KB). */
export const MAX_PACK_BYTES = 100_000;
export const MAX_USER_PACKS = 8;
export const MAX_USER_PACK_BYTES = 200_000;

export class OutfitError extends Error {
  override name = "OutfitError";
}

const ID = /^[a-z][a-z0-9-]{1,31}$/;
// Only printable ASCII and plain whitespace: no NUL/control, no bidi, no zero-width, no Unicode tricks.
const FRAGMENT_CHARS = /^[\t\n\r\x20-\x7e]*$/;
// User-visible labels: printable text without control, bidi (202A-202E, 2066-2069, 200E/F) or
// zero-width (200B-200D, 2060, FEFF) characters.
// eslint-disable-next-line no-control-regex
const HIDDEN_CHARS =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2069\ufeff]/u;

const NUMBER = /^-?(?:\d{1,3}(?:\.\d{1,3})?|\.\d{1,3})$/;
const PAINT = /^(?:none|#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})$/;
const OPEN_TAG = /^<([a-z]+)((?:[ \t\r\n]+[a-z][a-z0-9-]*="[^"<>&;\\\t\r\n]*")*)[ \t\r\n]*(\/?)>/;
const ATTRIBUTE = /[ \t\r\n]+([a-z][a-z0-9-]*)="([^"]*)"/g;

/** Where geometry may be: Fawkes' 64x64 canvas plus a small margin. Nothing can cover the page. */
const GEOMETRY_MIN = -4;
const GEOMETRY_MAX = 68;

const PAINT_ATTRS = ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"];
const COMMON = ["opacity", "transform"];
const ELEMENT_ATTRS: Record<string, readonly string[]> = {
  g: [...COMMON, ...PAINT_ATTRS],
  path: ["d", ...COMMON, ...PAINT_ATTRS],
  circle: ["cx", "cy", "r", ...COMMON, ...PAINT_ATTRS],
  ellipse: ["cx", "cy", "rx", "ry", ...COMMON, ...PAINT_ATTRS],
  rect: ["x", "y", "width", "height", "rx", "ry", ...COMMON, ...PAINT_ATTRS],
  line: ["x1", "y1", "x2", "y2", ...COMMON, ...PAINT_ATTRS],
  polyline: ["points", ...COMMON, ...PAINT_ATTRS],
  polygon: ["points", ...COMMON, ...PAINT_ATTRS],
};
const COORDINATE_ATTRS = ["cx", "cy", "x", "y", "x1", "y1", "x2", "y2"];
const SIZE_ATTRS = ["r", "rx", "ry", "width", "height"];
const PATH_ARITY: Record<string, number> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  Z: 0,
};

function fail(message: string): never {
  throw new OutfitError(message);
}

function numberIn(text: string | undefined, min: number, max: number, what: string): number {
  if (text === undefined || !NUMBER.test(text)) fail(`${what} must be a plain number`);
  const n = Number(text);
  if (n < min || n > max) fail(`${what} must be between ${min} and ${max}`);
  return n;
}

function checkPath(d: string): void {
  const tokens = d.match(/[A-Za-z]|-?(?:\d+(?:\.\d+)?|\.\d+)/g) ?? [];
  if (d.replace(/[A-Za-z]|-?(?:\d+(?:\.\d+)?|\.\d+)/g, "").replace(/[ ,]/g, "") !== "") {
    fail("Path data contains unsupported characters");
  }
  if (tokens.length === 0 || tokens.length > 2_000) fail("Path data is empty or too long");
  let i = 0;
  let first = true;
  while (i < tokens.length) {
    const command = tokens[i++]!;
    const arity = PATH_ARITY[command];
    if (arity === undefined)
      fail(`Path command ${command} is not allowed (absolute M L H V C S Q T Z only)`);
    if (first && command !== "M") fail("Path data must start with M");
    first = false;
    let args = 0;
    while (i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]!)) {
      numberIn(tokens[i++], GEOMETRY_MIN, GEOMETRY_MAX, "Path coordinate");
      args++;
    }
    if (arity === 0 ? args !== 0 : args === 0 || args % arity !== 0) {
      fail(`Path command ${command} has the wrong number of arguments`);
    }
  }
}

function checkPoints(points: string): void {
  const values = points.trim().split(/[ ,]+/);
  if (values.length < 4 || values.length % 2 !== 0 || values.length > 400) {
    fail("Points need an even number of coordinates (at least two points)");
  }
  for (const v of values) numberIn(v, GEOMETRY_MIN, GEOMETRY_MAX, "Point coordinate");
}

function checkTransform(value: string): void {
  const items = value.match(/(?:translate|rotate)\([^()]*\)/g) ?? [];
  if (
    items.length === 0 ||
    items.length > 2 ||
    value.replace(/(?:translate|rotate)\([^()]*\)/g, "").trim() !== ""
  ) {
    fail("Only translate() and rotate() transforms are allowed");
  }
  for (const item of items) {
    const m = /^(translate|rotate)\(([^()]*)\)$/.exec(item)!;
    const args = m[2]!.trim().split(/[ ,]+/);
    if (m[1] === "rotate") {
      if (args.length !== 1 && args.length !== 3)
        fail("rotate() takes an angle and optionally a centre");
      numberIn(args[0], -360, 360, "Angle");
      for (const a of args.slice(1)) numberIn(a, GEOMETRY_MIN, GEOMETRY_MAX, "Rotation centre");
    } else {
      if (args.length < 1 || args.length > 2) fail("translate() takes one or two numbers");
      for (const a of args) numberIn(a, -16, 16, "Translation");
    }
  }
}

function checkAttribute(tag: string, name: string, value: string): void {
  if (COORDINATE_ATTRS.includes(name)) numberIn(value, GEOMETRY_MIN, GEOMETRY_MAX, name);
  else if (SIZE_ATTRS.includes(name)) numberIn(value, 0, 72, name);
  else if (name === "stroke-width") numberIn(value, 0, 6, name);
  else if (name === "opacity") numberIn(value, 0, 1, name);
  else if (name === "fill" || name === "stroke") {
    if (!PAINT.test(value)) fail(`${name} must be none or a #hex colour`);
  } else if (name === "stroke-linecap") {
    if (!["round", "butt", "square"].includes(value)) fail("Unsupported stroke-linecap");
  } else if (name === "stroke-linejoin") {
    if (!["round", "bevel", "miter"].includes(value)) fail("Unsupported stroke-linejoin");
  } else if (name === "d") checkPath(value);
  else if (name === "points") checkPoints(value);
  else if (name === "transform") checkTransform(value);
  else fail(`Attribute ${name} on <${tag}> is not allowed`);
}

/** SVG affine matrices compose in parent-to-child order (including transform-list order). */
type Matrix = readonly [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(p: Matrix, q: Matrix): Matrix {
  return [
    p[0] * q[0] + p[2] * q[1],
    p[1] * q[0] + p[3] * q[1],
    p[0] * q[2] + p[2] * q[3],
    p[1] * q[2] + p[3] * q[3],
    p[0] * q[4] + p[2] * q[5] + p[4],
    p[1] * q[4] + p[3] * q[5] + p[5],
  ];
}

function transformMatrix(value: string): Matrix {
  let result = IDENTITY;
  for (const item of value.match(/(?:translate|rotate)\([^()]*\)/g) ?? []) {
    const m = /^(translate|rotate)\(([^()]*)\)$/.exec(item)!;
    const args = m[2]!.trim().split(/[ ,]+/).map(Number);
    if (m[1] === "translate") {
      result = multiply(result, [1, 0, 0, 1, args[0]!, args[1] ?? 0]);
    } else {
      const angle = (args[0]! * Math.PI) / 180;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const x = args[1] ?? 0;
      const y = args[2] ?? 0;
      result = multiply(result, [c, s, -s, c, x - c * x + s * y, y - s * x - c * y]);
    }
  }
  return result;
}

/**
 * Shapes must stay on the canvas once every ancestor transform and the element's own are applied:
 * a circle or rect cannot be sized to cover the page, and nested translate/rotate cannot shove a
 * shape across it. A path curve never leaves the hull of its control points, so every control
 * point (including the implicit reflected one of S and T) is held to the bound: conservative,
 * never lenient. A stroked shape is padded by its worst-case reach, a miter at SVG's default
 * limit of 4, which is twice the stroke width and also covers round and square caps.
 */
function checkGeometry(
  tag: string,
  attrs: Record<string, string>,
  matrix: Matrix,
  strokeWidth: number,
): void {
  const lo = GEOMETRY_MIN * 2 + strokeWidth * 2 - 1e-9;
  const hi = GEOMETRY_MAX + 4 - strokeWidth * 2 + 1e-9;
  const n = (name: string) => Number(attrs[name] ?? 0);
  const inside = (x: number, y: number, dx: number, dy: number) => {
    if (!(x - dx >= lo && x + dx <= hi && y - dy >= lo && y + dy <= hi)) {
      fail(`<${tag}> leaves the canvas`);
    }
  };
  const point = (x: number, y: number) =>
    inside(
      matrix[0] * x + matrix[2] * y + matrix[4],
      matrix[1] * x + matrix[3] * y + matrix[5],
      0,
      0,
    );
  if (tag === "circle" || tag === "ellipse") {
    const rx = tag === "circle" ? n("r") : n("rx");
    const ry = tag === "circle" ? rx : n("ry");
    inside(
      matrix[0] * n("cx") + matrix[2] * n("cy") + matrix[4],
      matrix[1] * n("cx") + matrix[3] * n("cy") + matrix[5],
      Math.hypot(matrix[0] * rx, matrix[2] * ry),
      Math.hypot(matrix[1] * rx, matrix[3] * ry),
    );
  } else if (tag === "rect") {
    for (const x of [n("x"), n("x") + n("width")]) {
      for (const y of [n("y"), n("y") + n("height")]) point(x, y);
    }
  } else if (tag === "line") {
    point(n("x1"), n("y1"));
    point(n("x2"), n("y2"));
  } else if (tag === "polyline" || tag === "polygon") {
    const values = attrs.points!.trim().split(/[ ,]+/).map(Number);
    for (let i = 0; i < values.length; i += 2) point(values[i]!, values[i + 1]!);
  } else if (tag === "path") {
    // checkPath guarantees the grammar: every command is followed by whole argument groups.
    const tokens = attrs.d!.match(/[A-Za-z]|-?(?:\d+(?:\.\d+)?|\.\d+)/g)!;
    let x = 0;
    let y = 0;
    let startX = 0;
    let startY = 0;
    let controlX = 0;
    let controlY = 0;
    let previous = "";
    for (let i = 0; i < tokens.length;) {
      const command = tokens[i++]!;
      const arity = PATH_ARITY[command]!;
      if (command === "Z") {
        x = startX;
        y = startY;
        previous = command;
        continue;
      }
      for (let first = true; i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]!); first = false) {
        const args = tokens.slice(i, i + arity).map(Number);
        i += arity;
        // Extra coordinate pairs after M are implicit L commands.
        const op = command === "M" && !first ? "L" : command;
        const fromX = x;
        const fromY = y;
        if (op === "H") x = args[0]!;
        else if (op === "V") y = args[0]!;
        else {
          x = args[args.length - 2]!;
          y = args[args.length - 1]!;
        }
        if (op === "M") {
          startX = x;
          startY = y;
        }
        if (op === "H" || op === "V") {
          point(x, y);
        } else {
          for (let k = 0; k < args.length; k += 2) point(args[k]!, args[k + 1]!);
        }
        if (op === "S" || op === "T") {
          const reflects = op === "S" ? "CS".includes(previous) : "QT".includes(previous);
          const reflectedX = reflects ? 2 * fromX - controlX : fromX;
          const reflectedY = reflects ? 2 * fromY - controlY : fromY;
          point(reflectedX, reflectedY);
          controlX = op === "T" ? reflectedX : args[0]!;
          controlY = op === "T" ? reflectedY : args[1]!;
        } else if (op === "C") {
          controlX = args[2]!;
          controlY = args[3]!;
        } else if (op === "Q") {
          controlX = args[0]!;
          controlY = args[1]!;
        }
        previous = op;
      }
    }
  }
}

/**
 * Parses an SVG fragment into a tree of allow-listed nodes, or throws OutfitError. The fragment is
 * never rewritten: what is accepted is exactly what was written.
 */
export function parseOutfitSvg(svg: unknown): OutfitSvgNode[] {
  if (typeof svg !== "string" || svg.length === 0) fail("An SVG fragment is required");
  if (svg.length > MAX_LAYER_CHARS)
    fail(`An SVG fragment is limited to ${MAX_LAYER_CHARS} characters`);
  if (!FRAGMENT_CHARS.test(svg)) fail("An SVG fragment may contain printable ASCII only");
  const roots: OutfitSvgNode[] = [];
  const stack: OutfitSvgNode[] = [];
  // Presentation state each open group passes down: composed transform and inherited stroke.
  const inherited: { matrix: Matrix; stroke: string | undefined; width: string | undefined }[] = [];
  let count = 0;
  let i = 0;
  while (i < svg.length) {
    const rest = svg.slice(i);
    if (rest[0] !== "<") {
      const space = /^[ \t\r\n]+/.exec(rest);
      if (!space) fail("Text, entities and comments are not allowed");
      i += space[0].length;
      continue;
    }
    const close = /^<\/([a-z]+)>/.exec(rest);
    if (close) {
      if (stack.pop()?.tag !== close[1]) fail("Tags are not balanced");
      inherited.pop();
      i += close[0].length;
      continue;
    }
    const open = OPEN_TAG.exec(rest);
    if (!open) fail("Unsupported markup");
    const tag = open[1]!;
    const allowed = Object.hasOwn(ELEMENT_ATTRS, tag)
      ? ELEMENT_ATTRS[tag]!
      : fail(`<${tag}> is not allowed`);
    if (++count > MAX_FRAGMENT_ELEMENTS)
      fail(`At most ${MAX_FRAGMENT_ELEMENTS} elements per fragment`);
    const node: OutfitSvgNode = { tag, attrs: [], children: [] };
    const values: Record<string, string> = {};
    const seen: Record<string, true> = {};
    for (const m of open[2]!.matchAll(ATTRIBUTE)) {
      const [, name, value] = m as unknown as [string, string, string];
      if (!allowed.includes(name)) fail(`Attribute ${name} on <${tag}> is not allowed`);
      if (Object.hasOwn(seen, name)) fail(`Attribute ${name} is repeated`);
      seen[name] = true;
      checkAttribute(tag, name, value);
      values[name] = value;
      node.attrs.push([name, value]);
    }
    if (tag === "path" && !Object.hasOwn(seen, "d")) fail("<path> needs d");
    if ((tag === "polyline" || tag === "polygon") && !Object.hasOwn(seen, "points")) {
      fail(`<${tag}> needs points`);
    }
    const parent = inherited.at(-1);
    const context = {
      matrix: multiply(
        parent?.matrix ?? IDENTITY,
        values.transform === undefined ? IDENTITY : transformMatrix(values.transform),
      ),
      stroke: values.stroke ?? parent?.stroke,
      width: values["stroke-width"] ?? parent?.width,
    };
    if (tag !== "g") {
      const stroked = context.stroke !== undefined && context.stroke !== "none";
      checkGeometry(tag, values, context.matrix, stroked ? Number(context.width ?? 1) : 0);
    }
    (stack.at(-1)?.children ?? roots).push(node);
    i += open[0].length;
    if (!open[3]) {
      // Only groups nest; a shape is a leaf, so its closing tag must follow at once.
      if (tag !== "g" && !svg.slice(i).startsWith(`</${tag}>`))
        fail(`<${tag}> cannot contain elements`);
      stack.push(node);
      inherited.push(context);
      if (stack.length > MAX_FRAGMENT_DEPTH) fail("Groups are nested too deeply");
    }
  }
  if (stack.length > 0 || roots.length === 0) fail("Tags are not balanced");
  return roots;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], what: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${what} has an unknown field "${key.slice(0, 40)}"`);
  }
}

function label(value: unknown, max: number, what: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    fail(`${what} must be 1 to ${max} characters`);
  }
  if (HIDDEN_CHARS.test(value) || value !== value.trim()) {
    fail(`${what} must not contain control, bidirectional or zero-width characters`);
  }
  return value;
}

/**
 * Validates a pack and returns a clean copy holding only the known fields. Rejects, never repairs:
 * the caller learns why, and nothing from a hostile pack is kept.
 */
export function validateOutfitPack(input: unknown): OutfitPack {
  if (!isRecord(input)) fail("An outfit pack must be an object");
  let size: number;
  try {
    size = new TextEncoder().encode(JSON.stringify(input)).length;
  } catch {
    return fail("An outfit pack must be plain JSON");
  }
  if (size > MAX_PACK_BYTES) fail(`An outfit pack is limited to ${MAX_PACK_BYTES} bytes`);
  onlyKeys(
    input,
    ["format", "version", "id", "name", "author", "license", "season", "layers"],
    "The pack",
  );
  if (input.format !== "phoenix-outfit" || input.version !== 1) {
    fail('The pack must be {"format":"phoenix-outfit","version":1}');
  }
  if (typeof input.id !== "string" || !ID.test(input.id))
    fail("The pack id must match ^[a-z][a-z0-9-]{1,31}$");
  const season = input.season;
  if (season !== undefined && !OUTFIT_SEASONS.includes(season as OutfitSeason)) {
    fail("The season must be spring, summer, autumn, winter or any");
  }
  const layers = input.layers;
  if (!Array.isArray(layers) || layers.length < 1 || layers.length > MAX_LAYERS) {
    fail(`A pack has 1 to ${MAX_LAYERS} layers`);
  }
  const clean: OutfitLayer[] = layers.map((layer: unknown) => {
    if (!isRecord(layer)) fail("A layer must be an object");
    onlyKeys(layer, ["slot", "svg", "still", "animation"], "A layer");
    if (!OUTFIT_SLOTS.includes(layer.slot as OutfitSlot)) fail("Unknown layer slot");
    parseOutfitSvg(layer.svg);
    if (layer.still !== undefined) parseOutfitSvg(layer.still);
    const animation = layer.animation;
    if (animation !== undefined) {
      if (typeof animation !== "string" || !Object.hasOwn(OUTFIT_ANIMATIONS, animation)) {
        fail("Unknown animation name");
      }
      if (layer.still === undefined)
        fail("An animated layer needs a still variant for reduced motion");
    }
    return {
      slot: layer.slot as OutfitSlot,
      svg: layer.svg as string,
      ...(layer.still !== undefined ? { still: layer.still as string } : {}),
      ...(animation !== undefined ? { animation: animation as OutfitAnimation } : {}),
    };
  });
  return {
    format: "phoenix-outfit",
    version: 1,
    id: input.id,
    name: label(input.name, 40, "The name"),
    author: label(input.author, 60, "The author"),
    license: label(input.license, 60, "The licence"),
    ...(season !== undefined ? { season: season as OutfitSeason } : {}),
    layers: clean,
  };
}

export const BUILTIN_OUTFITS: readonly OutfitPack[] = [...everydayOutfits, ...seasonalOutfits];

/** Meteorological seasons: north Dec-Feb winter; south is the mirror image. */
export function seasonOf(now: Date, hemisphere: "north" | "south"): Exclude<OutfitSeason, "any"> {
  const month = now.getMonth();
  const north =
    month === 11 || month < 2 ? "winter" : month < 5 ? "spring" : month < 8 ? "summer" : "autumn";
  if (hemisphere === "north") return north;
  return { winter: "summer", spring: "autumn", summer: "winter", autumn: "spring" }[
    north
  ] as Exclude<OutfitSeason, "any">;
}

/**
 * The outfit a setting stands for: "none", a pack id (built-in or user), or "auto-season" which
 * takes the current season's outfit (a user pack for that season wins over the built-in one).
 */
export function resolveOutfit(
  choice: string,
  hemisphere: "north" | "south",
  userPacks: readonly OutfitPack[],
  now: Date,
): OutfitPack | null {
  if (choice === "none") return null;
  const all = [...userPacks, ...BUILTIN_OUTFITS];
  if (choice === "auto-season") {
    const season = seasonOf(now, hemisphere);
    return all.find((p) => p.season === season) ?? null;
  }
  return all.find((p) => p.id === choice) ?? null;
}
