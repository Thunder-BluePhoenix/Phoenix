// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { codexSummary } from "../src/approval-codex";
import {
  answersMatch,
  approvalDigest,
  approvalHookTimeoutSeconds,
  canonicalJson,
  mapApprovalPayload,
  parseDecision,
  renderDecision,
  type ApprovalQuestion,
  type MappedApproval,
} from "../src/approval-map";
import { CWD, SESSION } from "./fixtures";

const common = { session_id: SESSION, cwd: CWD, permission_mode: "default" };
const permission = (tool_name: string, tool_input: unknown) => ({
  ...common,
  hook_event_name: "PermissionRequest",
  tool_name,
  tool_input,
});

const QUESTIONS: ApprovalQuestion[] = [
  {
    question: "Which framework?",
    header: "Framework",
    options: [
      { label: "React", description: "Component library" },
      { label: "Vue", description: "Progressive framework" },
    ],
  },
  {
    question: "Which checks?",
    header: "Checks",
    multiSelect: true,
    options: [{ label: "lint" }, { label: "types" }, { label: "tests, unit" }],
  },
];
const askPayload = (questions: unknown) => ({
  ...common,
  hook_event_name: "PreToolUse",
  tool_name: "AskUserQuestion",
  tool_input: { questions },
});

const map = (payload: unknown, agent = "claude-code") => mapApprovalPayload(payload, { agent });
const mappedQuestion = () => map(askPayload(QUESTIONS))!;

describe("mapApprovalPayload: permission", () => {
  it("maps a Bash PermissionRequest to a protocol request", () => {
    const mapped = map(
      permission("Bash", { command: "rm -rf node_modules", description: "Remove modules" }),
    );
    expect(mapped?.request).toEqual({
      kind: "permission",
      agent: "claude-code",
      session_id: SESSION,
      project: CWD,
      tool: "Bash",
      input_summary: { command: "rm -rf node_modules", description: "Remove modules" },
      timeout_ms: 120_000,
      suggestions_ok: true,
    });
  });

  it("summarises file tools by path only: file content is never copied", () => {
    const mapped = map(permission("Write", { file_path: "/tmp/a.txt", content: "SECRET BODY" }));
    expect(mapped?.request.input_summary).toEqual({ path: "/tmp/a.txt" });
    expect(JSON.stringify(mapped)).not.toContain("SECRET BODY");
  });

  it("truncates to the contract limits", () => {
    const mapped = map(
      permission("Bash", { command: "x".repeat(5_000), description: "d".repeat(900) }),
    );
    expect(mapped?.request.input_summary.command).toHaveLength(2_000);
    expect(mapped?.request.input_summary.description).toHaveLength(500);
  });

  it("accepts a custom decision timeout and refuses one outside 5 s..10 min", () => {
    expect(
      mapApprovalPayload(permission("Bash", {}), { agent: "codex", timeoutMs: 30_000 })?.request
        .timeout_ms,
    ).toBe(30_000);
    for (const timeoutMs of [4_999, 600_001, 1.5, Number.NaN]) {
      expect(mapApprovalPayload(permission("Bash", {}), { agent: "codex", timeoutMs })).toBeNull();
    }
  });

  it.each([
    ["a relative cwd", { ...permission("Bash", {}), cwd: "relative/dir" }],
    ["a control character in cwd", { ...permission("Bash", {}), cwd: "/tmp/a\nb" }],
    ["no session id", { ...permission("Bash", {}), session_id: undefined }],
    ["an oversized session id", { ...permission("Bash", {}), session_id: "s".repeat(201) }],
    ["no tool name", { ...permission("Bash", {}), tool_name: undefined }],
    ["an oversized tool name", permission("t".repeat(101), {})],
    ["another hook event", { ...permission("Bash", {}), hook_event_name: "PostToolUse" }],
    ["a PermissionRequest for AskUserQuestion", permission("AskUserQuestion", { questions: [] })],
    ["a non-object payload", "PermissionRequest"],
    ["null", null],
    ["an array", []],
  ])("returns no request for %s", (_name, payload) => {
    expect(map(payload)).toBeNull();
  });

  it.each(["Claude", "a b", "", "x".repeat(25), "codex;rm", "a/b"])(
    "rejects the agent name %j",
    (agent) => {
      expect(map(permission("Bash", {}), agent)).toBeNull();
    },
  );

  it("works for any agent slug that sends the same payload shape", () => {
    expect(map(permission("Bash", { command: "ls" }), "gemini-cli")?.request.agent).toBe(
      "gemini-cli",
    );
  });
});

