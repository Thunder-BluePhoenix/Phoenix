// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What a card may show: a short sanitized title, never hidden characters, key-shaped runs, the
// preview or a hash; and what a digest may count.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cardView,
  digestText,
  HIDDEN_TEXT_CHARS,
  sanitizeText,
  TITLE_CHARS,
  withoutMarkup,
} from "../src";
import type { ApprovalSnapshot } from "../src";

const snap = (over: Partial<ApprovalSnapshot> = {}): ApprovalSnapshot => ({
  source: "agent",
  id: "a",
  tool: "Bash",
  title: "npm test",
  project: "alpha",
  request_hash: "0".repeat(64),
  expires_at: "2026-10-22T09:02:00.000Z",
  ...over,
});

describe("sanitizeText", () => {
  it("pins the hidden-character pattern to the one Core uses", () => {
    const core = readFileSync(
      new URL("../../../core/runtime/src/agent-approvals.ts", import.meta.url),
      "utf8",
    );
    expect(core).toContain(`export const HIDDEN_TEXT_CHARS = ${HIDDEN_TEXT_CHARS};`);
  });

  it("replaces control, bidi, zero-width and line-separator characters", () => {
    const hostile = "ls\u202Efdp.exe\u200B\u0000\u2028done\u061C";
    const out = sanitizeText(hostile, 80);
    expect(HIDDEN_TEXT_CHARS.test(out)).toBe(false);
    expect(out).toBe("ls fdp.exe done");
  });

  it("clips by code point and never splits a surrogate pair", () => {
    const out = sanitizeText("😀".repeat(200), TITLE_CHARS);
    expect(Array.from(out)).toHaveLength(TITLE_CHARS);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/[\uD800-\uDFFF]/u);
  });

  it("drops key-shaped runs and bearer values", () => {
    const run = "a1B2".repeat(12);
    expect(sanitizeText(`curl -H Authorization: Bearer ${run} ${run}`, 200)).not.toContain(
      "a1B2a1B2",
    );
    expect(sanitizeText("echo", 10)).toBe("echo");
    expect(sanitizeText(42, 10)).toBe("");
  });

  it("strips markup and mention characters for Discord and Teams", () => {
    expect(withoutMarkup("@everyone <@1> **bold** [x](http://e) `c`")).not.toMatch(/[@<>*[\]()`]/);
  });
});

describe("cardView", () => {
  it("carries title, tool, project and expiry only", () => {
    const view = cardView(snap({ title: `${"word ".repeat(100)}` }));
    expect(Object.keys(view).sort()).toEqual(["expires", "project", "title", "tool"]);
    expect(Array.from(view.title).length).toBeLessThanOrEqual(TITLE_CHARS);
    expect(JSON.stringify(view)).not.toContain("0".repeat(64));
  });

  it("falls back for an empty title and an unparsable expiry", () => {
    const view = cardView(snap({ title: "\u200B\u200B", expires_at: "soon" }));
    expect(view.title).toBe("Approval request");
    expect(view.expires).toBe("unknown");
  });
});

describe("digestText", () => {
  it("counts everything and names only projects switched on", () => {
    const text = digestText({
      pending: [snap(), snap({ id: "b" }), snap({ id: "c", project: "secret-repo" })],
      allowed: (s) => s.project === "alpha",
    });
    expect(text).toContain("3 approvals");
    expect(text).toContain("2 in alpha");
    expect(text).toContain("1 other");
    expect(text).not.toContain("secret-repo");
    expect(text).not.toContain("npm test");
  });

  it("says so when nothing waits", () => {
    expect(digestText({ pending: [], allowed: () => true })).toContain("nothing is waiting");
  });
});
