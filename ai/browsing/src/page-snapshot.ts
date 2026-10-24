// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { PageReader, PublicField, PublicPage } from "./index";

/** Longest page text handed to the model; the rest is dropped and the model is told so. */
export const MAX_PAGE_CHARS = 20_000;
const DEFAULT_BLOCK_CHARS = 2_000;
const DEFAULT_INPUT_CHARS = 4 * 1024 * 1024;
const DEFAULT_MAX_FIELDS = 500;
const MAX_LINKS = 2_000;
const MAX_DEPTH = 512;
const MAX_ATTRS = 64;
const ATTR_TEXT_CHARS = 200;
const FIELD_TEXT_CHARS = 120;
const TITLE_CHARS = 300;

export class PageSnapshotError extends Error {
  override name = "PageSnapshotError";
}

export interface PageSnapshotInput {
  /** http(s) URL of the document. The fragment is dropped; credentials are refused. */
  url: string;
  /** Overrides any `<title>` found in `html`. */
  title?: string;
  /** Fetched HTML snapshot. Exactly one of `html` and `text` is accepted. */
  html?: string;
  /** Plain text the adapter already extracted. It is sanitised but not parsed as markup. */
  text?: string;
}

export interface PageSnapshotLimits {
  /** Total text size, default `MAX_PAGE_CHARS`. */
  maxChars?: number;
  /** Longest single block (paragraph, list item, ...), default 2000. */
  maxBlockChars?: number;
  /** Longest input read; the rest is ignored, default 4 MiB. */
  maxInputChars?: number;
  /** Most form controls described, default 500. */
  maxFields?: number;
}

export interface PageProvenance {
  /** Origin of the document the text came from. */
  origin: string;
  /** Text, a block, the input or the field list was cut to fit a limit. */
  truncated: boolean;
  /** Hidden subtrees (and `<dialog>` without `open`) whose text was dropped. */
  removedHidden: number;
  /** Script-like elements (script, style, template, svg, iframe, ...), comments excluded, and dangerous links dropped. */
  removedScripts: number;
}

export interface PageSnapshot {
  page: PublicPage;
  provenance: PageProvenance;
}

// ---------------------------------------------------------------------------------------------
// Entities: a fixed table and validated numeric references. Nothing is expanded recursively.
// ---------------------------------------------------------------------------------------------

const NAMED_ENTITIES = new Map<string, string>([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", "\u00a0"],
  ["copy", "\u00a9"],
  ["reg", "\u00ae"],
  ["trade", "\u2122"],
  ["hellip", "\u2026"],
  ["mdash", "\u2014"],
  ["ndash", "\u2013"],
  ["lsquo", "\u2018"],
  ["rsquo", "\u2019"],
  ["ldquo", "\u201c"],
  ["rdquo", "\u201d"],
  ["bull", "\u2022"],
  ["middot", "\u00b7"],
  ["laquo", "\u00ab"],
  ["raquo", "\u00bb"],
  ["euro", "\u20ac"],
  ["pound", "\u00a3"],
  ["yen", "\u00a5"],
  ["cent", "\u00a2"],
  ["deg", "\u00b0"],
  ["times", "\u00d7"],
  ["divide", "\u00f7"],
  ["plusmn", "\u00b1"],
  ["sect", "\u00a7"],
  ["para", "\u00b6"],
]);

