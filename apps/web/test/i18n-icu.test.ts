// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { formatMessage, mapMessageText, messageVariables } from "../src/i18n/icu";

const ITEMS =
  "{count, plural, zero {no items} one {# item} two {a pair} few {# few items} many {# many items} other {# items}}";
const f = (message: string, vars: Record<string, string | number>, locale = "en") =>
  formatMessage(message, vars, locale);

describe("plural categories (Intl.PluralRules)", () => {
  it("English: one / other, and an exact =0 beats the category", () => {
    expect(f(ITEMS, { count: 1 })).toBe("1 item");
    expect(f(ITEMS, { count: 2 })).toBe("2 items");
    expect(f(ITEMS, { count: 0 })).toBe("0 items");
    expect(f("{n, plural, =0 {nothing} one {# file} other {# files}}", { n: 0 })).toBe("nothing");
    expect(f("{n, plural, =0 {nothing} one {# file} other {# files}}", { n: 1 })).toBe("1 file");
  });

  it("Arabic: zero, one, two, few, many and other all pick their own branch", () => {
    const pick = (n: number) => f(ITEMS, { count: n }, "ar");
    expect(pick(0)).toBe("no items");
    expect(pick(1)).toMatch(/1|١/);
    expect(pick(2)).toBe("a pair");
    expect(pick(3)).toContain("few");
    expect(pick(11)).toContain("many");
    expect(pick(100)).not.toContain("few");
    expect(pick(100)).not.toContain("many");
    expect(pick(100)).toContain("items");
  });

  it("Russian: one (21), few (22), many (25) and other (1.5)", () => {
    const pick = (n: number) => f(ITEMS, { count: n }, "ru");
    expect(pick(21)).toContain("item");
    expect(pick(21)).not.toContain("items");
    expect(pick(22)).toContain("few");
    expect(pick(25)).toContain("many");
    expect(pick(1.5)).toContain("items");
    expect(pick(11)).toContain("many");
  });

  it("Chinese has no plural forms: every number takes other", () => {
    expect(f(ITEMS, { count: 1 }, "zh")).toMatch(/^1 items$/);
    expect(f(ITEMS, { count: 5 }, "zh")).toBe("5 items");
  });

  it("# is formatted for the language (digits and grouping)", () => {
    expect(f("{n, plural, other {# files}}", { n: 1234567 }, "en")).toBe("1,234,567 files");
    expect(f("{n, plural, other {# files}}", { n: 1234567 }, "de")).toBe("1.234.567 files");
  });

  it("plurals nest a variable and another plural", () => {
    const m = "{n, plural, one {{who} has # task} other {{who} has # tasks}}";
    expect(f(m, { n: 1, who: "Fawkes" })).toBe("Fawkes has 1 task");
    expect(f(m, { n: 3, who: "Fawkes" })).toBe("Fawkes has 3 tasks");
  });
});

describe("interpolation safety", () => {
  it("a value containing braces or ICU syntax is shown as text, never re-parsed", () => {
    expect(f("Hello {name}!", { name: "{x}" })).toBe("Hello {x}!");
    expect(f("Hello {name}, {other}", { name: "{other}", other: "second" })).toBe(
      "Hello {other}, second",
    );
    expect(f("{name}", { name: "{n, plural, other {gotcha}}" })).toBe(
      "{n, plural, other {gotcha}}",
    );
    expect(f("{n, plural, other {# {who}}}", { n: 2, who: "#" })).toBe("2 #");
  });

  it("HTML in a value stays a string (React escapes it when rendering)", () => {
    expect(f("By {who}", { who: '<img src=x onerror="alert(1)">' })).toBe(
      'By <img src=x onerror="alert(1)">',
    );
  });

  it("a variable that was not supplied renders literally", () => {
    expect(f("Hi {name}", {})).toBe("Hi {name}");
    expect(f("{n, plural, one {# a} other {# b}}", {})).toBe("{n}");
    expect(f("{n, plural, one {# a} other {# b}}", { n: "3" })).toBe("{n}");
  });

  it("names like constructor or __proto__ are not looked up on the prototype", () => {
    expect(f("{constructor} {toString} {__proto__}", {})).toBe(
      "{constructor} {toString} {__proto__}",
    );
  });

  it("apostrophes: quoted braces, doubled apostrophes and plain apostrophes", () => {
    expect(f("Use '{name}' literally", { name: "x" })).toBe("Use {name} literally");
    expect(f("It''s {name}", { name: "x" })).toBe("It's x");
    expect(f("Fawkes' state of {name}", { name: "x" })).toBe("Fawkes' state of x");
    expect(f("{n, plural, other {'#' is # }}", { n: 2 })).toBe("# is 2 ");
  });

  it("# outside a plural is just a #", () => {
    expect(f("Item #{n}", { n: 3 })).toBe("Item #3");
  });

  it("a malformed message is shown as written instead of throwing", () => {
    for (const bad of [
      "{unclosed",
      "stray }",
      "{n, plural, one {x}}",
      "{n, select, a {b} other {c}}",
    ]) {
      expect(f(bad, { n: 1 })).toBe(bad);
    }
  });

  it("nesting is bounded", () => {
    const deep = "{n, plural, other {".repeat(30) + "x" + "}}".repeat(30);
    expect(f(deep, { n: 1 })).toBe(deep);
  });
});

describe("message tools", () => {
  it("messageVariables lists what a message needs, and null when it is malformed", () => {
    expect(messageVariables("{b} and {a} {n, plural, one {# x} other {{c}}}")).toEqual([
      "a",
      "b",
      "c",
      "n",
    ]);
    expect(messageVariables("{oops")).toBeNull();
  });

  it("mapMessageText changes only literal text and keeps the message valid", () => {
    const upper = (s: string) => s.toUpperCase();
    const out = mapMessageText(
      "Hi {name}, you have {n, plural, one {# task} other {# tasks}}",
      upper,
    );
    expect(out).toBe("HI {name}, YOU HAVE {n, plural, one {# TASK} other {# TASKS}}");
    expect(f(out, { name: "bo", n: 2 })).toBe("HI bo, YOU HAVE 2 TASKS");
    expect(f(mapMessageText("Don't use '{x}'", upper), {})).toBe("DON'T USE {X}");
  });
});
