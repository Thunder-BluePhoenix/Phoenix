// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The expression language of workflow conditions and templates. It is deliberately tiny and is
// NOT JavaScript: there is no `eval`, no `Function`, no function call, no assignment, no regular
// expression built from data, no string concatenation and no way to name anything but the context
// object's own data.
//
//   or      := and ("or" and)*
//   and     := not ("and" not)*
//   not     := "not" not | compare
//   compare := value (("==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "contains" | "icontains") value)?
//   value   := string | number | true | false | null | path | list | "(" or ")"
//   list    := "[" (value ("," value)*)? "]"
//   path    := root ("." name | "[" integer "]")*       root is event, steps or run
//
// Paths walk own, non-prototype properties of plain data only. A missing path is `null`.
import { LIMITS } from "./types";

export class ExprError extends Error {
  override name = "ExprError";
}

export const MAX_EXPR_DEPTH = 10;
export const MAX_EXPR_NODES = 80;
export const MAX_PATH_SEGMENTS = 8;
export const MAX_ARRAY_INDEX = 1000;
export const ROOTS: Readonly<Record<string, true>> = { event: true, steps: true, run: true };
const FORBIDDEN_NAMES: readonly string[] = [
  "__proto__",
  "constructor",
  "prototype",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
];

/** Names that reach into the prototype chain; never allowed as a path segment or JSON key. */
export const isForbiddenKey = (name: string): boolean => FORBIDDEN_NAMES.includes(name);

export type PathSegment = string | number;
export interface PathRef {
  root: string;
  segments: PathSegment[];
}

export type Expr =
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "list"; items: Expr[] }
  | { kind: "path"; path: PathRef }
  | { kind: "not"; operand: Expr }
  | { kind: "and" | "or"; left: Expr; right: Expr }
  | { kind: "compare"; op: CompareOp; left: Expr; right: Expr };

export type CompareOp = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "contains" | "icontains";

type Token =
  | { t: "string"; v: string }
  | { t: "number"; v: number }
  | { t: "name"; v: string }
  | { t: "op"; v: string }
  | { t: "end" };

const WORD_OPERATORS: Readonly<Record<string, true>> = {
  and: true,
  or: true,
  not: true,
  in: true,
  contains: true,
  icontains: true,
};

function tokenize(src: string): Token[] {
  if (typeof src !== "string") throw new ExprError("expression must be a string");
  if (src.length > LIMITS.maxExpressionLength)
    throw new ExprError(`expression is longer than ${LIMITS.maxExpressionLength} characters`);
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src.charAt(i);
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
    } else if (c === '"' || c === "'") {
      let out = "";
      let j = i + 1;
      for (;;) {
        if (j >= src.length) throw new ExprError("unterminated string");
        const d = src.charAt(j);
        if (d === c) break;
        if (d === "\\") {
          const e = src.charAt(j + 1);
          if (e === "n") out += "\n";
          else if (e === '"' || e === "'" || e === "\\") out += e;
          else throw new ExprError(`unsupported escape \\${e}`);
          j += 2;
        } else {
          out += d;
          j++;
        }
      }
      tokens.push({ t: "string", v: out });
      i = j + 1;
    } else if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(src.charAt(i + 1)))) {
      let j = i + 1;
      while (j < src.length && /[0-9.]/.test(src.charAt(j))) j++;
      const text = src.slice(i, j);
      const n = Number(text);
      if (!Number.isFinite(n) || !/^-?\d+(\.\d+)?$/.test(text))
        throw new ExprError(`bad number "${text}"`);
      tokens.push({ t: "number", v: n });
      i = j;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_]/.test(src.charAt(j))) j++;
      tokens.push({ t: "name", v: src.slice(i, j) });
      i = j;
    } else {
      const two = src.slice(i, i + 2);
      if (two === "==" || two === "!=" || two === "<=" || two === ">=") {
        tokens.push({ t: "op", v: two });
        i += 2;
      } else if ("<>()[].,".includes(c)) {
        tokens.push({ t: "op", v: c });
        i++;
      } else {
        throw new ExprError(`unexpected character "${c}"`);
      }
    }
    if (tokens.length > 4 * MAX_EXPR_NODES) throw new ExprError("expression is too long");
  }
  tokens.push({ t: "end" });
  return tokens;
}