function isAlnum(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

function digitValue(c: number, hex: boolean): number {
  if (c >= 48 && c <= 57) return c - 48;
  if (!hex) return -1;
  if (c >= 97 && c <= 102) return c - 87;
  if (c >= 65 && c <= 70) return c - 55;
  return -1;
}

/** Returns the replacement text and the index after the reference, or undefined if it is literal. */
function entityAt(s: string, i: number): [string, number] | undefined {
  if (s.charCodeAt(i + 1) === 35) {
    let j = i + 2;
    const hex = s.charCodeAt(j) === 120 || s.charCodeAt(j) === 88;
    if (hex) j += 1;
    const start = j;
    let value = 0;
    while (j < s.length) {
      const d = digitValue(s.charCodeAt(j), hex);
      if (d < 0) break;
      // Past the Unicode range the value only needs to stay out of range; digits are still consumed.
      if (value <= 0x10ffff) value = value * (hex ? 16 : 10) + d;
      j += 1;
    }
    if (j === start) return undefined;
    if (s.charCodeAt(j) === 59) j += 1;
    const valid = value >= 1 && value <= 0x10ffff && (value < 0xd800 || value > 0xdfff);
    return [valid ? String.fromCodePoint(value) : "\ufffd", j];
  }
  let j = i + 1;
  while (j < s.length && j - i <= 10 && isAlnum(s.charCodeAt(j))) j += 1;
  if (s.charCodeAt(j) !== 59) return undefined;
  const replacement = NAMED_ENTITIES.get(s.slice(i + 1, j));
  return replacement === undefined ? undefined : [replacement, j + 1];
}

export function decodeEntities(s: string): string {
  let amp = s.indexOf("&");
  if (amp < 0) return s;
  let out = "";
  let last = 0;
  while (amp >= 0) {
    const hit = entityAt(s, amp);
    if (!hit) {
      amp = s.indexOf("&", amp + 1);
      continue;
    }
    out += s.slice(last, amp) + hit[0];
    last = hit[1];
    amp = s.indexOf("&", last);
  }
  return out + s.slice(last);
}

// ---------------------------------------------------------------------------------------------
// Character hygiene: invisible, bidi and control characters are removed, whitespace collapsed.
// ---------------------------------------------------------------------------------------------

function isSpaceCode(c: number): boolean {
  return (
    c === 32 ||
    (c >= 9 && c <= 13) ||
    c === 0x85 ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000
  );
}

function isRemovedCode(c: number): boolean {
  return (
    c < 32 ||
    (c >= 0x7f && c <= 0x9f) ||
    c === 0xad ||
    c === 0x34f ||
    c === 0x61c ||
    c === 0x115f ||
    c === 0x1160 ||
    c === 0x17b4 ||
    c === 0x17b5 ||
    (c >= 0x180b && c <= 0x180f) ||
    (c >= 0x200b && c <= 0x200f) ||
    (c >= 0x202a && c <= 0x202e) ||
    (c >= 0x2060 && c <= 0x206f) ||
    c === 0x3164 ||
    (c >= 0xd800 && c <= 0xdfff) ||
    (c >= 0xe000 && c <= 0xf8ff) ||
    (c >= 0xfe00 && c <= 0xfe0f) ||
    c === 0xfeff ||
    c === 0xffa0 ||
    (c >= 0xfff9 && c <= 0xfffc) ||
    (c >= 0x1d173 && c <= 0x1d17a) ||
    (c >= 0xe0000 && c <= 0xe0fff) ||
    c >= 0xf0000
  );
}

/**
 * Removes invisible, bidirectional-override, private-use, tag and control characters and lone
 * surrogates, and turns every whitespace run into one space. Leading and trailing space is kept.
 */
export function sanitizeText(s: string): string {
  let out = "";
  let inSpace = false;
  for (let i = 0; i < s.length; i += 1) {
    let c = s.charCodeAt(i);
    let width = 1;
    if (c >= 0xd800 && c <= 0xdbff) {
      const low = s.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        c = (c - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
        width = 2;
      }
    }
    if (isSpaceCode(c)) {
      if (!inSpace) out += " ";
      inSpace = true;
    } else if (!isRemovedCode(c)) {
      out += width === 2 ? s.slice(i, i + 2) : s[i];
      inSpace = false;
    }
    i += width - 1;
  }
  return out;
}

function shortText(s: string, max: number): string {
  const text = sanitizeText(s).trim();
  return text.length > max ? text.slice(0, max) : text;
}

/** Text taken from an attribute is shown in brackets, so a bracket inside it must not close the marker. */
function attrText(s: string): string {
  return shortText(s, ATTR_TEXT_CHARS).replace(/\[/g, "(").replace(/\]/g, ")");
}

// ---------------------------------------------------------------------------------------------
// Hidden-element detection from attributes and inline styles only. Stylesheet classes, external
// CSS, white-on-white text and tiny-contrast text are NOT detectable without a layout engine.
// ---------------------------------------------------------------------------------------------

function stripCssComments(css: string): string {
  let at = css.indexOf("/*");
  if (at < 0) return css;
  let out = "";
  let last = 0;
  while (at >= 0) {
    out += css.slice(last, at);
    const end = css.indexOf("*/", at + 2);
    if (end < 0) return out;
    last = end + 2;
    at = css.indexOf("/*", last);
  }
  return out + css.slice(last);
}

function cssNumber(value: string): { n: number; unit: string } | undefined {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/.exec(value.length > 40 ? "" : value);
  return m ? { n: Number(m[1]), unit: m[2] ?? "" } : undefined;
}

const OFFSET_PROPS = new Set([
  "left",
  "right",
  "top",
  "bottom",
  "text-indent",
  "margin-left",
  "margin-top",
  "inset-inline-start",
]);
const ZERO_SIZE_PROPS = new Set(["width", "height", "max-width", "max-height"]);

function declarationHides(prop: string, value: string): boolean {
  switch (prop) {
    case "display":
      return value === "none";
    case "visibility":
      return value === "hidden" || value === "collapse";
    case "content-visibility":
      return value === "hidden";
    case "opacity": {
      const num = cssNumber(value);
      return num !== undefined && num.n <= (num.unit === "%" ? 1 : 0.01);
    }
    case "font-size": {
      const num = cssNumber(value);
      return num !== undefined && (num.n === 0 || (num.unit === "px" && num.n <= 1));
    }
    case "color":
    case "-webkit-text-fill-color":
      return (
        value === "transparent" ||
        (value.length < 80 && /^(?:rgba|hsla)\(.*[,/ ]\s*0(?:\.0+)?%?\s*\)$/.test(value))
      );
    case "clip":
      return (
        value.length < 60 &&
        /^rect\(\s*0(?:px)?[\s,]+0(?:px)?[\s,]+0(?:px)?[\s,]+0(?:px)?\s*\)$/.test(value)
      );
    case "clip-path":
      return value.startsWith("inset(100%") || value.startsWith("circle(0");
    case "transform":
      return value.includes("scale(0)");
    default:
      break;
  }
  if (ZERO_SIZE_PROPS.has(prop)) {
    const num = cssNumber(value);
    return num !== undefined && num.n === 0;
  }
  if (OFFSET_PROPS.has(prop)) {
    const num = cssNumber(value);
    if (!num) return false;
    return num.n <= -500 || ((num.unit === "vw" || num.unit === "vh") && num.n <= -100);
  }
  return false;
}

/** A style we cannot read reliably (CSS escapes) is treated as hiding: dropping text fails closed. */
export function styleHidesElement(style: string): boolean {
  if (style.includes("\\")) return true;
  for (const declaration of stripCssComments(style).split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const prop = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration
      .slice(colon + 1)
      .replace(/!\s*important/gi, "")
      .trim()
      .toLowerCase();
    if (declarationHides(prop, value)) return true;
  }
  return false;
}

function attrsHide(name: string, attrs: ReadonlyMap<string, string>): boolean {
  if (attrs.has("hidden")) return true;
  if (name === "dialog" && !attrs.has("open")) return true;
  if ((attrs.get("aria-hidden") ?? "").trim().toLowerCase() === "true") return true;
  const style = attrs.get("style");
  return style !== undefined && styleHidesElement(style);
}

// ---------------------------------------------------------------------------------------------
// Tokenizer. One forward pass over the input with indexOf/charCodeAt: no regular expression runs
// over attacker-sized input, nothing is rescanned, and every nested structure is capped.
// ---------------------------------------------------------------------------------------------

const MAX_TAG_NAME = 32;
const ATTR_STORE_CHARS = 8_192;

/** Content is raw text up to the matching close tag and is never parsed as markup. */
const RAW_TEXT = new Set([
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
]);
/** The whole subtree is dropped (nesting is still tracked so that its end is found). */
const SKIP = new Set([
  "template",
  "noscript",
  "svg",
  "object",
  "canvas",
  "math",
  "head",
  "select",
  "datalist",
]);
/** Script-like elements whose removal is reported in `removedScripts`. */
const COUNTED_SKIP = new Set([
  "script",
  "style",
  "template",
  "noscript",
  "svg",
  "object",
  "canvas",
  "math",
  "iframe",
  "embed",
  "xmp",
  "noembed",
  "noframes",
]);
const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
const BLOCK = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "body",
  "br",
  "caption",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "html",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);