describe("mapApprovalPayload: AskUserQuestion", () => {
  it("maps up to four questions and keeps the original input for the answer", () => {
    const mapped = mappedQuestion();
    expect(mapped.request.kind).toBe("question");
    expect(mapped.request.questions).toEqual(QUESTIONS);
    expect(mapped.request.input_summary).toEqual({});
    expect(mapped.originalInput).toEqual({ questions: QUESTIONS });
    expect(mapped.request).not.toHaveProperty("suggestions_ok");
  });

  it("accepts exactly four questions", () => {
    const four = Array.from({ length: 4 }, (_, i) => ({
      question: `Q${i}?`,
      header: `H${i}`,
      options: [{ label: "yes" }, { label: "no" }],
    }));
    expect(map(askPayload(four))?.request.questions).toHaveLength(4);
    expect(map(askPayload([...four, { ...four[0], question: "Q5?" }]))).toBeNull();
  });

  it.each([
    ["no questions", []],
    ["not an array", { question: "x" }],
    ["a question without options", [{ question: "Q?", header: "H", options: [] }]],
    ["an option without a label", [{ question: "Q?", header: "H", options: [{ label: "" }] }]],
    [
      "duplicate option labels",
      [{ question: "Q?", header: "H", options: [{ label: "a" }, { label: "a" }] }],
    ],
    [
      "duplicate question texts",
      [
        { question: "Q?", header: "H", options: [{ label: "a" }] },
        { question: "Q?", header: "H2", options: [{ label: "b" }] },
      ],
    ],
    [
      "a non-boolean multiSelect",
      [{ question: "Q?", header: "H", options: [{ label: "a" }], multiSelect: "yes" }],
    ],
  ])("returns no request for %s", (_name, questions) => {
    expect(map(askPayload(questions))).toBeNull();
  });

  it("ignores PreToolUse for every other tool", () => {
    expect(map({ ...askPayload(QUESTIONS), tool_name: "Bash" })).toBeNull();
  });
});

describe("codex summaries", () => {
  it("uses the command for Bash and only the first file name for apply_patch", () => {
    expect(codexSummary("Bash", { command: ["git", "push"], description: "Push" })).toEqual({
      command: "git push",
      description: "Push",
    });
    const patch = "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-secret old\n+secret new\n";
    const summary = codexSummary("apply_patch", { command: patch });
    expect(summary).toEqual({ path: "src/a.ts" });
    expect(JSON.stringify(summary)).not.toContain("secret");
  });

  it("does not copy MCP arguments", () => {
    expect(codexSummary("mcp__fs__read", { path: "/tmp/x", token: "hunter2" })).toEqual({
      path: "/tmp/x",
    });
  });
});

describe("digest", () => {
  const request = map(permission("Bash", { command: "ls" }))!.request;

  it("is a sha256 hex over the five bound fields and nothing else", () => {
    expect(approvalDigest(request)).toMatch(/^[0-9a-f]{64}$/);
    expect(approvalDigest({ ...request, timeout_ms: 9_999, suggestions_ok: false })).toBe(
      approvalDigest(request),
    );
  });

  it.each([
    ["agent", { agent: "codex" }],
    ["session", { session_id: "other" }],
    ["project", { project: "/elsewhere" }],
    ["tool", { tool: "Edit" }],
    ["input", { input_summary: { command: "ls -la" } }],
  ])("changes with the %s", (_name, change) => {
    expect(approvalDigest({ ...request, ...change })).not.toBe(approvalDigest(request));
  });

  it("canonical JSON sorts keys at every depth", () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[{"y":2,"z":1}]},"b":1}',
    );
  });
});

describe("renderDecision: permission", () => {
  const mapped: MappedApproval = map(permission("Bash", { command: "ls" }))!;

  it("allow", () => {
    expect(JSON.parse(renderDecision(mapped, { behavior: "allow" })!)).toEqual({
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
    });
  });

  it("deny carries the message", () => {
    expect(JSON.parse(renderDecision(mapped, { behavior: "deny", message: "Not now" })!)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "deny", message: "Not now" },
      },
    });
  });

  it("deny without a message omits it; allow never carries one", () => {
    expect(renderDecision(mapped, { behavior: "deny" })).not.toContain("message");
    expect(renderDecision(mapped, { behavior: "allow", message: "hi" })).not.toContain("message");
  });

  it("is one line, valid JSON, whatever the message contains", () => {
    const nasty = 'quote " backslash \\ newline \n tab \t separators \u2028\u2029 </script> 😀';
    const line = renderDecision(mapped, { behavior: "deny", message: nasty })!;
    expect(line).not.toMatch(/[\n\r]/);
    expect(JSON.parse(line).hookSpecificOutput.decision.message).toBe(nasty);
  });
});

