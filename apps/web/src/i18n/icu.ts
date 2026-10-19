// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A small ICU MessageFormat subset: `{name}` and
// `{count, plural, =0 {..} zero {..} one {..} two {..} few {..} many {..} other {..}}` with `#` for
// the (locale-formatted) number inside a branch.
//
// Messages are parsed once into a tree; values are only ever substituted into the output string, and
// never parsed again, so a value that contains `{x}`, `#` or HTML is shown as plain text. Nothing is
// evaluated. A variable that was not supplied renders literally as `{name}`.
//
// Quoting follows ICU: `''` is an apostrophe; an apostrophe before `{`, `}` (or `#` inside a plural
// branch) quotes everything up to the next apostrophe. Any other apostrophe is itself ("Fawkes' state").

export type Vars = Readonly<Record<string, string | number>>;

type IcuNode =
  | { kind: "text"; value: string }
  | { kind: "var"; name: string }
  | { kind: "pound" }
  | { kind: "plural"; name: string; branches: ReadonlyMap<string, readonly IcuNode[]> };

const MAX_DEPTH = 8;
const NAME = /[A-Za-z0-9_.-]/;

class IcuSyntaxError extends Error {}

class Parser {
  private i = 0;
  constructor(private readonly src: string) {}

  parse(): IcuNode[] {
    const nodes = this.nodes(0, false);
    if (this.i < this.src.length) throw new IcuSyntaxError("unbalanced }");
    return nodes;
  }

  /** Nodes up to an unquoted `}` (not consumed) or the end of the message. */
  private nodes(depth: number, inPlural: boolean): IcuNode[] {
    if (depth > MAX_DEPTH) throw new IcuSyntaxError("too deeply nested");
    const out: IcuNode[] = [];
    let text = "";
    const flush = () => {
      if (text) out.push({ kind: "text", value: text });
      text = "";
    };
    while (this.i < this.src.length) {
      const c = this.src[this.i]!;
      if (c === "}") break;
      if (c === "'") {
        const next = this.src[this.i + 1];
        if (next === "'") {
          text += "'";
          this.i += 2;
        } else if (next === "{" || next === "}" || (inPlural && next === "#")) {
          this.i += 1;
          text += this.quoted();
        } else {
          text += "'";
          this.i += 1;
        }
      } else if (c === "{") {
        flush();
        out.push(this.argument(depth));
      } else if (c === "#" && inPlural) {
        flush();
        out.push({ kind: "pound" });
        this.i += 1;
      } else {
        text += c;
        this.i += 1;
      }
    }
    flush();
    return out;
  }

  /** After an opening apostrophe: literal text up to the closing one (`''` inside is one `'`). */
  private quoted(): string {
    let text = "";
    while (this.i < this.src.length) {
      const c = this.src[this.i]!;
      if (c === "'") {
        if (this.src[this.i + 1] === "'") {
          text += "'";
          this.i += 2;
          continue;
        }
        this.i += 1;
        return text;
      }
      text += c;
      this.i += 1;
    }
    return text;
  }

  private space(): void {
    while (this.i < this.src.length && /\s/.test(this.src[this.i]!)) this.i += 1;
  }

  private word(): string {
    const start = this.i;
    while (this.i < this.src.length && NAME.test(this.src[this.i]!)) this.i += 1;
    if (this.i === start) throw new IcuSyntaxError("a name was expected");
    return this.src.slice(start, this.i);
  }

  private expect(c: string): void {
    if (this.src[this.i] !== c) throw new IcuSyntaxError(`"${c}" was expected`);
    this.i += 1;
  }

  /** `{name}` or `{name, plural, ...}`; the cursor is on the `{`. */
  private argument(depth: number): IcuNode {
    this.expect("{");
    this.space();
    const name = this.word();
    this.space();
    if (this.src[this.i] === "}") {
      this.i += 1;
      return { kind: "var", name };
    }
    this.expect(",");
    this.space();
    if (this.word() !== "plural") throw new IcuSyntaxError("only plural is supported");
    this.space();
    this.expect(",");
    const branches = new Map<string, readonly IcuNode[]>();
    for (;;) {
      this.space();
      if (this.src[this.i] === "}") break;
      const selector = this.selector();
      this.space();
      this.expect("{");
      branches.set(selector, this.nodes(depth + 1, true));
      this.expect("}");
    }
    this.expect("}");
    if (!branches.has("other")) throw new IcuSyntaxError('a plural needs an "other" branch');
    return { kind: "plural", name, branches };
  }

  private selector(): string {
    if (this.src[this.i] === "=") {
      this.i += 1;
      const start = this.i;
      while (this.i < this.src.length && /\d/.test(this.src[this.i]!)) this.i += 1;
      if (this.i === start) throw new IcuSyntaxError("a number was expected after =");
      return `=${this.src.slice(start, this.i)}`;
    }
    return this.word();
  }
}

const compiled = new Map<string, readonly IcuNode[]>();