/** Inline elements that must not run into their neighbours' text. */
const SPACED = new Set(["a", "button", "label", "option", "td", "th"]);
/** Elements whose end tag is optional: a second start tag closes the first one. */
const IMPLIED_CLOSE = new Set(["p", "li", "dt", "dd", "tr", "td", "th"]);

function isWs(c: number): boolean {
  return c === 32 || (c >= 9 && c <= 13);
}

interface Tag {
  name: string;
  closing: boolean;
  attrs: Map<string, string>;
  /** Index after the closing `>` (or the end of input for an unterminated tag). */
  end: number;
}

function storeAttr(name: string, value: string): string {
  const tooLong = value.length > ATTR_STORE_CHARS;
  // A style too long to inspect is treated as hiding the element: dropping text fails closed.
  if (name === "style" && tooLong) return "display:none";
  return decodeEntities(tooLong ? value.slice(0, ATTR_STORE_CHARS) : value);
}

function parseTag(html: string, lt: number): Tag {
  const n = html.length;
  const closing = html.charCodeAt(lt + 1) === 47;
  let j = lt + (closing ? 2 : 1);
  const nameStart = j;
  while (j < n) {
    const c = html.charCodeAt(j);
    if (isWs(c) || c === 47 || c === 62) break;
    j += 1;
  }
  const rawName = html.slice(nameStart, j);
  const name = rawName.length > MAX_TAG_NAME ? "x-long-name" : rawName.toLowerCase();
  const attrs = new Map<string, string>();
  while (j < n) {
    const c = html.charCodeAt(j);
    if (c === 62) return { name, closing, attrs, end: j + 1 };
    if (isWs(c) || c === 47) {
      j += 1;
      continue;
    }
    const nameAt = j;
    j += 1;
    while (j < n) {
      const d = html.charCodeAt(j);
      if (isWs(d) || d === 47 || d === 62 || d === 61) break;
      j += 1;
    }
    const attrName = html.slice(nameAt, j).toLowerCase();
    while (j < n && isWs(html.charCodeAt(j))) j += 1;
    let value = "";
    if (html.charCodeAt(j) === 61) {
      j += 1;
      while (j < n && isWs(html.charCodeAt(j))) j += 1;
      const quote = html.charCodeAt(j);
      if (quote === 34 || quote === 39) {
        const close = html.indexOf(quote === 34 ? '"' : "'", j + 1);
        value = html.slice(j + 1, close < 0 ? n : close);
        j = close < 0 ? n : close + 1;
      } else {
        const valueAt = j;
        while (j < n) {
          const d = html.charCodeAt(j);
          if (isWs(d) || d === 62) break;
          j += 1;
        }
        value = html.slice(valueAt, j);
      }
    }
    if (attrs.size < MAX_ATTRS && attrName.length <= 64 && !attrs.has(attrName)) {
      attrs.set(attrName, storeAttr(attrName, value));
    }
  }
  return { name, closing, attrs, end: n };
}

