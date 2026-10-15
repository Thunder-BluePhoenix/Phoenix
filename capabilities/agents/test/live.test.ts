// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 58 end to end against a real in-process Core: the real claude-hook.ts as a subprocess fed
// recorded-shape PostToolUse payloads (never a real Claude Code), the HTTP routes, the WebSocket
// push of step events, the relay `step`/`usage` ops, jump-to-terminal with a fake focuser, and the
// on-demand diff from real git in a temp repository.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connect, startCore, TOKEN, type TestCore } from "../../../core/runtime/test/helpers";
import { agentsCapability, type TerminalFocuser } from "../src";
import { relayCall } from "../src/relay/client";
import { relaySocketPath } from "../src/relay/protocol";
import { sendLive } from "../src/live-send";
import { HOOKS, SESSION } from "./fixtures";

const SRC = join(import.meta.dirname, "../src");
const TSX = join(import.meta.dirname, "../../../node_modules/.bin/tsx");

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});

function hook(payload: unknown, env: Record<string, string>) {
  const child = spawn(TSX, [join(SRC, "claude-hook.ts")], {
    env: { ...process.env, PHOENIX_SESSION_TOKEN: TOKEN, ...env },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (c: Buffer) => (stdout += c));
  child.stderr.on("data", (c: Buffer) => (stderr += c));
  child.stdin.on("error", () => {});
  child.stdin.end(JSON.stringify(payload));
  const closed = Promise.withResolvers<{ status: number | null; stdout: string; stderr: string }>();
  child.on("close", (status) => closed.resolve({ status, stdout, stderr }));
  return closed.promise;
}

function repo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "phoenix-live-core-")));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  writeFileSync(join(dir, "a.ts"), "one\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["-c", "user.email=t@e.x", "-c", "user.name=t", "commit", "-qm", "i"], {
    cwd: dir,
  });
  return dir;
}

async function core(focuser?: TerminalFocuser): Promise<TestCore> {
  const c = await startCore(
    {},
    {
      capabilities: [agentsCapability],
      runtime: focuser ? { terminalFocuser: focuser } : {},
    },
  );
  cleanup.push(() => c.runtime.stop());
  await c.api("POST", "/api/capabilities/agents/enable", {});
  return c;
}

const post = (cwd: string, tool_name: string, tool_input: unknown) => ({
  ...HOOKS.PostToolUse,
  cwd,
  tool_name,
  tool_input,
  tool_response: { stdout: "SECRET TOOL OUTPUT" },
});

describe("claude-hook.ts PostToolUse → step in Core", () => {
  it("sends a state report AND a step, writes nothing to stdout, exits 0, and leaks no tool output", async () => {
    const c = await core();
    const cwd = repo();
    const r = await hook(post(cwd, "Bash", { command: "npm test" }), { PHOENIX_CORE_URL: c.base });
    expect(r).toEqual({ status: 0, stdout: "", stderr: "" });
    await vi.waitFor(async () => {
      const detail = (await c.api("GET", `/api/agent/sessions/${SESSION}`)).json;
      expect(detail.steps).toMatchObject([{ kind: "run", tool: "Bash", target: "npm test", n: 1 }]);
    });
    expect(
      JSON.stringify((await c.api("GET", `/api/agent/sessions/${SESSION}`)).json),
    ).not.toContain("SECRET TOOL OUTPUT");
    // The existing state report still happened.
    await vi.waitFor(() => expect(c.runtime.state.snapshot().state).toBe("WORKING"));
  });

  it("still exits 0 with an empty stdout when Core is down", async () => {
    const r = await hook(HOOKS.PostToolUse, { PHOENIX_CORE_URL: "http://127.0.0.1:9" });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/not reported/);
  });

  it("an Edit hook produces the file tally; the full diff is computed on demand", async () => {
    const c = await core();
    const cwd = repo();
    writeFileSync(join(cwd, "a.ts"), "one\ntwo\n");
    const file = join(cwd, "a.ts");
    await hook(post(cwd, "Edit", { file_path: file, old_string: "one", new_string: "one\ntwo" }), {
      PHOENIX_CORE_URL: c.base,
    });
    await vi.waitFor(async () => {
      const detail = (await c.api("GET", `/api/agent/sessions/${SESSION}`)).json;
      expect(detail.files).toMatchObject([{ path: file, added: 1, removed: 0, edits: 1 }]);
    });
    const diff = await c.api(
      "GET",
      `/api/agent/sessions/${SESSION}/diff/${encodeURIComponent(file)}`,
    );
    expect(diff.status).toBe(200);
    expect(diff.json).toMatchObject({
      session_id: SESSION,
      path: "a.ts",
      source: "git diff HEAD",
      truncated: false,
    });
    expect(diff.json.diff).toContain("+two");

    const escape = await c.api(
      "GET",
      `/api/agent/sessions/${SESSION}/diff/${encodeURIComponent("../../etc/passwd")}`,
    );
    expect(escape.status).toBe(400);
    const abs = await c.api(
      "GET",
      `/api/agent/sessions/${SESSION}/diff/${encodeURIComponent("/etc/passwd")}`,
    );
    expect(abs.status).toBe(400);
    expect(JSON.stringify(abs.json)).not.toContain("root:");
  });
});

