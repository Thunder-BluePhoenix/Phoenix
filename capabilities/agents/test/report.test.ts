// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { cleanTask, repositoryName, validateReport } from "../src/report";

const ok = { agent: "codex", agent_id: "run-1", state: "working", workspace: "/home/me/app" };

describe("validateReport", () => {
  it("accepts a minimal and a full report", () => {
    expect(validateReport(ok)).toEqual({ ok: true, report: ok });
    const full = { ...ok, state: "waiting", task: "Fix it", reason: "permission" };
    expect(validateReport(full)).toEqual({ ok: true, report: full });
  });

  it.each([
    ["unknown state", { state: "dancing" }],
    ["agent with spaces", { agent: "my agent" }],
    ["agent over 40 chars", { agent: "a".repeat(41) }],
    ["agent_id over 100 chars", { agent_id: "a".repeat(101) }],
    ["relative workspace", { workspace: "app" }],
    ["workspace with newline", { workspace: "/home/me/a\nb" }],
    ["task over 120 chars", { task: "t".repeat(121) }],
    ["task with control chars", { task: "a\u0007b" }],
    ["reason on a non-waiting report", { reason: "input" }],
    ["unknown reason", { state: "waiting", reason: "bored" }],
    ["extra field", { transcript: "/tmp/x" }],
  ])("rejects %s", (_name, patch) => {
    const result = validateReport({ ...ok, ...patch });
    expect(result.ok).toBe(false);
  });

  it.each([null, "str", 5, [ok]])("rejects non-object %j", (value) => {
    expect(validateReport(value).ok).toBe(false);
  });
});

describe("repositoryName / cleanTask", () => {
  it("uses the last path segment", () => {
    expect(repositoryName("/home/me/app")).toBe("app");
    expect(repositoryName("/home/me/app/")).toBe("app");
    expect(repositoryName("/")).toBe("/");
  });

  it("takes the first non-empty line, strips control characters, collapses space", () => {
    expect(cleanTask("\n\n  hello\u001b[0m   world \nnext")).toBe("hello [0m world");
    expect(cleanTask("\n \u0000 \n")).toBeUndefined();
  });
});