/** The tree of a message; a malformed message is shown as written rather than throwing. */
function compile(message: string): readonly IcuNode[] {
  const hit = compiled.get(message);
  if (hit) return hit;
  let nodes: readonly IcuNode[];
  try {
    nodes = new Parser(message).parse();
  } catch (err) {
    if (!(err instanceof IcuSyntaxError)) throw err;
    nodes = [{ kind: "text", value: message }];
  }
  compiled.set(message, nodes);
  return nodes;
}

const pluralRules = new Map<string, Intl.PluralRules>();
const numberFormats = new Map<string, Intl.NumberFormat>();

function pluralCategory(locale: string, n: number): Intl.LDMLPluralRule {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules.select(n);
}

function formatPound(locale: string, n: number): string {
  let nf = numberFormats.get(locale);
  if (!nf) {
    nf = new Intl.NumberFormat(locale);
    numberFormats.set(locale, nf);
  }
  return nf.format(n);
}

type Values<T> = Readonly<Record<string, string | number | T>>;

function render<T>(
  nodes: readonly IcuNode[],
  vars: Values<T>,
  locale: string,
  count: number | null,
  out: (string | T)[],
): void {
  const text = (s: string) => {
    const last = out.length - 1;
    const prev = out[last];
    if (typeof prev === "string") out[last] = prev + s;
    else out.push(s);
  };
  for (const node of nodes) {
    if (node.kind === "text") text(node.value);
    else if (node.kind === "pound") text(count === null ? "#" : formatPound(locale, count));
    else if (node.kind === "var") {
      if (!Object.hasOwn(vars, node.name)) text(`{${node.name}}`);
      else {
        const value = vars[node.name]!;
        if (typeof value === "string" || typeof value === "number") text(String(value));
        else out.push(value);
      }
    } else {
      const value = Object.hasOwn(vars, node.name) ? vars[node.name] : undefined;
      if (typeof value !== "number" || !Number.isFinite(value)) {
        text(`{${node.name}}`);
        continue;
      }
      const branch =
        node.branches.get(`=${value}`) ??
        node.branches.get(pluralCategory(locale, value)) ??
        node.branches.get("other")!;
      render(branch, vars, locale, value, out);
    }
  }
}

/** Formats an ICU-subset message for `locale` (an `Intl` tag). */
export function formatMessage(message: string, vars: Vars, locale: string): string {
  return formatParts<never>(message, vars, locale).join("");
}

/**
 * Like `formatMessage`, but a variable whose value is neither a string nor a number (a React
 * element, say) is passed through as its own part, so a message can wrap part of its text in markup
 * without the markup living in the translation. Strings between parts are merged.
 */
export function formatParts<T>(message: string, vars: Values<T>, locale: string): (string | T)[] {
  const out: (string | T)[] = [];
  render(compile(message), vars, locale, null, out);
  return out;
}

/** The variable names a message uses, sorted; null when the message is malformed. */
export function messageVariables(message: string): string[] | null {
  let nodes: readonly IcuNode[];
  try {
    nodes = new Parser(message).parse();
  } catch (err) {
    if (err instanceof IcuSyntaxError) return null;
    throw err;
  }
  const names = new Set<string>();
  const walk = (list: readonly IcuNode[]) => {
    for (const node of list) {
      if (node.kind === "var") names.add(node.name);
      else if (node.kind === "plural") {
        names.add(node.name);
        for (const body of node.branches.values()) walk(body);
      }
    }
  };
  walk(nodes);
  return [...names].sort();
}

/** Text as message source: braces (and `#` in a plural branch) quoted, apostrophes doubled. */
function escapeText(text: string, inPlural: boolean): string {
  const special = inPlural ? "{}#" : "{}";
  let out = "";
  let quoting = false;
  for (const c of text) {
    if (special.includes(c)) {
      if (!quoting) out += "'";
      quoting = true;
      out += c;
    } else if (c === "'") {
      out += "''";
    } else {
      if (quoting) out += "'";
      quoting = false;
      out += c;
    }
  }
  return quoting ? `${out}'` : out;
}

function serializeNodes(
  nodes: readonly IcuNode[],
  mapText: (text: string) => string,
  inPlural: boolean,
): string {
  let out = "";
  for (const node of nodes) {
    if (node.kind === "text") out += escapeText(mapText(node.value), inPlural);
    else if (node.kind === "pound") out += "#";
    else if (node.kind === "var") out += `{${node.name}}`;
    else {
      const branches = [...node.branches]
        .map(([selector, body]) => `${selector} {${serializeNodes(body, mapText, true)}}`)
        .join(" ");
      out += `{${node.name}, plural, ${branches}}`;
    }
  }
  return out;
}

/**
 * Rewrites only the literal text of a message, leaving variables, plural structure and `#` alone,
 * and returns the result as a message again. Used to build the pseudo-locale.
 */
export function mapMessageText(message: string, mapText: (text: string) => string): string {
  return serializeNodes(compile(message), mapText, false);
}
