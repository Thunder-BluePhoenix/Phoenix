// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The pieces around the installer: the unified diff, the generic hook payload mapper, the
// `phoenix-agent status|install|…` commands and the agent-hook script, all on temp dirs.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runAgentHook } from "../src/agent-hook";
import { run } from "../src/cli";
import { unifiedDiff } from "../src/relay/diff";
import { mapGenericHook } from "../src/relay/generic-map";
import { runRelayCommand } from "../src/relay-cli";
import { rig } from "./relay-rig";

describe("unifiedDiff", () => {
  it("is empty for identical text and marks a missing file as /dev/null", () => {
    expect(unifiedDiff("f", "a\n", "a\n")).toBe("");
    expect(unifiedDiff("f", null, "a\n")).toBe("--- /dev/null\n+++ b/f\n@@ -0,0 +1,1 @@\n+a\n");
    expect(unifiedDiff("f", "a\n", null)).toBe("--- a/f\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-a\n");
  });

  it("shows changed lines with context and keeps distant hunks apart", () => {
    const before = Array.from({ length: 30 }, (_, i) => `l${i}\n`).join("");
    const after = before.replace("l2\n", "L2\n").replace("l25\n", "L25\n");
    const diff = unifiedDiff("f", before, after);
    expect(diff.match(/^@@ /gm)).toHaveLength(2);
    expect(diff).toContain("-l2\n+L2\n");
    expect(diff).toContain("-l25\n+L25\n");
    expect(diff).not.toContain("l12");
  });

  it("flags a missing final newline and keeps CRLF in the lines", () => {
    expect(unifiedDiff("f", "a", "a\n")).toContain("-a\n\\ No newline at end of file\n+a\n");
    expect(unifiedDiff("f", "a\r\nb\r\n", "a\r\nc\r\n")).toContain("-b\r\n+c\r\n");
  });

  it("applying the diff's + and context lines reproduces `after`", () => {
    const before = "one\ntwo\nthree\nfour\n";
    const after = "one\n2\nthree\nfour\nfive\n";
    const diff = unifiedDiff("f", before, after);
    const rebuilt = diff
      .split("\n")
      .filter((l) => (l.startsWith("+") || l.startsWith(" ")) && !l.startsWith("+++"))
      .map((l) => l.slice(1) + "\n")
      .join("");
    expect(rebuilt).toBe(after);
  });
});

describe("mapGenericHook", () => {
  const cwd = "/work/app";
  it("maps Cursor payloads (conversation_id + workspace_roots)", () => {
    expect(
      mapGenericHook(
        {
          hook_event_name: "beforeSubmitPrompt",
          conversation_id: "c-1",
          workspace_roots: [cwd],
          prompt: "SECRET",
        },
        { agent: "cursor" },
      ),
    ).toEqual({ agent: "cursor", agent_id: "c-1", state: "working", workspace: cwd });
  });

  it("maps Gemini, Copilot (camelCase and snake_case) and Codex payloads", () => {
    expect(
      mapGenericHook(
        { hook_event_name: "SessionStart", session_id: "g1", cwd },
        { agent: "gemini-cli" },
      )?.state,
    ).toBe("started");
    expect(
      mapGenericHook(
        { sessionId: "p1", cwd, timestamp: 1 },
        { agent: "copilot-cli", event: "agentStop" },
      ),
    ).toMatchObject({ state: "completed", agent_id: "p1" });
    expect(
      mapGenericHook({ session_id: "x1", cwd, hook_event_name: "SessionEnd" }, { agent: "codex" })
        ?.state,
    ).toBe("ended");
  });

  it("a notification becomes waiting, permission when the payload says so", () => {
    const p = {
      hook_event_name: "Notification",
      session_id: "g1",
      cwd,
      notification_type: "ToolPermission",
      message: "x",
    };
    expect(mapGenericHook(p, { agent: "gemini-cli" })).toMatchObject({
      state: "waiting",
      reason: "permission",
    });
    expect(
      mapGenericHook(
        { ...p, notification_type: "other", message: "Claude is waiting for your input" },
        { agent: "gemini-cli" },
      ),
    ).toMatchObject({ reason: "idle" });
  });

  it("an errored stop is failed", () => {
    expect(
      mapGenericHook(
        { hook_event_name: "stop", conversation_id: "c", workspace_roots: [cwd], status: "error" },
        { agent: "cursor" },
      )?.state,
    ).toBe("failed");
  });

  it("a third-party agent says its state itself with phoenix_state", () => {
    expect(
      mapGenericHook(
        { phoenix_state: "waiting", session_id: "t1", cwd, message: "needs your permission" },
        { agent: "my-agent" },
      ),
    ).toMatchObject({
      agent: "my-agent",
      state: "waiting",
      reason: "permission",
    });
  });

  it("plugin agents report through PHOENIX_AGENT_* variables", () => {
    const env = {
      PHOENIX_AGENT_STATE: "completed",
      PHOENIX_AGENT_ID: "ses_1",
      PHOENIX_AGENT_WORKSPACE: cwd,
    };
    expect(mapGenericHook(null, { agent: "opencode", env })).toEqual({
      agent: "opencode",
      agent_id: "ses_1",
      state: "completed",
      workspace: cwd,
    });
    expect(
      mapGenericHook(null, { agent: "opencode", env: { ...env, PHOENIX_AGENT_STATE: "dancing" } }),
    ).toBeNull();
  });

  it.each([
    ["unfollowed event", { hook_event_name: "PreCompact", session_id: "a", cwd }],
    ["relative cwd", { hook_event_name: "Stop", session_id: "a", cwd: "app" }],
    ["control chars in cwd", { hook_event_name: "Stop", session_id: "a", cwd: "/a\nb" }],
    ["bad session id", { hook_event_name: "Stop", session_id: "a b", cwd }],
    ["no session id", { hook_event_name: "Stop", cwd }],
    ["__proto__ event", { hook_event_name: "__proto__", session_id: "a", cwd }],
  ])("ignores %s", (_n, payload) => {
    expect(mapGenericHook(payload, { agent: "gemini-cli" })).toBeNull();
  });

  it("rejects an invalid agent slug", () => {
    expect(
      mapGenericHook({ hook_event_name: "Stop", session_id: "a", cwd }, { agent: "bad agent" }),
    ).toBeNull();
  });
});