describe("parseDecision", () => {
  it("passes an Always decision through as a plain allow: Phoenix applied the rule itself", () => {
    const decision = parseDecision({
      behavior: "allow",
      always: { ttl_minutes: 60, pattern: "npm test *" },
      updatedPermissions: [{ type: "addRules" }],
      interrupt: true,
    });
    expect(decision).toEqual({ behavior: "allow" });
    const mapped = map(permission("Bash", { command: "npm test x" }))!;
    const line = renderDecision(mapped, decision!)!;
    expect(line).not.toMatch(/always|updatedPermissions|updatedInput|interrupt/);
  });

  it.each([
    null,
    "allow",
    [],
    {},
    { behavior: "maybe" },
    { behavior: "allow", message: 5 },
    { behavior: "allow", answers: "x" },
    { behavior: "allow", answers: { q: 1 } },
  ])("rejects %j", (raw) => {
    expect(parseDecision(raw)).toBeNull();
  });

  it("truncates messages to 500 characters", () => {
    expect(parseDecision({ behavior: "deny", message: "m".repeat(900) })?.message).toHaveLength(
      500,
    );
  });
});

describe("renderDecision: questions", () => {
  const render = (answers: Record<string, string>) =>
    renderDecision(mappedQuestion(), { behavior: "allow", answers });

  it("single and multi-select answers become PreToolUse allow + updatedInput", () => {
    const line = render({ "Which framework?": "Vue", "Which checks?": "lint,types" })!;
    expect(line).not.toMatch(/[\n\r]/);
    expect(JSON.parse(line)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: {
          questions: QUESTIONS,
          answers: { "Which framework?": "Vue", "Which checks?": "lint,types" },
        },
      },
    });
  });

  it("multi-select may name one label, and labels that contain a comma", () => {
    expect(render({ "Which framework?": "React", "Which checks?": "tests, unit" })).not.toBeNull();
    expect(
      render({ "Which framework?": "React", "Which checks?": "lint,tests, unit,types" }),
    ).not.toBeNull();
  });

  it.each([
    ["an unknown single label", { "Which framework?": "Svelte", "Which checks?": "lint" }],
    [
      "a single answer with two labels",
      { "Which framework?": "React,Vue", "Which checks?": "lint" },
    ],
    ["an unknown multi label", { "Which framework?": "React", "Which checks?": "lint,e2e" }],
    ["a repeated multi label", { "Which framework?": "React", "Which checks?": "lint,lint" }],
    ["a trailing comma", { "Which framework?": "React", "Which checks?": "lint," }],
    ["a different case", { "Which framework?": "react", "Which checks?": "lint" }],
    ["an empty answer", { "Which framework?": "", "Which checks?": "lint" }],
    ["a missing question", { "Which framework?": "React" }],
    ["an extra question", { "Which framework?": "React", "Which checks?": "lint", Other: "x" }],
    ["a prototype key", { "Which framework?": "React", __proto__x: "1" }],
  ])("returns no decision for %s", (_name, answers) => {
    expect(render(answers)).toBeNull();
  });

  it("returns no decision when an allow carries no answers", () => {
    expect(renderDecision(mappedQuestion(), { behavior: "allow" })).toBeNull();
  });

  it("a deny of a question is a PreToolUse deny", () => {
    expect(
      JSON.parse(renderDecision(mappedQuestion(), { behavior: "deny", message: "No" })!),
    ).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "No",
      },
    });
  });

  it("answersMatch checks the answer text against the options of its own question", () => {
    expect(answersMatch(QUESTIONS, { "Which framework?": "lint", "Which checks?": "lint" })).toBe(
      false,
    );
  });
});

describe("hook timeout arithmetic", () => {
  it.each([
    [5_000, 15],
    [120_000, 130],
    [600_000, 610],
    [5_001, 16],
  ])("decision timeout %d ms → hook timeout %d s", (ms, seconds) => {
    expect(approvalHookTimeoutSeconds(ms)).toBe(seconds);
  });
});