function nameMatchesAt(html: string, at: number, name: string): boolean {
  for (let k = 0; k < name.length; k += 1) {
    let c = html.charCodeAt(at + k);
    if (c >= 65 && c <= 90) c += 32;
    if (c !== name.charCodeAt(k)) return false;
  }
  const after = html.charCodeAt(at + name.length);
  return Number.isNaN(after) || isWs(after) || after === 47 || after === 62;
}

/** Finds `</name` (ASCII case-insensitive) at or after `from`, and the index after its `>`. */
function findCloseTag(
  html: string,
  name: string,
  from: number,
): { start: number; end: number } | undefined {
  let p = html.indexOf("</", from);
  while (p >= 0) {
    if (nameMatchesAt(html, p + 2, name)) {
      const gt = html.indexOf(">", p);
      return { start: p, end: gt < 0 ? html.length : gt + 1 };
    }
    p = html.indexOf("</", p + 2);
  }
  return undefined;
}

/** Collects blocks of text under a total and a per-block cap. */
class TextOut {
  truncated = false;
  done = false;
  private blocks: string[] = [];
  private total = 0;
  private cur = "";
  private full = false;

  constructor(
    private readonly max: number,
    private readonly maxBlock: number,
  ) {}

  /** False once the current block or the whole text is full, so callers can skip the work. */
  get accepting(): boolean {
    return !this.done && !this.full;
  }

  add(s: string): void {
    if (!this.accepting || !s) return;
    this.cur += this.cur.endsWith(" ") && s.startsWith(" ") ? s.slice(1) : s;
    if (this.cur.length > this.maxBlock) {
      this.cur = this.cur.slice(0, this.maxBlock);
      this.full = true;
      this.truncated = true;
    }
  }

  breakBlock(): void {
    this.full = false;
    const block = this.cur.trim();
    this.cur = "";
    if (!block || this.done) return;
    const separator = this.blocks.length > 0 ? 1 : 0;
    const room = this.max - this.total - separator;
    if (block.length > room) {
      if (room > 0) {
        this.blocks.push(block.slice(0, room));
        this.total += room + separator;
      }
      this.truncated = true;
      this.done = true;
      return;
    }
    this.blocks.push(block);
    this.total += block.length + separator;
  }