describe("runAgentHook", () => {
  it("never throws and reports nothing for junk input", async () => {
    expect(await runAgentHook(["--agent", "cursor"], "not json", {})).toEqual({ note: "" });
    expect(await runAgentHook(["--bogus"], "{}", {})).toMatchObject({ note: expect.any(String) });
    expect(await runAgentHook(["--agent", "Bad_Name"], "{}", {})).toMatchObject({
      note: expect.stringContaining("^[a-z0-9-]{1,24}$"),
    });
    expect(await runAgentHook(["--agent", "a".repeat(25)], "{}", {})).toMatchObject({
      note: expect.stringContaining("^[a-z0-9-]"),
    });
    expect(await runAgentHook(["--agent", "cursor"], "", {})).toEqual({ note: "" });
    expect(await runAgentHook([], "{}", {})).toMatchObject({
      note: expect.stringContaining("phoenix_agent"),
    });
  });

  it("prints exactly {} on stdout and exits 0 even with no Core running (real subprocess)", async () => {
    const child = spawn(
      join(import.meta.dirname, "../../../node_modules/.bin/tsx"),
      [join(import.meta.dirname, "../src/agent-hook.ts"), "--agent", "cursor", "--event", "stop"],
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
    child.stdin.end(JSON.stringify({ conversation_id: "c1", workspace_roots: ["/work/app"] }));
    const closed = Promise.withResolvers<number | null>();
    child.on("close", (status) => closed.resolve(status));
    const code = await closed.promise;
    expect(code).toBe(0);
    expect(stdout).toBe("{}\n");
  });
});

describe("phoenix-agent status|install|uninstall|repair", () => {
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return {
      out,
      err,
      io: { out: (t: string) => void out.push(t), err: (t: string) => void err.push(t) },
    };
  };

  it("status lists agents, install without --yes only prints the diff", async () => {
    const r = rig("claude-code", "{}\n");
    const a = io();
    expect(await runRelayCommand("status", [], a.io, { installer: r.installer })).toBe(0);
    expect(a.out.join("")).toMatch(/claude-code\s+detected\s+not installed/);
    expect(a.out.join("")).toMatch(/hermes\s+not found\s+unsupported \(unsupported:/);

    const b = io();
    expect(
      await runRelayCommand("install", ["claude-code"], b.io, { installer: r.installer }),
    ).toBe(0);
    expect(b.out.join("")).toContain("Nothing was written");
    expect(readFileSync(r.path, "utf8")).toBe("{}\n");
  });

  it("--yes applies, uninstall --yes restores byte for byte", async () => {
    const r = rig("claude-code", '{ "theme":"dark" }');
    const a = io();
    expect(
      await runRelayCommand("install", ["claude-code", "--yes"], a.io, { installer: r.installer }),
    ).toBe(0);
    expect(readFileSync(r.path, "utf8")).toContain("claude-hook.ts");
    expect(
      await runRelayCommand("uninstall", ["claude-code", "--yes"], a.io, {
        installer: r.installer,
      }),
    ).toBe(0);
    expect(readFileSync(r.path, "utf8")).toBe('{ "theme":"dark" }');
  });

  it("explains refusals and bad usage", async () => {
    const r = rig("claude-code", "{ broken");
    const a = io();
    expect(
      await runRelayCommand("install", ["claude-code", "--yes"], a.io, { installer: r.installer }),
    ).toBe(1);
    expect(a.err.join("")).toContain("not valid JSON");
    expect(await runRelayCommand("install", [], a.io, { installer: r.installer })).toBe(2);
    expect(await runRelayCommand("install", ["hermes"], a.io, { installer: r.installer })).toBe(1);
    expect(a.err.join("")).toContain("unsupported");
  });

  it("is reachable through the main CLI (self-test with no relay fails with exit 1)", async () => {
    const out: string[] = [];
    const previous = process.env.PHOENIX_RELAY_SOCKET;
    process.env.PHOENIX_RELAY_SOCKET = join(rig("codex").home, "none.sock");
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
    try {
      expect(await run(["self-test"])).toBe(1);
    } finally {
      spy.mockRestore();
      if (previous === undefined) delete process.env.PHOENIX_RELAY_SOCKET;
      else process.env.PHOENIX_RELAY_SOCKET = previous;
    }
    expect(out.join("")).toMatch(/^FAIL: no relay at/);
  });
});
