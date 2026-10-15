// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  FAKE_AWS_KEY,
  FAKE_GITHUB_TOKEN,
  FAKE_OPENAI_KEY,
} from "../../../protocol/testing/fake-secrets";
import {
  MAX_STEPS,
  MAX_TARGET,
  StepLog,
  lineDelta,
  mapClaudeStep,
  validateStep,
} from "../src/steps";
import { CWD, HOOKS, SESSION } from "./fixtures";

const NOW = Date.parse("2026-10-16T10:00:00Z");
const common = { session_id: SESSION, cwd: CWD, permission_mode: "default" };
const post = (tool_name: string, tool_input: unknown, extra: Record<string, unknown> = {}) => ({
  ...common,
  hook_event_name: "PostToolUse",
  tool_name,
  tool_input,
  ...extra,
});
const map = (payload: unknown) => mapClaudeStep(payload, { now: () => NOW });

describe("mapClaudeStep", () => {
  it("maps the documented tools to read / edit / run / other", () => {
    expect(map(post("Read", { file_path: `${CWD}/src/a.ts` }))).toMatchObject({
      kind: "read",
      tool: "Read",
      target: `${CWD}/src/a.ts`,
      agent: "claude-code",
      session_id: SESSION,
      project: CWD,
      at: "2026-10-16T10:00:00.000Z",
    });
    expect(map(post("Glob", { pattern: "**/*.ts", path: CWD }))).toMatchObject({
      kind: "read",
      target: `**/*.ts in ${CWD}`,
    });
    expect(map(post("Grep", { pattern: "TODO.*fix" }))).toMatchObject({
      kind: "read",
      target: "TODO.*fix",
    });
    expect(map(post("Bash", { command: "npm test", description: "Run" }))).toMatchObject({
      kind: "run",
      target: "npm test",
    });
    expect(map(post("PowerShell", { command: "Get-ChildItem" }))).toMatchObject({ kind: "run" });
    expect(
      map(post("Edit", { file_path: `${CWD}/a.ts`, old_string: "a", new_string: "b" })),
    ).toMatchObject({
      kind: "edit",
      target: `${CWD}/a.ts`,
      file: { path: `${CWD}/a.ts`, added: 1, removed: 1 },
    });
    expect(map(post("Write", { file_path: `${CWD}/new.ts`, content: "x\ny\nz\n" }))).toMatchObject({
      kind: "edit",
      file: { path: `${CWD}/new.ts`, added: 3, removed: 0 },
    });
    expect(map(post("WebFetch", { url: "https://example.com/x", prompt: "p" }))).toMatchObject({
      kind: "other",
      target: "https://example.com/x",
    });
    expect(map(post("SomeMcpTool", { anything: 1 }))).toMatchObject({ kind: "other", target: "" });
  });

  it("maps PreToolUse too, and ignores other hooks", () => {
    expect(
      map({ ...post("Read", { file_path: `${CWD}/a` }), hook_event_name: "PreToolUse" }),
    ).toMatchObject({
      kind: "read",
    });
    expect(map(HOOKS.Stop)).toBeNull();
    expect(map(HOOKS.UserPromptSubmit)).toBeNull();
  });

  it("the fixture PostToolUse maps to a run step and never carries the tool output", () => {
    const step = map(HOOKS.PostToolUse);
    expect(step).toMatchObject({ kind: "run", tool: "Bash", target: "cat ~/.ssh/id_rsa" });
    expect(JSON.stringify(step)).not.toContain("TOP SECRET TOOL OUTPUT");
  });

  it("never stores tool output or file contents", () => {
    const step = map(
      post(
        "Write",
        { file_path: `${CWD}/a.ts`, content: "SECRET_FILE_BODY\nline2" },
        { tool_response: { stdout: "SECRET_OUTPUT" } },
      ),
    );
    const json = JSON.stringify(step);
    expect(json).not.toContain("SECRET_FILE_BODY");
    expect(json).not.toContain("SECRET_OUTPUT");
    const edit = map(
      post("Edit", { file_path: `${CWD}/a.ts`, old_string: "OLD_BODY", new_string: "NEW_BODY" }),
    );
    expect(JSON.stringify(edit)).not.toMatch(/OLD_BODY|NEW_BODY/);
  });

  it("redacts secrets in commands and paths", () => {
    const token = FAKE_GITHUB_TOKEN;
    const cmd = map(
      post("Bash", {
        command: `curl -H "Authorization: ${FAKE_OPENAI_KEY}" --password hunter2 https://u:pw123@host/x API_TOKEN=abc ${token} ${FAKE_AWS_KEY}`,
      }),
    )!;
    for (const secret of [FAKE_OPENAI_KEY, "hunter2", "pw123", "abc ", token, FAKE_AWS_KEY]) {
      expect(cmd.target).not.toContain(secret);
    }
    expect(cmd.target).toContain("[REDACTED]");
  });

  it("truncates a huge command to 200 characters, however large the input", () => {
    const step = map(post("Bash", { command: "x".repeat(5_000_000) }))!;
    expect(step.target).toHaveLength(MAX_TARGET);
    expect(step.target.endsWith("…")).toBe(true);
    const long = map(post("Read", { file_path: `/${"d/".repeat(300)}f` }))!;
    expect(long.target.length).toBeLessThanOrEqual(MAX_TARGET);
  });

  it("a secret straddling the cut cannot leak its prefix", () => {
    const command = `${"a".repeat(180)} ${FAKE_GITHUB_TOKEN}`;
    const step = map(post("Bash", { command }))!;
    expect(step.target.length).toBeLessThanOrEqual(MAX_TARGET);
    expect(step.target).not.toContain(FAKE_GITHUB_TOKEN.slice(0, 4));
  });

  it("flattens control characters and escape sequences", () => {
    const step = map(post("Bash", { command: "ls\n\u001b[31mred\u001b[0m\u0000\r\tx" }))!;
    expect(step.target).not.toMatch(/\p{Cc}/u);
  });

  it("returns null for unusable payloads and never throws", () => {
    for (const bad of [
      null,
      "x",
      [],
      {},
      post("", {}),
      post("Bash", {}, { session_id: "bad id with spaces" }),
      post("Bash", {}, { cwd: "relative/dir" }),
      post("Bash", {}, { cwd: `${CWD}\n` }),
      post("AskUserQuestion", { questions: [] }),
      { ...common, hook_event_name: "PostToolUse", tool_name: 5 },
    ]) {
      expect(map(bad)).toBeNull();
    }
    expect(map(post("Bash", "not an object"))).toMatchObject({ kind: "run", target: "" });
    expect(
      map(post("Edit", { file_path: "relative.ts", old_string: "a", new_string: "b" })),
    ).toMatchObject({
      kind: "edit",
    });
    expect(map(post("Edit", { file_path: "relative.ts" }))!.file).toBeUndefined();
  });

  it("a Windows path is kept as the file key", () => {
    const step = map(
      post("Edit", { file_path: "C:\\proj\\a.ts", old_string: "a", new_string: "b" }),
    )!;
    expect(step.file?.path).toBe("C:\\proj\\a.ts");
  });
});

