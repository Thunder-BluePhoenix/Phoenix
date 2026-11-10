// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  MAX_SELECTION,
  MAX_TITLE,
  buildPageMessage,
  cleanUrl,
  parsePageMessage,
} from "../src/page.js";

const BIDI = "\u202e\u2066\u200f";

describe("what the extension may send", () => {
  it("sends only http and https addresses: origin and path, no credentials, query or fragment", () => {
    expect(cleanUrl("https://example.com/a?b=1#frag")).toBe("https://example.com/a");
    expect(cleanUrl("https://example.com:8443/a/b?code=x&sid=y")).toBe(
      "https://example.com:8443/a/b",
    );
    expect(cleanUrl("http://example.com/")).toBe("http://example.com/");
    for (const bad of [
      "chrome://settings",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,hi",
      "https://user:pw@example.com/",
      "https://example.com/a b",
      "https://example.com/\u202e",
      "not an address",
      "",
      `https://example.com/${"a".repeat(2100)}`,
    ]) {
      expect(cleanUrl(bad), bad).toBeNull();
    }
    expect(cleanUrl(42)).toBeNull();
  });

  it("strips control and bidi characters from the title and clips it", () => {
    const built = buildPageMessage({
      url: "https://example.com/",
      title: `a${BIDI}\u0007\n\tb ${"x".repeat(500)}`,
    });
    expect(built.ok && built.message.title).toMatch(/^a b x+…$/);
    expect(built.ok && Array.from(built.message.title).length).toBe(MAX_TITLE);
    expect(built.ok && /[\u202e\u2066\u0007\n]/.test(built.message.title)).toBe(false);
  });

  it("includes the selection only when there is one, clipped and cleaned", () => {
    const none = buildPageMessage({
      url: "https://example.com/",
      title: "t",
      selection: "  \u202e ",
    });
    expect(none.ok && "selection" in none.message).toBe(false);
    const some = buildPageMessage({
      url: "https://example.com/",
      title: "t",
      selection: `line1\r\nline2${BIDI}\u0000${"y".repeat(3000)}`,
    });
    expect(some.ok && some.message.selection?.startsWith("line1\nline2yyy")).toBe(true);
    expect(some.ok && Array.from(some.message.selection ?? "").length).toBe(MAX_SELECTION);
  });

  it("refuses an unsupported page and names no other field", () => {
    expect(buildPageMessage({ url: "about:blank", title: "t" })).toEqual({
      ok: false,
      reason: "unsupported_page",
    });
    const built = buildPageMessage({ url: "https://example.com/", title: "t", selection: "s" });
    expect(built.ok && Object.keys(built.message).sort()).toEqual([
      "kind",
      "selection",
      "title",
      "url",
    ]);
  });
});

describe("the host's strict parse of a message", () => {
  const good = { kind: "page", url: "https://example.com/", title: "t" };
  it("accepts exactly what the extension builds", () => {
    expect(parsePageMessage(good)).toEqual(good);
    expect(parsePageMessage({ ...good, selection: "a\nb" })).toEqual({
      ...good,
      selection: "a\nb",
    });
  });
  it("refuses other kinds, extra keys, unclean text and wrong types", () => {
    for (const bad of [
      null,
      "page",
      [],
      { ...good, kind: "run" },
      { ...good, kind: undefined },
      { ...good, extra: 1 },
      { ...good, token: "x" },
      { ...good, __proto__x: 1 },
      { ...good, url: "javascript:1" },
      { ...good, url: "https://example.com/#frag" },
      { ...good, url: "https://example.com/?code=plain" },
      { ...good, title: `a${BIDI}` },
      { ...good, title: "x".repeat(300) },
      { ...good, title: 5 },
      { ...good, selection: "" },
      { ...good, selection: `a${BIDI}` },
      { ...good, selection: 5 },
    ]) {
      expect(parsePageMessage(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
