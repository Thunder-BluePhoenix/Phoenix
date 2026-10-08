// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The adapters as real subprocesses against a real Phoenix Core (Phase 25 exit criterion:
// Fawkes reflects an external agent waiting for input), plus the "never fail the agent" contract.
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startCore, TOKEN } from "../../../core/runtime/test/helpers";
import { agentsCapability } from "../src";
import { HOOKS, SESSION } from "./fixtures";

const SRC = join(import.meta.dirname, "../src");
const TSX = join(import.meta.dirname, "../../../node_modules/.bin/tsx");

interface Outcome {
  status: number | null;
  stdout: string;
  stderr: string;
}

// Async on purpose: Core runs in this process and must keep serving while the CLI runs.
function runCli(file: string, args: string[], env: Record<string, string>, stdin?: string) {
  const child = spawn(TSX, [join(SRC, file), ...args], {
    env: { ...process.env, PHOENIX_SESSION_TOKEN: TOKEN, ...env },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (c: Buffer) => (stdout += c));
  child.stderr.on("data", (c: Buffer) => (stderr += c));
  if (stdin === undefined) child.stdin.end();
  else child.stdin.end(stdin);
  return new Promise<Outcome>((resolve) =>
    child.on("close", (status) => resolve({ status, stdout, stderr })),
  );
}
const hook = (payload: unknown, env: Record<string, string>, args: string[] = []) =>
  runCli(
    "claude-hook.ts",
    args,
    env,
    typeof payload === "string" ? payload : JSON.stringify(payload),
  );

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});

const agentEvents = (c: {
  runtime: { events: { recent(o: { limit: number }): { event: { event_type: string } }[] } };
}) =>
  c.runtime.events
    .recent({ limit: 50 })
    .map((e) => e.event.event_type)
    .filter((t) => t.startsWith("agent."));

async function core() {
  const c = await startCore({}, { capabilities: [agentsCapability] });
  cleanup.push(() => c.runtime.stop());
  await c.api("POST", "/api/capabilities/agents/enable", {});
  const state = () => c.runtime.state.snapshot();
  return { ...c, state };
}