  finish(): string {
    this.breakBlock();
    return this.blocks.join("\n");
  }
}

function cleanToken(value: string | undefined): string {
  return sanitizeText(value ?? "")
    .trim()
    .slice(0, 80)
    .replace(/[^A-Za-z0-9_:.-]/g, "_");
}

/** host + path of an http(s) link. Query, fragment and credentials never leave this function. */
function renderLink(href: string, base: URL): { text?: string; dangerous: boolean } {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.length > 2048) return { dangerous: false };
  let url: URL;
  try {
    url = new URL(trimmed, base);
  } catch {
    return { dangerous: false };
  }
  if (url.protocol === "http:" || url.protocol === "https:") {
    return {
      text: (url.host + url.pathname)
        .slice(0, ATTR_TEXT_CHARS)
        .replace(/\[/g, "(")
        .replace(/\]/g, ")"),
      dangerous: false,
    };
  }
  const dangerous = ["javascript:", "data:", "vbscript:"].includes(url.protocol);
  return { dangerous };
}

interface Entry {
  name: string;
  hidden: boolean;
  skip: boolean;
  head: boolean;
  form: boolean;
}

interface LabelScope {
  text: string;
  fields: number[];
  forId: string;
}

class Walker {
  readonly out: TextOut;
  readonly fields: PublicField[] = [];
  title: string | undefined;
  removedHidden = 0;
  removedScripts = 0;
  truncated = false;
  private readonly fieldIds: string[] = [];
  private readonly stack: Entry[] = [];
  private readonly openCounts = new Map<string, number>();
  private hiddenDepth = 0;
  private skipDepth = 0;
  private headDepth = 0;
  private halted = false;
  private readonly forms: string[] = [];
  private readonly used = new Set<string>();
  private readonly tagCounts = new Map<string, number>();
  private readonly overflowForms = new Set<string>();
  private label: LabelScope | undefined;
  private readonly labelsFor = new Map<string, string>();
  private links = 0;

  constructor(
    private readonly html: string,
    private readonly base: URL,
    private readonly limits: Required<PageSnapshotLimits>,
  ) {
    this.out = new TextOut(limits.maxChars, limits.maxBlockChars);
  }

  run(): void {
    const html = this.html;
    const n = html.length;
    let pos = 0;
    // Parsing goes on after the text is full or a limit is hit: controls further down the page must
    // still be described, because a protected field is protected wherever it appears.
    while (pos < n && !this.halted) {
      const lt = html.indexOf("<", pos);
      const end = lt < 0 ? n : lt;
      if (end > pos) this.text(html.slice(pos, end));
      if (lt < 0) break;
      pos = this.markup(lt);
    }
    this.finishLabel();
    if (this.halted) this.markOpenFormsUnreported();
  }

  /** Fields array including a synthetic protected marker for every form that lost controls. */
  result(): PublicField[] {
    const fields = this.fields.map((field, i) => {
      const id = this.fieldIds[i];
      if (field.label || !id) return field;
      const label = this.labelsFor.get(id);
      return label ? { ...field, label } : field;
    });
    for (const form of this.overflowForms) {
      fields.push({ selector: `${form} :unreported-controls`, type: "hidden", form });
    }
    return fields;
  }

  private markOpenFormsUnreported(): void {
    for (const form of this.forms) this.overflowForms.add(form);
  }

  private stop(): void {
    this.halted = true;
    this.truncated = true;
  }

  private text(raw: string): void {
    if (this.skipDepth > 0) return;
    const visible = this.hiddenDepth === 0 && this.out.accepting;
    const labelling = this.label !== undefined && this.hiddenDepth === 0;
    if (!visible && !labelling) return;
    const s = sanitizeText(decodeEntities(raw));
    if (this.label && labelling && this.label.text.length < FIELD_TEXT_CHARS * 2) {
      this.label.text += s;
    }
    if (visible) this.out.add(s);
  }

  private markup(lt: number): number {
    const html = this.html;
    const n = html.length;
    const c = html.charCodeAt(lt + 1);
    if (c === 33 || c === 63) {
      if (html.startsWith("<!--", lt)) {
        if (html.startsWith("<!-->", lt)) return lt + 5;
        if (html.startsWith("<!--->", lt)) return lt + 6;
        const end = html.indexOf("-->", lt + 4);
        return end < 0 ? n : end + 3;
      }
      const gt = html.indexOf(">", lt + 2);
      return gt < 0 ? n : gt + 1;
    }
    const letter = (c | 32) >= 97 && (c | 32) <= 122;
    if (c === 47) {
      const d = html.charCodeAt(lt + 2);
      if (!((d | 32) >= 97 && (d | 32) <= 122)) {
        const gt = html.indexOf(">", lt + 2);
        return gt < 0 ? n : gt + 1;
      }
      const tag = parseTag(html, lt);
      this.closeTag(tag.name);
      return tag.end;
    }
    if (!letter) {
      this.text("<");
      return lt + 1;
    }
    const tag = parseTag(html, lt);
    return this.openTag(tag);
  }