class Parser {
  private pos = 0;
  private nodes = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Expr {
    const expr = this.or(0);
    if (this.peek().t !== "end") throw new ExprError("unexpected trailing input");
    return expr;
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? { t: "end" };
  }
  private next(): Token {
    const tok = this.peek();
    this.pos++;
    return tok;
  }
  private node<T extends Expr>(e: T, depth: number): T {
    if (depth > MAX_EXPR_DEPTH) throw new ExprError("expression is nested too deeply");
    if (++this.nodes > MAX_EXPR_NODES) throw new ExprError("expression has too many parts");
    return e;
  }
  private isWord(word: string): boolean {
    const tok = this.peek();
    return tok.t === "name" && tok.v === word;
  }
  private isOp(op: string): boolean {
    const tok = this.peek();
    return tok.t === "op" && tok.v === op;
  }

  private or(depth: number): Expr {
    let left = this.and(depth);
    while (this.isWord("or")) {
      this.next();
      left = this.node({ kind: "or", left, right: this.and(depth + 1) }, depth);
    }
    return left;
  }
  private and(depth: number): Expr {
    let left = this.not(depth);
    while (this.isWord("and")) {
      this.next();
      left = this.node({ kind: "and", left, right: this.not(depth + 1) }, depth);
    }
    return left;
  }
  private not(depth: number): Expr {
    if (this.isWord("not")) {
      this.next();
      return this.node({ kind: "not", operand: this.not(depth + 1) }, depth);
    }
    return this.compare(depth);
  }
  private compare(depth: number): Expr {
    const left = this.value(depth);
    const tok = this.peek();
    let op: CompareOp | undefined;
    if (tok.t === "op" && ["==", "!=", "<", "<=", ">", ">="].includes(tok.v))
      op = tok.v as CompareOp;
    else if (tok.t === "name" && (tok.v === "in" || tok.v === "contains" || tok.v === "icontains"))
      op = tok.v;
    if (op === undefined) return left;
    this.next();
    return this.node({ kind: "compare", op, left, right: this.value(depth + 1) }, depth);
  }
  private value(depth: number): Expr {
    const tok = this.next();
    if (tok.t === "string" || tok.t === "number")
      return this.node({ kind: "literal", value: tok.v }, depth);
    if (tok.t === "op" && tok.v === "(") {
      if (depth + 1 > MAX_EXPR_DEPTH) throw new ExprError("expression is nested too deeply");
      const inner = this.or(depth + 1);
      this.expectOp(")");
      return inner;
    }
    if (tok.t === "op" && tok.v === "[") {
      const items: Expr[] = [];
      if (!this.isOp("]")) {
        for (;;) {
          items.push(this.value(depth + 1));
          if (this.isOp(",")) this.next();
          else break;
        }
      }
      this.expectOp("]");
      return this.node({ kind: "list", items }, depth);
    }
    if (tok.t === "name") {
      if (tok.v === "true" || tok.v === "false")
        return this.node({ kind: "literal", value: tok.v === "true" }, depth);
      if (tok.v === "null") return this.node({ kind: "literal", value: null }, depth);
      if (WORD_OPERATORS[tok.v]) throw new ExprError(`unexpected "${tok.v}"`);
      return this.node({ kind: "path", path: this.pathAfter(tok.v) }, depth);
    }
    throw new ExprError("expected a value");
  }
  private expectOp(op: string): void {
    const tok = this.next();
    if (tok.t !== "op" || tok.v !== op) throw new ExprError(`expected "${op}"`);
  }
  private pathAfter(root: string): PathRef {
    if (ROOTS[root] !== true)
      throw new ExprError(`"${root}" is not available; use event, steps or run`);
    const segments: PathSegment[] = [];
    for (;;) {
      if (this.isOp(".")) {
        this.next();
        const name = this.next();
        if (name.t !== "name") throw new ExprError('expected a name after "."');
        if (isForbiddenKey(name.v)) throw new ExprError(`"${name.v}" is not allowed`);
        segments.push(name.v);
      } else if (this.isOp("[")) {
        this.next();
        const idx = this.next();
        if (idx.t !== "number" || !Number.isInteger(idx.v) || idx.v < 0 || idx.v > MAX_ARRAY_INDEX)
          throw new ExprError(`an index must be a whole number from 0 to ${MAX_ARRAY_INDEX}`);
        this.expectOp("]");
        segments.push(idx.v);
      } else {
        break;
      }
      if (segments.length > MAX_PATH_SEGMENTS) throw new ExprError("path is too long");
    }
    return { root, segments };
  }
}