describe("lineDelta", () => {
  it("counts only the changed lines", () => {
    expect(lineDelta("a\nb\nc", "a\nB\nc")).toEqual({ added: 1, removed: 1 });
    expect(lineDelta("", "a\nb\n")).toEqual({ added: 2, removed: 0 });
    expect(lineDelta("a\nb\n", "")).toEqual({ added: 0, removed: 2 });
    expect(lineDelta("a\nb", "a\nb")).toEqual({ added: 0, removed: 0 });
    expect(lineDelta("a\nb\nc\nd", "a\nX\nY\nZ\nd")).toEqual({ added: 3, removed: 2 });
  });
});

describe("validateStep", () => {
  const valid = {
    agent: "claude-code",
    session_id: SESSION,
    project: CWD,
    kind: "edit",
    tool: "Edit",
    target: `${CWD}/a.ts`,
    at: "2026-10-16T10:00:00Z",
    file: { path: `${CWD}/a.ts`, added: 2, removed: 1 },
  };

  it("accepts a well-formed step and cleans it again", () => {
    const r = validateStep({ ...valid, target: `x ${FAKE_GITHUB_TOKEN}\n${"y".repeat(300)}` }, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.step.target).not.toContain(FAKE_GITHUB_TOKEN);
      expect(r.step.target).not.toContain("\n");
      expect(r.step.target.length).toBeLessThanOrEqual(MAX_TARGET);
    }
  });

  it("rejects unknown fields, bad enums, relative project, bad counts", () => {
    for (const patch of [
      { extra: 1 },
      { agent: "Bad Agent" },
      { kind: "delete" },
      { project: "rel" },
      { session_id: "" },
      { file: { path: "rel", added: 1, removed: 1 } },
      { file: { path: `${CWD}/a`, added: -1, removed: 0 } },
      { file: { path: `${CWD}/a`, added: 1.5, removed: 0 } },
      { tty: "../../etc/passwd" },
      { pid: -3 },
    ]) {
      expect(validateStep({ ...valid, ...patch }, NOW).ok).toBe(false);
    }
    expect(validateStep(null, NOW).ok).toBe(false);
  });

  it("replaces a wildly wrong sender clock with Core's", () => {
    const r = validateStep({ ...valid, at: "1999-01-01T00:00:00Z" }, NOW);
    expect(r.ok && r.step.at).toBe(new Date(NOW).toISOString());
  });

  it("drops a file key that redaction would change", () => {
    const r = validateStep(
      { ...valid, file: { path: `/work/${FAKE_GITHUB_TOKEN}`, added: 1, removed: 0 } },
      NOW,
    );
    expect(r.ok && r.step.file).toBeUndefined();
  });
});

describe("StepLog ring buffer", () => {
  const step = (i: number) => ({ at: "t", kind: "run" as const, tool: "Bash", target: `cmd ${i}` });

  it("is bounded at 500 by default, drops the oldest and counts them", () => {
    const log = new StepLog();
    for (let i = 1; i <= MAX_STEPS + 25; i++) log.push(step(i));
    expect(log.list()).toHaveLength(MAX_STEPS);
    expect(log.list()[0]!.target).toBe("cmd 26");
    expect(log.list().at(-1)!.n).toBe(MAX_STEPS + 25);
    expect(log.dropped).toBe(25);
    expect(log.total).toBe(MAX_STEPS + 25);
  });

  it("numbers steps continuously and keeps order", () => {
    const log = new StepLog(3);
    for (let i = 1; i <= 5; i++) log.push(step(i));
    expect(log.list().map((s) => s.n)).toEqual([3, 4, 5]);
  });
});
