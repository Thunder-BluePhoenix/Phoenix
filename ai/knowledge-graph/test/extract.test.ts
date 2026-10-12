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
  it("reads only explicit forms with verified targets", () => {
    const known = ctx({ hasNode: (id) => ["Issue:o/r#12", "Issue:PROJ-45"].includes(id) });
    expect(keys("Fix login (#12), see PROJ-45 and o/other", known)).toEqual([
      "MENTIONS Issue:o/r#12",
      "MENTIONS Issue:PROJ-45",
      "REFERENCES Repository:o/other",
    ]);
  });

  it("resolves bare #N only to a known pull request or issue", () => {
    const known = ctx({ hasNode: (id) => ["PullRequest:o/r#7", "Issue:o/r#8"].includes(id) });
    expect(keys("see #7", known)).toEqual(["MENTIONS PullRequest:o/r#7"]);
    expect(keys("see #8", known)).toEqual(["MENTIONS Issue:o/r#8"]);
    expect(keys("see #9", known)).toEqual([]);
  });

  it("retains explicit fix and PR references only for verified targets", () => {
    const known = ctx({
      hasNode: (id) => ["Issue:o/r#3", "Issue:o/other#9", "PullRequest:o/r#4"].includes(id),
    });
    expect(keys("Closes #3, fixes o/other#9", known)).toEqual([
      "FIXES Issue:o/r#3",
      "FIXES Issue:o/other#9",
    ]);
    expect(keys("pull request #4", known)).toEqual(["MENTIONS PullRequest:o/r#4"]);
    expect(keys("fixes o/other#10 pull request #5", known)).toEqual([]);
  });

  it("does not guess: unknown prefixes, lowercase keys, words and hashes in URLs are ignored", () => {
    expect(keys("ABC-12 is not configured; proj-45; version 1.2.3; fix the thing; a#b")).toEqual(
      [],
    );
    expect(keys("see https://example.com/page#12 and file.ts#L12")).toEqual([]);
    expect(keys("o/unknownrepo is not a known repository")).toEqual([]);
  });

  it("requires an existing ADR, phase or commit, not just a matching token", () => {
    const sha = "d".repeat(40);
    expect(keys(`see ADR-0014 and Phase 7 and PROJ-45 and #8; reverts ${sha}`)).toEqual([]);
    expect(
      keys(
        "see ADR-0014 and Phase 7",
        ctx({ hasNode: (id) => ["Decision:ADR-0014", "Feature:phase-07"].includes(id) }),
      ),
    ).toEqual(["MENTIONS Decision:ADR-0014", "REFERENCES Feature:phase-07"]);
    expect(keys(`reverts ${sha}`, ctx({ hasNode: (id) => id === `Commit:o/r@${sha}` }))).toEqual([
      `MENTIONS Commit:o/r@${sha}`,
    ]);
  });

  it("bounds its input and output", () => {
    const many = Array.from({ length: 200 }, (_, i) => `#${i + 1}`).join(" ");
    expect(
      extractMentions(many, ctx({ hasNode: (id) => id.startsWith("Issue:o/r#") })),
    ).toHaveLength(MAX_MENTIONS);
    const far = `${"x ".repeat(MAX_SCAN_CHARS)}#99`;
    expect(extractMentions(far, ctx())).toEqual([]);
    expect(
      extractMentions("#12 #12 #12", ctx({ hasNode: (id) => id === "Issue:o/r#12" })),
    ).toHaveLength(1);
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