/** Parses an expression. Throws `ExprError` with a message safe to show the author. */
export function parseExpression(src: string): Expr {
  return new Parser(tokenize(src)).parse();
}

/** Every path an expression reads, for load-time checks. */
export function expressionPaths(expr: Expr): PathRef[] {
  switch (expr.kind) {
    case "literal":
      return [];
    case "path":
      return [expr.path];
    case "list":
      return expr.items.flatMap(expressionPaths);
    case "not":
      return expressionPaths(expr.operand);
    default:
      return [...expressionPaths(expr.left), ...expressionPaths(expr.right)];
  }
}

// ── Evaluation ──────────────────────────────────────────────────────────────

export type Scalar = string | number | boolean | null;
export type Value = Scalar | Value[] | { [key: string]: Value };

/** What expressions and templates can see. Plain JSON data only. */
export interface EvalContext {
  event: unknown;
  steps: unknown;
  run: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Reads one path; anything missing, inherited or of the wrong shape is `null`. */
export function readPath(ctx: EvalContext, path: PathRef): unknown {
  let cur: unknown = Object.hasOwn(ctx, path.root) ? ctx[path.root as keyof EvalContext] : null;
  for (const seg of path.segments) {
    if (typeof seg === "number") {
      if (!Array.isArray(cur) || seg >= cur.length) return null;
      cur = cur[seg];
    } else {
      if (!isPlainObject(cur) || !Object.hasOwn(cur, seg)) return null;
      cur = cur[seg];
    }
  }
  return cur === undefined ? null : cur;
}

const isScalar = (v: unknown): v is Scalar =>
  v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

function equals(a: unknown, b: unknown): boolean {
  return isScalar(a) && isScalar(b) && a === b;
}

function evalNode(expr: Expr, ctx: EvalContext): unknown {
  switch (expr.kind) {
    case "literal":
      return expr.value;
    case "path":
      return readPath(ctx, expr.path);
    case "list":
      return expr.items.map((i) => evalNode(i, ctx));
    case "not":
      return !isTrue(evalNode(expr.operand, ctx));
    case "and":
      return isTrue(evalNode(expr.left, ctx)) && isTrue(evalNode(expr.right, ctx));
    case "or":
      return isTrue(evalNode(expr.left, ctx)) || isTrue(evalNode(expr.right, ctx));
    case "compare":
      return compare(expr.op, evalNode(expr.left, ctx), evalNode(expr.right, ctx));
  }
}

/** Only the boolean `true` is true. Strings, numbers and objects are never "truthy". */
const isTrue = (v: unknown): boolean => v === true;

function compare(op: CompareOp, a: unknown, b: unknown): boolean {
  switch (op) {
    case "==":
      return equals(a, b);
    case "!=":
      return !equals(a, b);
    case "<":
    case "<=":
    case ">":
    case ">=": {
      const comparable =
        (typeof a === "number" && typeof b === "number") ||
        (typeof a === "string" && typeof b === "string");
      if (!comparable) return false;
      if (op === "<") return a < b;
      if (op === "<=") return a <= b;
      if (op === ">") return a > b;
      return a >= b;
    }
    case "in":
      if (Array.isArray(b)) return b.some((x) => equals(a, x));
      return typeof a === "string" && typeof b === "string" && b.includes(a);
    case "contains":
      if (Array.isArray(a)) return a.some((x) => equals(x, b));
      return typeof a === "string" && typeof b === "string" && a.includes(b);
    case "icontains":
      return (
        typeof a === "string" && typeof b === "string" && a.toLowerCase().includes(b.toLowerCase())
      );
  }
}

/** Evaluates to a boolean. Never throws and never has a side effect. */
export function evaluateCondition(expr: Expr, ctx: EvalContext): boolean {
  return isTrue(evalNode(expr, ctx));
}

// ── Templates ───────────────────────────────────────────────────────────────

export type TemplatePart = string | PathRef;
export const MAX_RENDERED_VALUE = 1000;
export const MAX_RENDERED_TEMPLATE = 4000;

/** Parses `text {{ event.payload.name }} more` into literal parts and paths. */
export function parseTemplate(src: string): TemplatePart[] {
  if (typeof src !== "string") throw new ExprError("template must be a string");
  if (src.length > LIMITS.maxTemplateLength)
    throw new ExprError(`template is longer than ${LIMITS.maxTemplateLength} characters`);
  const parts: TemplatePart[] = [];
  let i = 0;
  let placeholders = 0;
  while (i < src.length) {
    const open = src.indexOf("{{", i);
    if (open === -1) {
      parts.push(src.slice(i));
      break;
    }
    if (open > i) parts.push(src.slice(i, open));
    const close = src.indexOf("}}", open + 2);
    if (close === -1) throw new ExprError('"{{" is never closed');
    if (++placeholders > LIMITS.maxPlaceholders)
      throw new ExprError(`more than ${LIMITS.maxPlaceholders} placeholders`);
    const inner = src.slice(open + 2, close).trim();
    const tokens = tokenize(inner);
    const first = tokens[0];
    if (first?.t !== "name") throw new ExprError("a placeholder must be a path");
    const parser = new Parser(tokens);
    const expr = parser.parse();
    if (expr.kind !== "path") throw new ExprError("a placeholder must be a path, nothing else");
    parts.push(expr.path);
    i = close + 2;
  }
  return parts;
}

/** Text of a value as shown in a template: scalars as text, structures as capped JSON. */
export function displayValue(v: unknown): string {
  let out: string;
  if (v === null || v === undefined) out = "";
  else if (typeof v === "string") out = v;
  else if (typeof v === "number" || typeof v === "boolean") out = String(v);
  else {
    try {
      out = JSON.stringify(v) ?? "";
    } catch {
      out = "";
    }
  }
  return out.length > MAX_RENDERED_VALUE ? `${out.slice(0, MAX_RENDERED_VALUE)}…` : out;
}

/**
 * Renders in a single pass. Rendered values are never scanned again, so data containing `{{ }}`
 * stays text. The result is capped.
 */
export function renderTemplate(parts: readonly TemplatePart[], ctx: EvalContext): string {
  let out = "";
  for (const part of parts) {
    out += typeof part === "string" ? part : displayValue(readPath(ctx, part));
    if (out.length > MAX_RENDERED_TEMPLATE) return `${out.slice(0, MAX_RENDERED_TEMPLATE)}…`;
  }
  return out;
}

/** Paths a template reads, for load-time checks. */
export const templatePaths = (parts: readonly TemplatePart[]): PathRef[] =>
  parts.filter((p): p is PathRef => typeof p !== "string");