  private openTag(tag: Tag): number {
    const { name, attrs } = tag;
    if (RAW_TEXT.has(name)) return this.rawElement(tag);
    const inSkip = this.skipDepth > 0;
    const selfHidden = attrsHide(name, attrs);
    const visible = !inSkip && !selfHidden && this.hiddenDepth === 0;
    if (selfHidden && !inSkip && this.hiddenDepth === 0) this.removedHidden += 1;
    if (COUNTED_SKIP.has(name)) this.removedScripts += 1;
    if (VOID.has(name)) {
      if (name === "br" || name === "hr") this.out.breakBlock();
      else if (name === "input" && !inSkip) this.addField(tag, this.inputType(attrs));
      this.inlineAttrs(tag, visible);
      return tag.end;
    }
    if (IMPLIED_CLOSE.has(name)) {
      const top = this.stack[this.stack.length - 1];
      if (top?.name === name && !top.hidden && !top.skip) this.popEntry();
    }
    if (this.stack.length >= MAX_DEPTH) {
      this.stop();
      return this.html.length;
    }
    let isForm = false;
    if (!inSkip) {
      if (name === "form") {
        this.forms.push(this.addField(tag, "form"));
        isForm = true;
      } else if (name === "select") {
        this.addField(tag, "select");
      } else if (name === "button") {
        const type = (attrs.get("type") ?? "submit").trim().toLowerCase();
        this.addField(tag, /^[a-z0-9-]{1,20}$/.test(type) ? type : "submit");
      } else if (name === "label") {
        this.finishLabel();
        this.label = { text: "", fields: [], forId: cleanToken(attrs.get("for")) };
      }
    }
    if (BLOCK.has(name)) this.out.breakBlock();
    else if (SPACED.has(name)) this.out.add(" ");
    if (name === "a" && visible) this.link(attrs.get("href"));
    this.inlineAttrs(tag, visible);
    const skip = SKIP.has(name);
    this.stack.push({ name, hidden: selfHidden, skip, head: name === "head", form: isForm });
    this.openCounts.set(name, (this.openCounts.get(name) ?? 0) + 1);
    if (selfHidden) this.hiddenDepth += 1;
    if (skip) this.skipDepth += 1;
    if (name === "head") this.headDepth += 1;
    return tag.end;
  }

  private closeTag(name: string): void {
    if (!this.openCounts.get(name)) return;
    for (;;) {
      const entry = this.popEntry();
      if (!entry || entry.name === name) return;
    }
  }

  private popEntry(): Entry | undefined {
    const entry = this.stack.pop();
    if (!entry) return undefined;
    this.openCounts.set(entry.name, (this.openCounts.get(entry.name) ?? 1) - 1);
    if (entry.hidden) this.hiddenDepth -= 1;
    if (entry.skip) this.skipDepth -= 1;
    if (entry.head) this.headDepth -= 1;
    if (entry.form) this.forms.pop();
    if (entry.name === "label") this.finishLabel();
    if (BLOCK.has(entry.name)) this.out.breakBlock();
    else if (SPACED.has(entry.name)) this.out.add(" ");
    return entry;
  }

  private rawElement(tag: Tag): number {
    const n = this.html.length;
    const { name } = tag;
    const close = findCloseTag(this.html, name, tag.end);
    if (COUNTED_SKIP.has(name)) this.removedScripts += 1;
    if (name === "title") {
      if (this.title === undefined && this.skipDepth === this.headDepth && this.hiddenDepth === 0) {
        const stop = Math.min(close ? close.start : n, tag.end + 2_000);
        this.title = shortText(decodeEntities(this.html.slice(tag.end, stop)), TITLE_CHARS);
      }
    } else if (name === "textarea" && this.skipDepth === 0) {
      this.addField(tag, "textarea");
    }
    return close ? close.end : n;
  }

  private inputType(attrs: ReadonlyMap<string, string>): string {
    const type = (attrs.get("type") ?? "text").trim().toLowerCase();
    return /^[a-z0-9-]{1,20}$/.test(type) ? type : "text";
  }