describe("claude-hook.ts against a real Core", () => {
  it("a recorded Notification hook makes Fawkes WAITING with a notification", async () => {
    const c = await core();
    expect(await hook(HOOKS.UserPromptSubmit, { PHOENIX_CORE_URL: c.base })).toMatchObject({
      status: 0,
      stdout: "",
      stderr: "",
    });
    await vi.waitFor(() => expect(c.state().state).toBe("WORKING"));

    const r = await hook(HOOKS.NotificationPermission, { PHOENIX_CORE_URL: c.base });
    expect(r).toEqual({ status: 0, stdout: "", stderr: "" });
    await vi.waitFor(() => expect(c.state()).toMatchObject({ state: "WAITING", source: "agents" }));
    expect(c.state().explanation).toBe("claude-code needs your input (phoenix)");

    const notes = (await c.api("GET", "/api/notifications")).json.notifications as {
      title: string;
      eventType: string;
    }[];
    expect(notes).toMatchObject([
      { eventType: "agent.waiting", title: "claude-code needs your input (phoenix)" },
    ]);

    const list = (await c.api("POST", "/api/capabilities/agents/commands/list", {})).json;
    await vi.waitFor(async () => {
      const op = (await c.api("GET", `/api/operations/${list.id}`)).json;
      expect(op.result.agents).toMatchObject([
        { agent: "claude-code", agent_id: SESSION, state: "waiting", reason: "permission" },
      ]);
    });
  });

  it("the full session: started → working → waiting → working → completed → ended", async () => {
    const c = await core();
    const env = { PHOENIX_CORE_URL: c.base };
    let sent = 0;
    for (const name of [
      "SessionStart",
      "UserPromptSubmit",
      "NotificationPermission",
      "PostToolUse",
      "Stop",
    ] as const) {
      expect(await hook(HOOKS[name], env)).toMatchObject({ status: 0, stdout: "" });
      // Each hook is a separate process and Core accepts reports asynchronously: wait for this
      // hook's event before the next, like the seconds between hooks in a real session.
      sent += 1;
      await vi.waitFor(() => expect(agentEvents(c)).toHaveLength(sent));
    }
    await vi.waitFor(() => expect(c.state().state).toBe("SUCCESS"));
    const types = agentEvents(c);
    expect(types).toEqual([
      "agent.completed",
      "agent.working",
      "agent.waiting",
      "agent.working",
      "agent.started",
    ]);
  });

  it("exits 0 and stays silent on stdout when Core is not running", async () => {
    const r = await hook(HOOKS.Stop, { PHOENIX_CORE_URL: "http://127.0.0.1:9" });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/not reported/);
  });

  it("exits 0 when there is no session token at all", async () => {
    const r = await hook(HOOKS.Stop, {
      PHOENIX_SESSION_TOKEN: "",
      PHOENIX_DATA_DIR: "/nonexistent",
      HOME: "/nonexistent",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("exits 0 when Core accepts the connection and never answers", async () => {
    const received = Promise.withResolvers<IncomingMessage>();
    const server: Server = createServer((req) => received.resolve(req)); // never responds
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    cleanup.push(() => {
      server.closeAllConnections();
      server.close();
    });
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await hook(HOOKS.Stop, { PHOENIX_CORE_URL: url });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    const req = await received.promise; // the hook really did call out before giving up
    expect(req.url).toBe("/api/capabilities/agents/commands/report");
    expect(req.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("exits 0 when Core answers with an error", async () => {
    const server = createServer((_req, res) => {
      res.statusCode = 500;
      res.end("{broken");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    cleanup.push(() => void server.close());
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await hook(HOOKS.Stop, { PHOENIX_CORE_URL: url });
    expect(r).toMatchObject({ status: 0, stdout: "" });
    expect(r.stderr).toMatch(/HTTP 500/);
  });

  it("does not follow a redirect (the session token must not leave for another URL)", async () => {
    const target = createServer();
    const hit = vi.fn();
    target.on("request", hit);
    await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
    const targetUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}/steal`;
    const server = createServer((_req, res) => {
      res.statusCode = 307;
      res.setHeader("location", targetUrl);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    cleanup.push(() => void (target.close(), server.close()));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await hook(HOOKS.Stop, { PHOENIX_CORE_URL: url });
    expect(r.status).toBe(0);
    expect(hit).not.toHaveBeenCalled();
  });

  it.each([
    ["not JSON", "hello"],
    ["empty stdin", ""],
    ["an unfollowed hook", JSON.stringify(HOOKS.PreToolUse)],
    ["a relative cwd", JSON.stringify({ ...HOOKS.Stop, cwd: "rel" })],
    ["over a megabyte", JSON.stringify({ ...HOOKS.Stop, prompt: "x".repeat(1_100_000) })],
  ])("reports nothing and exits 0 for %s", async (_name, stdin) => {
    const c = await core();
    const r = await hook(stdin, { PHOENIX_CORE_URL: c.base });
    expect(r).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(
      c.runtime.events.recent({ limit: 50 }).some((e) => e.event.event_type.startsWith("agent.")),
    ).toBe(false);
  });

  it("gives up on a stdin that never closes within its 2 s budget", async () => {
    const child = spawn(TSX, [join(SRC, "claude-hook.ts")], { env: process.env });
    const closed = new Promise<number | null>((r) => child.on("close", r));
    child.stdin.write("{");
    expect(await closed).toBe(0);
  });

  it("--task-from-prompt adds a hard-truncated title, which Core drops unless include_prompt_title is on", async () => {
    const c = await core();
    await hook(HOOKS.UserPromptSubmit, { PHOENIX_CORE_URL: c.base }, ["--task-from-prompt"]);
    await vi.waitFor(() => expect(c.state().state).toBe("WORKING"));
    const event = c.runtime.events
      .recent({ limit: 5 })
      .find((e) => e.event.event_type === "agent.working")!;
    expect(event.event.payload).not.toHaveProperty("task");

    // Configuration is read when the capability is enabled.
    await c.api("POST", "/api/capabilities/agents/disable", {});
    await c.api("POST", "/api/capabilities/agents/config", {
      config: { include_prompt_title: true },
    });
    await c.api("POST", "/api/capabilities/agents/enable", {});
    await hook({ ...HOOKS.UserPromptSubmit, session_id: "other" }, { PHOENIX_CORE_URL: c.base }, [
      "--task-from-prompt",
    ]);
    await vi.waitFor(() =>
      expect(
        c.runtime.events.recent({ limit: 5 }).find((e) => e.event.payload.agent_id === "other")
          ?.event.payload.task,
      ).toBe("Fix the flaky retry test in the sync module"),
    );
  });
});

describe("cli.ts (phoenix-agent)", () => {
  const report = (c: { base: string }, ...args: string[]) =>
    runCli("cli.ts", ["report", ...args], { PHOENIX_CORE_URL: c.base });

  it("report --state waiting makes Fawkes WAITING for a tool without a dedicated adapter", async () => {
    const c = await core();
    const r = await report(
      c,
      "--agent",
      "codex",
      "--id",
      "run-7",
      "--workspace",
      "/tmp/svc",
      "--state",
      "waiting",
      "--reason",
      "input",
    );
    expect(r).toEqual({ status: 0, stdout: "", stderr: "" });
    await vi.waitFor(() =>
      expect(c.state()).toMatchObject({
        state: "WAITING",
        explanation: "codex needs your input (svc)",
      }),
    );
  });

  it("derives a stable session id from the agent and directory when --id is omitted", async () => {
    const c = await core();
    await report(c, "--agent", "codex", "--workspace", "/tmp/svc", "--state", "working");
    await report(c, "--agent", "codex", "--workspace", "/tmp/svc", "--state", "completed");
    await vi.waitFor(() => expect(c.state().state).toBe("SUCCESS"));
    const ids = new Set(
      c.runtime.events
        .recent({ limit: 10 })
        .map((e) => e.event.correlation_id)
        .filter((id) => id?.startsWith("agent-")),
    );
    expect(ids.size).toBe(1);
  });

  it.each([
    ["a bad state", ["--agent", "codex", "--state", "dancing"]],
    ["no agent", ["--state", "working"]],
    [
      "a relative workspace is made absolute, but a reason needs waiting",
      ["--agent", "codex", "--state", "working", "--reason", "input"],
    ],
    ["an unknown flag", ["--agent", "codex", "--state", "working", "--shell", "rm"]],
  ])("rejects %s with exit 2 and does not call Core", async (_name, args) => {
    const hit = vi.fn();
    const server = createServer(hit);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    cleanup.push(() => void server.close());
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await runCli("cli.ts", ["report", ...args], { PHOENIX_CORE_URL: url });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Usage/);
    expect(hit).not.toHaveBeenCalled();
  });

  it("is best-effort: exits 0 when Core is down", async () => {
    const r = await runCli("cli.ts", ["report", "--agent", "codex", "--state", "working"], {
      PHOENIX_CORE_URL: "http://127.0.0.1:9",
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/not reported/);
  });

  it("claude-hooks prints the hooks block and writes nothing", async () => {
    const r = await runCli("cli.ts", ["claude-hooks", "--task-from-prompt"], {});
    expect(r.status).toBe(0);
    const config = JSON.parse(r.stdout) as {
      hooks: Record<string, { hooks: { type: string; command: string }[] }[]>;
    };
    expect(Object.keys(config.hooks)).toContain("Notification");
    const command = config.hooks.Notification![0]!.hooks[0]!.command;
    expect(command).toContain("claude-hook.ts");
    expect(command).toContain("--task-from-prompt");
    expect(command).toContain("node_modules/.bin/tsx");
  });
});