describe("routes", () => {
  it("need the session token", async () => {
    const c = await core();
    for (const [method, path] of [
      ["GET", "/api/agent/sessions"],
      ["GET", `/api/agent/sessions/${SESSION}`],
      ["GET", `/api/agent/sessions/${SESSION}/export.md`],
      ["POST", `/api/agent/sessions/${SESSION}/focus-terminal`],
      ["GET", "/api/agent/usage"],
      ["POST", "/api/agent/live/step"],
      ["POST", "/api/agent/live/usage"],
    ] as const) {
      const res = await fetch(c.base + path, { method });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it("a malformed step or usage body is a 400 and publishes nothing", async () => {
    const c = await core();
    expect((await c.api("POST", "/api/agent/live/step", { project: "rel" })).status).toBe(400);
    expect((await c.api("POST", "/api/agent/live/usage", { agent: "x", samples: [] })).status).toBe(
      400,
    );
    expect((await c.api("GET", "/api/agent/sessions/unknown-id")).status).toBe(404);
  });

  it("serves the export as text/markdown with nosniff, with hostile text escaped", async () => {
    const c = await core();
    const cwd = repo();
    await c.api("POST", "/api/agent/live/step", {
      agent: "claude-code",
      session_id: SESSION,
      project: cwd,
      kind: "run",
      tool: "Bash",
      target: "echo [x](javascript:alert(1)) <img src=x onerror=1>",
      at: new Date().toISOString(),
    });
    const res = await fetch(`${c.base}/api/agent/sessions/${SESSION}/export.md`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/markdown/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const md = await res.text();
    expect(md).toContain("# Agent session");
    expect(md).toContain("` echo [x](javascript:alert(1)) <img src=x onerror=1> `");
    expect(md.replace(/(`+) .*? \1/g, "")).not.toMatch(/<img/);
  });
});

describe("live push to the web", () => {
  it("a step reaches a WebSocket client as an event.created with seq null", async () => {
    const c = await core();
    const cwd = repo();
    const ws = connect(c.port);
    cleanup.push(() => ws.ws.close());
    await ws.opened;
    ws.send({ type: "subscribe", channels: ["event.created"] });
    await ws.next((m) => m.type === "subscribed");
    expect(
      (
        await c.api("POST", "/api/agent/live/step", {
          agent: "claude-code",
          session_id: SESSION,
          project: cwd,
          kind: "read",
          tool: "Read",
          target: `${cwd}/a.ts`,
          at: new Date().toISOString(),
        })
      ).json,
    ).toEqual({ accepted: true, n: 1 });
    const msg = await ws.next(
      (m) =>
        m.type === "message" &&
        m.channel === "event.created" &&
        m.data.event.event_type === "agent.session.step",
    );
    expect(msg.data.seq).toBeNull();
    expect(msg.data.event.payload).toMatchObject({
      session_id: SESSION,
      kind: "read",
      tool: "Read",
      n: 1,
    });
    // Not history: nothing was stored.
    expect(
      c.runtime.events
        .recent({ limit: 100 })
        .filter((e) => e.event.event_type === "agent.session.step"),
    ).toEqual([]);
  });
});

describe("relay ops step and usage", () => {
  it("are served by Core's live sessions over the owner-only socket, and sendLive prefers the relay", async () => {
    const c = await core();
    const cwd = repo();
    const socketPath = relaySocketPath(c.dataDir);
    const body = {
      agent: "claude-code",
      session_id: SESSION,
      project: cwd,
      kind: "run",
      tool: "Bash",
      target: "ls",
      at: new Date().toISOString(),
    };
    expect(await relayCall("step", body, { socketPath, timeoutMs: 3_000 })).toMatchObject({
      ok: true,
      result: { accepted: true, n: 1 },
    });
    expect(
      await relayCall("step", { ...body, kind: "bogus" }, { socketPath, timeoutMs: 3_000 }),
    ).toMatchObject({
      ok: false,
      kind: "rejected",
    });
    expect(await sendLive("step", body, { relay: { socketPath }, timeoutMs: 3_000 })).toEqual({
      ok: true,
    });
    const usage = {
      agent: "claude-code",
      samples: [
        { window: "5h", used_pct: 85, resets_at: new Date(Date.now() + 3600_000).toISOString() },
      ],
    };
    expect(await relayCall("usage", usage, { socketPath, timeoutMs: 3_000 })).toMatchObject({
      ok: true,
      result: { accepted: 1 },
    });
    const detail = (await c.api("GET", `/api/agent/sessions/${SESSION}`)).json;
    expect(detail.steps).toHaveLength(2);
    expect((await c.api("GET", "/api/agent/usage")).json.usage).toMatchObject([
      { used_pct: 85, level: "warn" },
    ]);
  });

  it("sendLive falls back to HTTP when the relay is not there, and reports a refusal without falling back", async () => {
    const c = await core();
    const cwd = repo();
    const body = {
      agent: "claude-code",
      session_id: SESSION,
      project: cwd,
      kind: "run",
      tool: "Bash",
      target: "ls",
      at: new Date().toISOString(),
    };
    const dead = join(cwd, "none.sock");
    expect(
      await sendLive("step", body, {
        relay: { socketPath: dead },
        coreUrl: c.base,
        token: TOKEN,
        timeoutMs: 3_000,
      }),
    ).toEqual({ ok: true });
    const refused = await sendLive(
      "step",
      { ...body, kind: "bogus" },
      { coreUrl: c.base, token: TOKEN, relay: false },
    );
    expect(refused.ok).toBe(false);
  });
});

describe("jump to terminal", () => {
  it("asks for confirmation first (the HTTP call blocks), then focuses with the reported tty", async () => {
    const focused: unknown[] = [];
    const c = await core({
      platform: "linux",
      focus: async (target) => {
        focused.push(target);
        return { focused: true, method: "fake" };
      },
    });
    const cwd = repo();
    await c.api("POST", "/api/agent/live/step", {
      agent: "claude-code",
      session_id: SESSION,
      project: cwd,
      kind: "run",
      tool: "Bash",
      target: "ls",
      at: new Date().toISOString(),
      tty: "/dev/ttys009",
    });
    const pending = c.api("POST", `/api/agent/sessions/${SESSION}/focus-terminal`, {});
    const confirmation = await vi.waitFor(async () => {
      const list = (await c.api("GET", "/api/confirmations")).json.confirmations as {
        id: string;
        capabilityId: string;
        command: string;
        sideEffect: string;
      }[];
      const found = list.find((x) => x.command === "session.focus_terminal");
      expect(found).toBeDefined();
      return found!;
    });
    expect(confirmation).toMatchObject({ capabilityId: "agents", sideEffect: "execute" });
    expect(focused).toEqual([]);
    await c.api("POST", `/api/confirmations/${confirmation.id}`, { approve: true });
    const res = await pending;
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ focused: true, method: "fake" });
    expect(focused).toEqual([{ project: cwd, tty: "/dev/ttys009" }]);
    const audit = (await c.api("GET", "/api/audit?capability=agents")).json.entries as {
      action: string;
    }[];
    expect(audit.map((a) => a.action)).toContain("action.succeeded");
  });

  it("a declined confirmation focuses nothing", async () => {
    const focused: unknown[] = [];
    const c = await core({
      platform: "linux",
      focus: async (target) => {
        focused.push(target);
        return { focused: true, method: "fake" };
      },
    });
    await c.api("POST", "/api/agent/live/step", {
      agent: "claude-code",
      session_id: SESSION,
      project: repo(),
      kind: "run",
      tool: "Bash",
      target: "ls",
      at: new Date().toISOString(),
    });
    const pending = c.api("POST", `/api/agent/sessions/${SESSION}/focus-terminal`, {});
    const id = await vi.waitFor(async () => {
      const list = (await c.api("GET", "/api/confirmations")).json.confirmations as {
        id: string;
        command: string;
      }[];
      const found = list.find((x) => x.command === "session.focus_terminal");
      expect(found).toBeDefined();
      return found!.id;
    });
    await c.api("POST", `/api/confirmations/${id}`, { approve: false });
    expect((await pending).status).toBe(403);
    expect(focused).toEqual([]);
  });
});

describe("plan usage warnings", () => {
  it("emit one durable warning event per threshold per window through the API, shown by the state engine description", async () => {
    const c = await core();
    const usage = (pct: number) => ({
      agent: "claude-code",
      samples: [
        { window: "5h", used_pct: pct, resets_at: new Date(Date.now() + 3600_000).toISOString() },
      ],
    });
    for (const pct of [70, 81, 82, 96, 97]) {
      expect((await c.api("POST", "/api/agent/live/usage", usage(pct))).status).toBe(200);
    }
    const warnings = c.runtime.events
      .recent({ limit: 50 })
      .filter((e) => e.event.event_type === "agent.usage.warning")
      .map((e) => e.event.payload.threshold)
      .reverse();
    expect(warnings).toEqual([80, 95]);
    const notes = (await c.api("GET", "/api/notifications")).json.notifications as {
      eventType: string;
      title: string;
    }[];
    expect(notes.find((n) => n.eventType === "agent.usage.warning")?.title).toMatch(
      /5h plan usage is at/,
    );
    expect(
      (await c.api("POST", "/api/agent/usage/settings", { thresholds: [50, 90] })).json,
    ).toEqual({
      thresholds: [50, 90],
    });
    expect((await c.api("GET", "/api/agent/usage")).json).toMatchObject({
      thresholds: [50, 90],
      unsupported: [{ agent: "codex" }],
    });
  });
});
