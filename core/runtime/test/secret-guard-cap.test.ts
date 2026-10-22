// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The size cap applied before the redactor (F6): git diff output and a model reply are cut BEFORE
// `redactSecrets`, so a single attacker-sized line cannot make masking expensive. Work is counted
// (what reached the redactor), not timed.
import { describe, expect, it } from "vitest";
import { cleanSummary, MAX_SUMMARY_CHARS } from "../src/handoff-notes/summary";
import { diffPreview } from "../src/agent-safety";
import { capForRedaction, DIFF_REDACT_CHARS, DIFF_REDACT_LINE } from "../src/secret-guard/cap";

describe("capForRedaction", () => {
  it("cuts a 200 KB single line to the line limit and says so", () => {
    const out = capForRedaction(`+${"a".repeat(200_000)}`);
    expect(out.cut).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(DIFF_REDACT_LINE + 1);
    expect(out.text.endsWith("…")).toBe(true);
  });

  it("cuts the whole text at the total limit, line by line", () => {
    const line = `+${"b".repeat(99)}\n`;
    const text = line.repeat(Math.ceil((DIFF_REDACT_CHARS * 2) / line.length));
    const out = capForRedaction(text);
    expect(out.cut).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(DIFF_REDACT_CHARS);
  });

  it("leaves a normal diff untouched", () => {
    const diff = "diff --git a/x b/x\n@@ -1 +1 @@\n-old\n+new\n";
    expect(capForRedaction(diff)).toEqual({ text: diff, cut: false });
  });
});

describe("where the cap is applied", () => {
  it("cleanSummary returns for a 200 KB single word-character line, already bounded", () => {
    const out = cleanSummary("w".repeat(200_000));
    expect(out.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
  });

  it("diffPreview hands the redactor at most the capped text and flags the cut", async () => {
    const huge = `+${"w".repeat(200_000)}\n`;
    const ctx = {
      root: "/x",
      git: async () => ({ code: 0, stdout: huge, stderr: "" }),
    };
    const plan = { checkpointTree: "a".repeat(40), currentTree: "b".repeat(40) };
    const out = await diffPreview(ctx as never, plan as never);
    expect(out.truncated).toBe(true);
    expect(out.diff.length).toBeLessThanOrEqual(DIFF_REDACT_LINE + 10);
  });
});
