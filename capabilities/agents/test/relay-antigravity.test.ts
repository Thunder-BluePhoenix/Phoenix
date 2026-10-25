// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Google Antigravity (Phase 57): the named `hooks.json` layout, the payload mapping and the fixed
// `Stop` reply. Payloads and the hooks.json example are COPIED from the vendor's documentation,
// https://antigravity.google/docs/hooks (read 2026-10; no real Antigravity was run, and the
// installer only touches temp homes).
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hookReply, HOOK_REPLIES, runAgentHook } from "../src/agent-hook";
import { HOOK_SCRIPT_PATTERN } from "../src/relay/commands";
import { mapGenericHook } from "../src/relay/generic-map";
import { InstallError } from "../src/relay/installer";
import { rig, type Rig } from "./relay-rig";

// ── Fixtures from https://antigravity.google/docs/hooks ──────────────────────────────────────────
const COMMON = {
  conversationId: "ec33ebf9-0cba-4100-8142-c61503f6c587",
  workspacePaths: ["/workspace/project"],
  transcriptPath:
    "~/.gemini/antigravity/brain/ec33ebf9-0cba-4100-8142-c61503f6c587/.system_generated/logs/transcript.jsonl",
  artifactDirectoryPath: "~/.gemini/antigravity/brain/ec33ebf9-0cba-4100-8142-c61503f6c587",
  modelName: "gemini-3.6-flash-medium",
};
const DOC_SESSION_START = { ...COMMON };
const DOC_PRE_INVOCATION = { invocationNum: 3, initialNumSteps: 10, ...COMMON };
const DOC_POST_TOOL_USE = {
  toolCall: {
    name: "run_command",
    args: { CommandLine: "npm test", Cwd: "/workspace/project", WaitMsBeforeAsync: 5000 },
  },
  stepIdx: 5,
  error: "exit status 1",
  ...COMMON,
};
const DOC_STOP = {
  executionNum: 1,
  terminationReason: "model_stop",
  error: "",
  fullyIdle: true,
  ...COMMON,
};
/** The "Schema and file format" example of the docs, verbatim apart from indentation. */
const DOC_HOOKS_JSON = {
  "my-linter-hook": {
    PostToolUse: [
      {
        matcher: "run_command",
        hooks: [{ type: "command", command: "./scripts/lint.sh", timeout: 10 }],
      },
    ],
  },
  "safety-gate": {
    enabled: false,
    PreToolUse: [{ matcher: "run_command", hooks: [{ command: "./scripts/safety-check.sh" }] }],
  },
  reminder: { PreInvocation: [{ type: "command", command: "./scripts/reminder.sh" }] },
  "session-init": { SessionStart: [{ type: "command", command: "./scripts/init-env.sh" }] },
};
const pretty = (value: unknown, eol = "\n") =>
  JSON.stringify(value, null, 2).replace(/\n/g, eol) + eol;