  /** Alt, title and aria-label are kept because assistive technology exposes them; they are marked. */
  private inlineAttrs(tag: Tag, visible: boolean): void {
    if (!visible) return;
    const parts: [string, string | undefined][] = [
      ["image", tag.name === "img" ? tag.attrs.get("alt") : undefined],
      ["label", tag.attrs.get("aria-label")],
      ["title", tag.attrs.get("title")],
    ];
    for (const [kind, value] of parts) {
      const text = value === undefined ? "" : attrText(value);
      if (text) this.out.add(` [${kind}: ${text}] `);
    }
  }

  private link(href: string | undefined): void {
    if (href === undefined) return;
    const { text, dangerous } = renderLink(href, this.base);
    if (dangerous) this.removedScripts += 1;
    if (!text) return;
    if (this.links >= MAX_LINKS) {
      this.truncated = true;
      return;
    }
    this.links += 1;
    this.out.add(` [link: ${text}] `);
  }

  private finishLabel(): void {
    const scope = this.label;
    if (!scope) return;
    this.label = undefined;
    const text = shortText(scope.text, FIELD_TEXT_CHARS);
    if (!text) return;
    if (scope.forId && this.labelsFor.size < 1_000 && !this.labelsFor.has(scope.forId)) {
      this.labelsFor.set(scope.forId, text);
    }
    for (const index of scope.fields) {
      const field = this.fields[index];
      if (field && !field.label) field.label = text;
    }
  }

  private uniqueSelector(tag: string, id: string, name: string): string {
    const count = (this.tagCounts.get(tag) ?? 0) + 1;
    this.tagCounts.set(tag, count);
    const base = id
      ? `${tag}#${id}`
      : name
        ? `${tag}[name="${name}"]`
        : `${tag}:nth-of-type(${count})`;
    let selector = base;
    for (let dup = 1; this.used.has(selector); dup += 1) selector = `${base}~${dup}`;
    this.used.add(selector);
    return selector;
  }

  /** Describes one control (never its value) and returns its selector. */
  private addField(tag: Tag, type: string): string {
    const { attrs } = tag;
    const id = cleanToken(attrs.get("id"));
    const selector = this.uniqueSelector(tag.name, id, cleanToken(attrs.get("name")));
    const isForm = type === "form";
    const explicit = cleanToken(attrs.get("form"));
    const form = isForm
      ? undefined
      : explicit
        ? `form#${explicit}`
        : this.forms[this.forms.length - 1];
    if (this.fields.length >= this.limits.maxFields) {
      this.truncated = true;
      if (isForm) this.overflowForms.add(selector);
      else if (form) this.overflowForms.add(form);
      return selector;
    }
    const field: PublicField = { selector, type };
    const autocomplete = shortText(attrs.get("autocomplete") ?? "", 60);
    if (autocomplete) field.autocomplete = autocomplete;
    const name = shortText(attrs.get("name") ?? "", 80);
    if (name) field.name = name;
    const label = shortText(
      attrs.get("aria-label") ?? attrs.get("title") ?? attrs.get("placeholder") ?? "",
      FIELD_TEXT_CHARS,
    );
    if (label) field.label = label;
    if (form) field.form = form;
    this.fields.push(field);
    this.fieldIds.push(id);
    if (!isForm) this.label?.fields.push(this.fields.length - 1);
    return selector;
  }
}

// ---------------------------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------------------------

function checkedUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PageSnapshotError("Invalid page URL");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new PageSnapshotError("Only credential-free HTTP(S) pages are supported");
  }
  url.hash = "";
  return url;
}

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

/**
 * Turns a fetched HTML snapshot (or already-extracted text) into a `PublicPage`: visible text and
 * control descriptions only. Pure and synchronous: no network, DOM, eval or timers.
 *
 * What it removes: script/style/template/noscript/svg/iframe/object/embed/canvas/head content,
 * comments, select options, form values, elements hidden by the `hidden` attribute, `aria-hidden`,
 * or an inline style (display, visibility, opacity, font-size, clipping, off-screen offsets, zero
 * size, transparent colour), and invisible/bidi/control characters.
 *
 * What it CANNOT see: CSS classes and external or `<style>` stylesheets, so text hidden through a
 * class is kept; white-on-white or low-contrast text; text covered by another element. Visible
 * attacker text is therefore always possible and must be treated as data by the consumer.
 */
