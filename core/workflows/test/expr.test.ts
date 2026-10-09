// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  evaluateCondition,
  ExprError,
  MAX_EXPR_DEPTH,
  parseExpression,
  parseTemplate,
  renderTemplate,
  type EvalContext,
} from "../src/expr";
import { LIMITS } from "../src/types";

const ctx: EvalContext = {
  event: {
    event_type: "deploy.failed",
    severity: "error",
    payload: { environment: "production", code: 2, tags: ["a", "b"], note: "Build FAILED badly" },
  },
  steps: { diag: { cause: "oom", count: 3 } },
  run: { id: "run_1" },
};
const check = (src: string) => evaluateCondition(parseExpression(src), ctx);

describe("expressions", () => {
  it("compares, combines and tests membership", () => {
    expect(check('event.payload.environment == "production"')).toBe(true);
    expect(check('event.payload.environment != "production"')).toBe(false);
    expect(check("event.payload.code >= 2 and steps.diag.count < 4")).toBe(true);
    expect(check('not (event.severity == "info") or false')).toBe(true);
    expect(check('event.severity in ["error", "warning"]')).toBe(true);
    expect(check('"b" in event.payload.tags')).toBe(true);
    expect(check('event.payload.tags contains "c"')).toBe(false);
    expect(check('event.payload.note icontains "failed"')).toBe(true);
    expect(check('event.payload.note contains "failed"')).toBe(false);
    expect(check('event.payload.tags[1] == "b"')).toBe(true);
  });

  it("treats missing paths as null and never as truthy", () => {
    expect(check("event.payload.nope == null")).toBe(true);
    expect(check("event.payload.nope")).toBe(false);
    expect(check("event.payload.environment")).toBe(false); // a string is not `true`
    expect(check("event.payload.code")).toBe(false);
    expect(check("event.payload.tags[99] == null")).toBe(true);
  });

  it("does not coerce between types", () => {
    expect(check('event.payload.code == "2"')).toBe(false);
    expect(check('event.payload.code < "3"')).toBe(false);
    expect(check("event.payload == event.payload")).toBe(false); // objects are never equal
  });

  it("only accepts the grammar", () => {
    for (const bad of [
      "event.payload.code + 1",
      "process.env",
      "globalThis",
      "this",
      "event.constructor",
      "event.__proto__",
      "event.payload.__proto__.polluted",
      "event['constructor']",
      "steps.diag.constructor.name",
      'event.payload.note.match("x")',
      "f(1)",
      "x = 1",
      "`${1}`",
      "event.payload.code ? 1 : 2",
      "/regex/.test(event.severity)",
      "event.payload.tags[-1]",
      "event.payload.tags[1.5]",
      "event.payload.tags[100000]",
      "((",
      "",
      "and",
      "event.severity ==",
      '"unterminated',
      '"bad \\x escape"',
      "1e5",
      "event..payload",
      "event.payload.",
      "a.b.c.d.e.f.g.h.i.j.k.l",
    ])
      expect(() => parseExpression(bad), bad).toThrow(ExprError);
  });

  it("reads nothing from strings, arrays or functions (no .length, no methods)", () => {
    expect(check("event.payload.environment.length == null")).toBe(true);
    expect(check("event.payload.tags.length == null")).toBe(true);
    expect(check("event.payload.tags.map == null")).toBe(true);
  });

  it("bounds depth, size and path length", () => {
    expect(() =>
      parseExpression("(".repeat(MAX_EXPR_DEPTH + 2) + "true" + ")".repeat(MAX_EXPR_DEPTH + 2)),
    ).toThrow(ExprError);
    expect(() => parseExpression("not ".repeat(MAX_EXPR_DEPTH + 2) + "true")).toThrow(ExprError);
    expect(() => parseExpression("true and ".repeat(100) + "true")).toThrow(ExprError);
    expect(() => parseExpression("a".repeat(LIMITS.maxExpressionLength + 1))).toThrow(ExprError);
    expect(() => parseExpression("[".repeat(500))).toThrow(ExprError);
  });

  it("does not walk the prototype chain through data", () => {
    const hostile: EvalContext = {
      event: JSON.parse('{"__proto__": {"polluted": true}, "constructor": {"name": "x"}}'),
      steps: {},
      run: {},
    };
    expect(evaluateCondition(parseExpression("event.polluted == true"), hostile)).toBe(false);
    expect(evaluateCondition(parseExpression("event.toString == null"), hostile)).toBe(true);
    expect(evaluateCondition(parseExpression("event.hasOwnProperty == null"), hostile)).toBe(true);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("is linear on ReDoS-shaped input", () => {
    const evil = "a".repeat(5000) + "!";
    const hostile: EvalContext = { event: { payload: { s: evil } }, steps: {}, run: {} };
    const started = performance.now();
    for (const src of [
      'event.payload.s contains "aaaaaaaaaaaaaaaa!x"',
      'event.payload.s icontains "(a+)+$"',
      'event.payload.s in "(a+)+$"',
    ])
      evaluateCondition(parseExpression(src), hostile);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("never executes code or reads other context, whatever it is fed (seeded fuzz)", () => {
    let seed = 1234567;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const atoms = [
      "event",
      "steps",
      "run",
      ".",
      "payload",
      "[",
      "]",
      "(",
      ")",
      '"',
      "'",
      "and",
      "or",
      "not",
      "in",
      "contains",
      "==",
      "!=",
      "<",
      ">",
      "1",
      "-",
      "null",
      "true",
      "__proto__",
      "constructor",
      "`",
      "${",
      "{",
      "}",
      ";",
      "=>",
      "process",
      "require",
      "import",
      "eval",
      "Function",
      "\\",
      "\n",
      " ",
      ",",
    ];
    const marker = globalThis as Record<string, unknown>;
    marker["__workflow_fuzz_hit"] = false;
    let parsed = 0;
    for (let i = 0; i < 4000; i++) {
      const src = Array.from({ length: 1 + rand(14) }, () => atoms[rand(atoms.length)]!).join(
        rand(2) ? " " : "",
      );
      try {
        const expr = parseExpression(src);
        parsed++;
        expect(typeof evaluateCondition(expr, ctx)).toBe("boolean");
      } catch (err) {
        expect(err).toBeInstanceOf(ExprError);
      }
    }
    expect(parsed).toBeGreaterThan(20);
    expect(marker["__workflow_fuzz_hit"]).toBe(false);
  });
});

describe("templates", () => {
  const render = (src: string, c: EvalContext = ctx) => renderTemplate(parseTemplate(src), c);

  it("substitutes paths and nothing else", () => {
    expect(render("env={{ event.payload.environment }} n={{steps.diag.count}} {{ run.id }}")).toBe(
      "env=production n=3 run_1",
    );
    expect(render("{{ event.payload.tags }}")).toBe('["a","b"]');
    expect(render("{{ event.payload.nope }}|")).toBe("|");
  });

  it("does not render rendered data again", () => {
    const c: EvalContext = {
      event: { payload: { evil: "{{ steps.secret.value }}" } },
      steps: { secret: { value: "TOP-SECRET" } },
      run: {},
    };
    expect(render("{{ event.payload.evil }}", c)).toBe("{{ steps.secret.value }}");
  });

  it("rejects anything but a plain path inside a placeholder", () => {
    for (const bad of [
      "{{ event.payload.code + 1 }}",
      "{{ constructor }}",
      "{{ event.__proto__ }}",
      "{{ event.payload.environment == 'x' }}",
      "{{ process.env.HOME }}",
      "{{ }}",
      "{{ event.payload",
      "{{ f() }}",
      "{{{{ event }}}}",
    ])
      expect(() => parseTemplate(bad), bad).toThrow(ExprError);
  });

  it("caps placeholders, template size and rendered size", () => {
    expect(() => parseTemplate("{{ run.id }}".repeat(LIMITS.maxPlaceholders + 1))).toThrow(
      ExprError,
    );
    expect(() => parseTemplate("x".repeat(LIMITS.maxTemplateLength + 1))).toThrow(ExprError);
    const big: EvalContext = { event: { payload: { s: "y".repeat(100_000) } }, steps: {}, run: {} };
    const out = render(
      "{{ event.payload.s }}{{ event.payload.s }}{{ event.payload.s }}{{ event.payload.s }}{{ event.payload.s }}",
      big,
    );
    expect(out.length).toBeLessThanOrEqual(4001);
  });
});