describe("Antigravity payload mapping (docs fixtures)", () => {
  const agent = { agent: "antigravity" };
  const base = {
    agent: "antigravity",
    agent_id: COMMON.conversationId,
    workspace: "/workspace/project",
  };

  it("maps SessionStart, PreInvocation, PostToolUse and Stop from the documented payloads", () => {
    expect(mapGenericHook(DOC_SESSION_START, { ...agent, event: "SessionStart" })).toEqual({
      ...base,
      state: "started",
    });
    expect(mapGenericHook(DOC_PRE_INVOCATION, { ...agent, event: "PreInvocation" })).toEqual({
      ...base,
      state: "working",
    });
    expect(mapGenericHook(DOC_POST_TOOL_USE, { ...agent, event: "PostToolUse" })).toEqual({
      ...base,
      state: "working",
    });
    expect(mapGenericHook(DOC_STOP, { ...agent, event: "Stop" })).toEqual({
      ...base,
      state: "completed",
    });
  });

  it("a Stop with fullyIdle false is still working; an error termination is failed", () => {
    expect(
      mapGenericHook({ ...DOC_STOP, fullyIdle: false }, { ...agent, event: "Stop" })?.state,
    ).toBe("working");
    expect(
      mapGenericHook(
        { ...DOC_STOP, terminationReason: "error", error: "boom" },
        { ...agent, event: "Stop" },
      )?.state,
    ).toBe("failed");
    expect(
      mapGenericHook(
        { ...DOC_STOP, terminationReason: "max_steps_exceeded" },
        { ...agent, event: "Stop" },
      )?.state,
    ).toBe("completed");
  });

  it("ignores events Phoenix does not follow and payloads without a usable id or workspace", () => {
    expect(mapGenericHook(DOC_POST_TOOL_USE, { ...agent, event: "PreToolUse" })).toBeNull();
    expect(
      mapGenericHook(
        { ...DOC_SESSION_START, conversationId: undefined },
        { ...agent, event: "SessionStart" },
      ),
    ).toBeNull();
    expect(
      mapGenericHook(
        { ...DOC_SESSION_START, workspacePaths: ["relative/dir"] },
        { ...agent, event: "SessionStart" },
      ),
    ).toBeNull();
  });

  it("never copies the tool call, its arguments, the transcript path or the model into the report", () => {
    const report = mapGenericHook(DOC_POST_TOOL_USE, { ...agent, event: "PostToolUse" });
    const text = JSON.stringify(report);
    for (const secret of ["npm test", "transcript", "run_command", "gemini-3.6", "exit status"]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("Antigravity installer (named hooks.json layout)", () => {
  const ID = "antigravity";
  const bytes = (path: string) => (existsSync(path) ? readFileSync(path) : null);
  const install = (r: Rig) =>
    r.installer.apply("install", ID, r.installer.preview("install", ID).hash);
  const uninstall = (r: Rig) =>
    r.installer.apply("uninstall", ID, r.installer.preview("uninstall", ID).hash);

  const seeds: Record<string, Buffer | string | null> = {
    missing: null,
    empty: "",
    "empty object": "{}\n",
    "the documentation example": pretty(DOC_HOOKS_JSON),
    "the documentation example, CRLF": pretty(DOC_HOOKS_JSON, "\r\n"),
    "no trailing newline": JSON.stringify({ reminder: DOC_HOOKS_JSON.reminder }, null, 2),
    bom: "\uFEFF" + pretty(DOC_HOOKS_JSON),
  };

  it.each(Object.keys(seeds))("install → uninstall leaves the file byte-identical (%s)", (name) => {
    const r = rig(ID, seeds[name]!);
    const original = bytes(r.path);
    const preview = r.installer.preview("install", ID);
    expect(preview.changed).toBe(true);
    r.installer.apply("install", ID, preview.hash);
    const installed = readFileSync(r.path, "utf8");
    expect(installed).toMatch(HOOK_SCRIPT_PATTERN);
    expect(() => JSON.parse(installed.replace(/^\uFEFF/, ""))).not.toThrow();
    uninstall(r);
    const restored = bytes(r.path);
    expect(restored === null ? null : restored.toString("hex")).toBe(
      original === null ? null : original.toString("hex"),
    );
    expect(r.installer.list().find((a) => a.id === ID)!.state).toBe("not_installed");
  });

  it("writes one named entry with the documented shapes and never a PreToolUse", () => {
    const r = rig(ID, pretty(DOC_HOOKS_JSON));
    install(r);
    const doc = JSON.parse(readFileSync(r.path, "utf8")) as Record<string, any>;
    // the user's four hooks are untouched and still first
    expect(Object.keys(doc).slice(0, 4)).toEqual(Object.keys(DOC_HOOKS_JSON));
    for (const [name, value] of Object.entries(DOC_HOOKS_JSON)) expect(doc[name]).toEqual(value);
    const mine = doc["phoenix-agent"] as Record<string, any>;
    expect(Object.keys(mine).sort()).toEqual([
      "PostToolUse",
      "PreInvocation",
      "SessionStart",
      "Stop",
    ]);
    // flat events list handlers directly; PostToolUse takes a matcher group (docs, "Matcher")
    for (const event of ["SessionStart", "PreInvocation", "Stop"]) {
      expect(mine[event]).toHaveLength(1);
      expect(mine[event][0]).toMatchObject({ type: "command", timeout: 5 });
      expect(mine[event][0].command).toMatch(HOOK_SCRIPT_PATTERN);
      expect(mine[event][0].hooks).toBeUndefined();
    }
    expect(mine.PostToolUse[0].matcher).toBe("*");
    expect(mine.PostToolUse[0].hooks[0].command).toContain("--event PostToolUse");
    expect(mine.PreToolUse).toBeUndefined();
    // Stop REQUIRES a decision; only that handler asks for the fixed reply
    expect(mine.Stop[0].command).toContain("--reply antigravity-stop");
    for (const event of ["SessionStart", "PreInvocation"]) {
      expect(mine[event][0].command).not.toContain("--reply");
    }
    expect(mine.SessionStart[0].command).toContain("--agent antigravity --event SessionStart");
  });

  it("is idempotent, and keeps handlers the user added inside Phoenix's own name", () => {
    const r = rig(ID, pretty(DOC_HOOKS_JSON));
    install(r);
    const once = readFileSync(r.path);
    const second = r.installer.preview("install", ID);
    expect(second.changed).toBe(false);
    expect(second.diff).toBe("");

    const doc = JSON.parse(once.toString()) as Record<string, any>;
    doc["phoenix-agent"].Stop.unshift({ type: "command", command: "echo mine" });
    doc["phoenix-agent"].enabled = true;
    writeFileSync(r.path, pretty(doc));
    uninstall(r);
    const after = JSON.parse(readFileSync(r.path, "utf8")) as Record<string, any>;
    expect(after["phoenix-agent"]).toEqual({
      enabled: true,
      Stop: [{ type: "command", command: "echo mine" }],
    });
    expect(readFileSync(r.path, "utf8")).not.toMatch(HOOK_SCRIPT_PATTERN);
    for (const [name, value] of Object.entries(DOC_HOOKS_JSON)) expect(after[name]).toEqual(value);
  });

  it("writes a backup with a manifest before the first write and restores it", () => {
    const r = rig(ID, pretty(DOC_HOOKS_JSON));
    const before = readFileSync(r.path);
    const preview = r.installer.preview("install", ID);
    expect(readFileSync(r.path).equals(before)).toBe(true); // preview writes nothing
    expect(preview.diff).toMatch(/^--- a\/.*hooks\.json\n\+\+\+ b\/.*hooks\.json\n@@ /);
    r.installer.apply("install", ID, preview.hash);
    const manifest = JSON.parse(readFileSync(join(r.backupDir, ID, "manifest.json"), "utf8"));
    expect(manifest).toMatchObject({ agent: ID, path: r.path, existed: true, exact_restore: true });
    uninstall(r);
    expect(readFileSync(r.path).equals(before)).toBe(true);
  });

  it("health notices a dropped event and repair puts it back", () => {
    const r = rig(ID, "{}\n");
    install(r);
    expect(r.installer.list().find((a) => a.id === ID)!.state).toBe("installed");
    const doc = JSON.parse(readFileSync(r.path, "utf8")) as Record<string, any>;
    delete doc["phoenix-agent"].PreInvocation;
    writeFileSync(r.path, pretty(doc));
    const sick = r.installer.list().find((a) => a.id === ID)!;
    expect(sick.state).toBe("needs_repair");
    expect(sick.missing).toEqual(["PreInvocation"]);
    r.installer.apply("repair", ID, r.installer.preview("repair", ID).hash);
    expect(r.installer.list().find((a) => a.id === ID)!.state).toBe("installed");
    // the whole name vanishing is needs_repair too
    writeFileSync(r.path, "{}\n");
    expect(r.installer.list().find((a) => a.id === ID)!.state).toBe("needs_repair");
  });

  it("refuses a file or hook entry it cannot edit safely and writes nothing", () => {
    for (const bad of [
      "{ nope",
      "[]",
      pretty({ "phoenix-agent": [] }),
      pretty({ "phoenix-agent": { Stop: {} } }),
    ]) {
      const r = rig(ID, bad);
      expect(() => r.installer.preview("install", ID)).toThrow(InstallError);
      expect(readFileSync(r.path, "utf8")).toBe(bad);
    }
  });

  it("is offered only when Antigravity is detected, and lists the doc URL and caveats", () => {
    const r = rig("claude-code", null);
    const entry = r.installer.list().find((a) => a.id === ID)!;
    expect(entry).toMatchObject({
      support: "supported",
      detected: false,
      doc_url: "https://antigravity.google/docs/hooks",
    });
    expect(entry.reason).toMatch(/exit codes/);
    expect(() => r.installer.preview("install", ID)).toThrow(/not found/);
  });
});

describe("the fixed Stop reply", () => {
  it("is a table of fixed lines: unknown names and no flag print {}", () => {
    expect(hookReply(["--agent", "antigravity", "--reply", "antigravity-stop"])).toBe(
      '{"decision":"stop"}',
    );
    expect(hookReply(["--agent", "antigravity"])).toBe("{}");
    expect(hookReply(["--reply", "nope"])).toBe("{}");
    expect(hookReply(["--reply", "__proto__"])).toBe("{}");
    expect(hookReply(["--reply"])).toBe("{}");
    // the documented contract: `decision` must be present and anything but "continue" lets Stop through
    for (const line of Object.values(HOOK_REPLIES)) {
      const out = JSON.parse(line) as { decision?: unknown };
      expect(typeof out.decision).toBe("string");
      expect(out.decision).not.toBe("continue");
    }
  });

  it("runAgentHook accepts --reply and still reports the state", async () => {
    expect(
      await runAgentHook(
        ["--agent", "antigravity", "--event", "Stop", "--reply", "antigravity-stop"],
        JSON.stringify(DOC_STOP),
        { PHOENIX_CORE_URL: "http://127.0.0.1:1", PHOENIX_SESSION_TOKEN: "x" },
      ),
    ).toMatchObject({ note: expect.any(String) });
  });

  it("the real hook prints exactly the Stop reply and exits 0 with no Core running", async () => {
    const run = async (args: string[], stdin: unknown) => {
      const child = spawn(
        join(import.meta.dirname, "../../../node_modules/.bin/tsx"),
        [join(import.meta.dirname, "../src/agent-hook.ts"), ...args],
        {
          env: {
            ...process.env,
            PHOENIX_CORE_URL: "http://127.0.0.1:1",
            PHOENIX_SESSION_TOKEN: "x",
            PHOENIX_RELAY_SOCKET: join(process.cwd(), "no-such.sock"),
          },
        },
      );
      let stdout = "";
      child.stdout.on("data", (c: Buffer) => (stdout += c));
      child.stdin.end(JSON.stringify(stdin));
      const closed = Promise.withResolvers<number | null>();
      child.on("close", (status) => closed.resolve(status));
      return { code: await closed.promise, stdout };
    };
    expect(
      await run(
        ["--agent", "antigravity", "--event", "Stop", "--reply", "antigravity-stop"],
        DOC_STOP,
      ),
    ).toEqual({ code: 0, stdout: '{"decision":"stop"}\n' });
    expect(
      await run(["--agent", "antigravity", "--event", "PostToolUse"], DOC_POST_TOOL_USE),
    ).toEqual({
      code: 0,
      stdout: "{}\n",
    });
  });
});