export function readPageSnapshot(
  input: PageSnapshotInput,
  limits: PageSnapshotLimits = {},
): PageSnapshot {
  const url = checkedUrl(input.url);
  if ((input.html === undefined) === (input.text === undefined)) {
    throw new PageSnapshotError("Provide exactly one of html and text");
  }
  const resolved: Required<PageSnapshotLimits> = {
    maxChars: positive(limits.maxChars, MAX_PAGE_CHARS),
    maxBlockChars: positive(limits.maxBlockChars, DEFAULT_BLOCK_CHARS),
    maxInputChars: positive(limits.maxInputChars, DEFAULT_INPUT_CHARS),
    maxFields: positive(limits.maxFields, DEFAULT_MAX_FIELDS),
  };
  const source = input.html ?? input.text ?? "";
  const inputCut = source.length > resolved.maxInputChars;
  const clipped = inputCut ? source.slice(0, resolved.maxInputChars) : source;
  let text: string;
  let fields: PublicField[] = [];
  let truncated = inputCut;
  let removedHidden = 0;
  let removedScripts = 0;
  let htmlTitle: string | undefined;
  if (input.html !== undefined) {
    const walker = new Walker(clipped, url, resolved);
    walker.run();
    text = walker.out.finish();
    fields = walker.result();
    truncated = truncated || walker.truncated || walker.out.truncated;
    removedHidden = walker.removedHidden;
    removedScripts = walker.removedScripts;
    htmlTitle = walker.title;
  } else {
    const out = new TextOut(resolved.maxChars, resolved.maxBlockChars);
    let pos = 0;
    while (pos <= clipped.length && out.accepting) {
      const nl = clipped.indexOf("\n", pos);
      out.add(sanitizeText(clipped.slice(pos, nl < 0 ? clipped.length : nl)));
      out.breakBlock();
      if (nl < 0) break;
      pos = nl + 1;
    }
    text = out.finish();
    truncated = truncated || out.truncated || pos < clipped.length;
  }
  const title = shortText(input.title ?? htmlTitle ?? "", TITLE_CHARS);
  return {
    page: { url: url.href, title, text, fields },
    provenance: { origin: url.origin, truncated, removedHidden, removedScripts },
  };
}

/**
 * A `PageReader` over any source of snapshots (for example the Phase 93 browser once it can hand
 * over the loaded document). The source supplies the bytes; this class never fetches anything.
 */
export class SnapshotPageReader implements PageReader {
  /** Provenance of the most recent read. */
  lastProvenance: PageProvenance | undefined;

  constructor(
    private readonly source: (signal?: AbortSignal) => Promise<PageSnapshotInput>,
    private readonly limits: PageSnapshotLimits = {},
  ) {}

  async readPublicPage(signal?: AbortSignal): Promise<PublicPage> {
    const snapshot = readPageSnapshot(await this.source(signal), this.limits);
    this.lastProvenance = snapshot.provenance;
    return snapshot.page;
  }
}

// ---------------------------------------------------------------------------------------------
// Untrusted-content envelope
// ---------------------------------------------------------------------------------------------

const MARKER = "PHOENIX-UNTRUSTED-PAGE";
const NEUTRALISED = "PHOENIX_UNTRUSTED_PAGE";

export interface UntrustedEnvelope {
  nonce: string;
  begin: string;
  end: string;
  /** Marker lines around the content, which has had every marker-prefix occurrence neutralised. */
  text: string;
}

/**
 * Wraps page text in begin/end markers carrying a per-call random nonce. Content that mentions the
 * marker prefix (in any letter case) is rewritten so it cannot forge or close an envelope. The
 * envelope is a signal to the model, not a security boundary: the system prompt still has to say
 * that the content is data, and model output must never be turned into actions.
 */
export function wrapUntrustedPageText(
  text: string,
  options: { nonce?: string } = {},
): UntrustedEnvelope {
  const nonce = options.nonce ?? randomNonce();
  if (!/^[A-Za-z0-9]{8,64}$/.test(nonce)) throw new PageSnapshotError("Invalid envelope nonce");
  const lower = text.toLowerCase();
  const needle = MARKER.toLowerCase();
  let body = "";
  let last = 0;
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, last)) {
    body += text.slice(last, at) + NEUTRALISED;
    last = at + needle.length;
  }
  body += text.slice(last);
  const begin = `<<<${MARKER}-BEGIN ${nonce}>>>`;
  const end = `<<<${MARKER}-END ${nonce}>>>`;
  return { nonce, begin, end, text: `${begin}\n${body}\n${end}` };
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
