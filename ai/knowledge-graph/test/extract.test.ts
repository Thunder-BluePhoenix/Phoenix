// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { MAX_MENTIONS, MAX_SCAN_CHARS, extractMentions, type MentionContext } from "../src";

function ctx(over: Partial<MentionContext> = {}): MentionContext {
  return {
    repository: "o/r",
    knownRepositories: ["o/r", "o/other"],
    trackerPrefixes: ["PROJ"],
    hasNode: () => false,
    ...over,
  };
}

const keys = (text: string, c = ctx()) =>
  extractMentions(text, c).map((m) => `${m.rel} ${m.target.type}:${m.target.key}`);

describe("extractMentions", () => {
  it("reads only explicit forms", () => {
    expect(keys("Fix login (#12), see PROJ-45 and o/other")).toEqual([
      "MENTIONS Issue:o/r#12",
      "MENTIONS Issue:PROJ-45",
      "REFERENCES Repository:o/other",
    ]);
  });

  it("treats a bare #N as the pull request only when that PR is already known", () => {
    const known = ctx({ hasNode: (id) => id === "PullRequest:o/r#7" });
    expect(keys("see #7", known)).toEqual(["MENTIONS PullRequest:o/r#7"]);
    expect(keys("see #8", known)).toEqual(["MENTIONS Issue:o/r#8"]);
  });

  it("a fix keyword makes FIXES, a qualified reference keeps its repository", () => {
    expect(keys("Closes #3, fixes o/other#9")).toEqual([
      "FIXES Issue:o/r#3",
      "FIXES Issue:o/other#9",
    ]);
    expect(keys("pull request #4")).toEqual(["MENTIONS PullRequest:o/r#4"]);
  });

  it("does not guess: unknown prefixes, lowercase keys, words and hashes in URLs are ignored", () => {
    expect(keys("ABC-12 is not configured; proj-45; version 1.2.3; fix the thing; a#b")).toEqual(
      [],
    );
    expect(keys("see https://example.com/page#12 and file.ts#L12")).toEqual([]);
    expect(keys("o/unknownrepo is not a known repository")).toEqual([]);
  });

  it("recognises ADR and phase numbers, and full commit hashes only when the commit exists", () => {
    const sha = "d".repeat(40);
    expect(keys("see ADR-0014 and Phase 7")).toEqual([
      "MENTIONS Decision:ADR-0014",
      "REFERENCES Feature:phase-07",
    ]);
    expect(keys(`reverts ${sha}`)).toEqual([]);
    expect(keys(`reverts ${sha}`, ctx({ hasNode: (id) => id === `Commit:o/r@${sha}` }))).toEqual([
      `MENTIONS Commit:o/r@${sha}`,
    ]);
  });

  it("bounds its input and output", () => {
    const many = Array.from({ length: 200 }, (_, i) => `#${i + 1}`).join(" ");
    expect(extractMentions(many, ctx())).toHaveLength(MAX_MENTIONS);
    const far = `${"x ".repeat(MAX_SCAN_CHARS)}#99`;
    expect(extractMentions(far, ctx())).toEqual([]);
    expect(extractMentions("#12 #12 #12", ctx())).toHaveLength(1);
  });

  it("survives hostile text without hanging", () => {
    const hostile = `${"a/".repeat(2000)}#`.concat("9".repeat(5000), "\u0000", "PROJ-".repeat(500));
    const t0 = performance.now();
    extractMentions(hostile, ctx());
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it("without a repository context a bare #N means nothing", () => {
    expect(keys("see #12", ctx({ repository: undefined }))).toEqual([]);
  });
});
