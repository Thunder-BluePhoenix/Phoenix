// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { browserCard, escapeTypedText, hostAndPath } from "../src";

const input = (over: Record<string, unknown>) => ({
  confirm_input: { pageUrl: "https://shop.test/cart?session=abc#frag", ...over },
});

describe("browserCard", () => {
  it("shows host and path only, never the query, fragment or credentials", () => {
    expect(browserCard("click", input({ selector: "button#go" }))).toEqual({
      kind: "click",
      pageUrl: "shop.test/cart",
      selector: "button#go",
    });
    expect(hostAndPath("https://u:p@shop.test/")).toBeNull();
    expect(hostAndPath("javascript:alert(1)")).toBeNull();
    expect(hostAndPath("https://shop.test:8443/a/b?x=1")).toEqual({
      shown: "shop.test:8443/a/b",
      hadQuery: true,
    });
  });

  it("carries the full typed text, with invisible characters escaped and nothing cut", () => {
    const text = "a\nb\t\u202e\u200b" + "z".repeat(4000);
    const card = browserCard("type", input({ selector: "input#q", text }));
    expect(card).toMatchObject({ kind: "type", selector: "input#q", textLength: text.length });
    expect(card?.text).toBe("a\\nb\\t\\u{202E}\\u{200B}" + "z".repeat(4000));
    expect(escapeTypedText("\\n")).toBe("\\\\n");
  });

  it("describes a navigation by destination and says when a query is hidden", () => {
    expect(browserCard("navigate", input({ destination: "https://shop.test/pay?card=1" }))).toEqual(
      {
        kind: "navigate",
        pageUrl: "shop.test/cart",
        destination: "shop.test/pay",
        queryHidden: true,
      },
    );
  });

  it("returns nothing for anything that is not exactly what the capability sends", () => {
    expect(browserCard("click", input({ selector: "body" }))).toBeUndefined();
    expect(browserCard("click", input({ selector: "input#a, input#b" }))).toBeUndefined();
    expect(browserCard("type", input({ selector: "input#q" }))).toBeUndefined();
    expect(
      browserCard("type", input({ selector: "input#q", text: "x".repeat(4097) })),
    ).toBeUndefined();
    expect(browserCard("navigate", input({ destination: "file:///etc/passwd" }))).toBeUndefined();
    expect(browserCard("delete", input({ selector: "button#x" }))).toBeUndefined();
    expect(browserCard("click", { confirm_input: { selector: "button#x" } })).toBeUndefined();
    expect(browserCard("click", undefined)).toBeUndefined();
  });
});

describe("PermissionGateway", () => {
  it("never puts a browser action to the user that its card cannot describe", async () => {
    const { createHarness } = await import("../../../sdk/testing/src");
    const h = createHarness();
    try {
      await expect(
        h.permissions.authorize({
          capabilityId: "browser",
          command: "click",
          permissions: [],
          sideEffect: "external",
          summary: "x",
          details: { confirm_input: { pageUrl: "https://a.test/", selector: "body" } },
        }),
      ).rejects.toThrow("cannot be described");
      expect(h.permissions.pendingConfirmations()).toEqual([]);
    } finally {
      h.close();
    }
  });
});
