// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { epochMs, expectArray, expectObject, httpsUrl, int, num, parseList, str } from "../src";

describe("str", () => {
  it("clips, trims and strips control and bidi-override characters", () => {
    expect(str("  hello\u0000world\u202e  ")).toBe("hello world");
    expect(str("x".repeat(500), 10)).toBe("xxxxxxxxxx");
  });

  it("returns undefined for non-strings and blanks", () => {
    expect(str(12)).toBeUndefined();
    expect(str("   ")).toBeUndefined();
    expect(str(null)).toBeUndefined();
  });
});

describe("num and int", () => {
  it("accepts only real numbers", () => {
    expect(num(1.5)).toBe(1.5);
    expect(num("1")).toBeUndefined();
    expect(num(Number.NaN)).toBeUndefined();
    expect(num(Infinity)).toBeUndefined();
    expect(int(3)).toBe(3);
    expect(int(3.5)).toBeUndefined();
    expect(int(2 ** 60)).toBeUndefined();
  });
});

describe("httpsUrl", () => {
  it("keeps https links and drops everything else", () => {
    expect(httpsUrl("https://example.com/a")).toBe("https://example.com/a");
    for (const bad of [
      "http://example.com",
      "javascript:alert(1)",
      "data:text/html,x",
      "https://u:p@example.com",
      "//example.com",
      42,
      `https://example.com/${"a".repeat(2100)}`,
    ]) {
      expect(httpsUrl(bad)).toBeUndefined();
    }
  });
});

describe("epochMs", () => {
  it("reads ISO strings and epoch seconds or milliseconds", () => {
    expect(epochMs("2026-01-02T03:04:05Z")).toBe(Date.parse("2026-01-02T03:04:05Z"));
    expect(epochMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(epochMs(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it("rejects garbage and negatives", () => {
    expect(epochMs("not a date")).toBeUndefined();
    expect(epochMs(-5)).toBeUndefined();
    expect(epochMs({})).toBeUndefined();
  });
});

describe("parseList", () => {
  it("skips entries that are not objects or that the parser rejects or throws on", () => {
    const out = parseList(
      [{ id: 1 }, "x", null, { id: "bad" }, { id: 2 }, { boom: true }],
      (item) => {
        if (item.boom) throw new Error("malformed");
        return typeof item.id === "number" ? item.id : undefined;
      },
    );
    expect(out).toEqual([1, 2]);
  });

  it("stops at the cap", () => {
    const items = Array.from({ length: 300 }, (_, id) => ({ id }));
    expect(parseList(items, (i) => i.id, 50)).toHaveLength(50);
  });

  it("throws when the top level is not an array", () => {
    expect(() => parseList({ not: "array" }, () => 1)).toThrow();
  });
});

describe("expect helpers", () => {
  it("reject the wrong container type", () => {
    expect(() => expectObject([])).toThrow();
    expect(() => expectObject(null)).toThrow();
    expect(() => expectArray({})).toThrow();
    expect(expectObject({ a: 1 })).toEqual({ a: 1 });
  });
});
