// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { redact } from "@phoenix/logging";
import { boundValue } from "./bound";
import {
  parseExpression,
  parseTemplate,
  readPath,
  renderTemplate,
  type EvalContext,
  type Expr,
  type TemplatePart,
  type Value,
} from "./expr";

const COMPILED_LIMIT = 500;
const expressions = new Map<string, Expr>();
const templates = new Map<string, TemplatePart[]>();

/** Parsed expression, cached by source text (the sources come from validated definitions). */
export function compiledExpression(src: string): Expr {
  let hit = expressions.get(src);
  if (!hit) {
    hit = parseExpression(src);
    if (expressions.size >= COMPILED_LIMIT) expressions.clear();
    expressions.set(src, hit);
  }
  return hit;
}

export function compiledTemplate(src: string): TemplatePart[] {
  let hit = templates.get(src);
  if (!hit) {
    hit = parseTemplate(src);
    if (templates.size >= COMPILED_LIMIT) templates.clear();
    templates.set(src, hit);
  }
  return hit;
}

/** Renders a template and redacts credential-shaped text from the result. */
export function renderText(src: string, ctx: EvalContext): string {
  return redact(renderTemplate(compiledTemplate(src), ctx)) as string;
}

/**
 * Renders the strings inside a JSON input. A string that is exactly one placeholder keeps the
 * scalar type of what it points at (a number stays a number); any other string is rendered as
 * text. Keys are never templated, and rendered values are never rendered again.
 */
export function renderInput(value: unknown, ctx: EvalContext, depth = 0): Value {
  if (depth > 8) return null;
  if (typeof value === "string") {
    const parts = compiledTemplate(value);
    const only = parts.length === 1 ? parts[0] : undefined;
    if (only !== undefined && typeof only !== "string") {
      const raw = readPath(ctx, only);
      if (typeof raw === "number" || typeof raw === "boolean") return raw;
    }
    return redact(renderTemplate(parts, ctx)) as string;
  }
  if (Array.isArray(value)) return value.map((v: unknown) => renderInput(v, ctx, depth + 1));
  if (value !== null && typeof value === "object") {
    const out: { [key: string]: Value } = {};
    for (const [k, v] of Object.entries(value)) out[k] = renderInput(v, ctx, depth + 1);
    return out;
  }
  return boundValue(value);
}
