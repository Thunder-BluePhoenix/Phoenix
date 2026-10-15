// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The statusLine relay. Claude Code's real status JSON was NOT captured: the payloads here follow
// the public documentation (https://code.claude.com/docs/en/statusline).
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startCore, TOKEN } from "../../../core/runtime/test/helpers";
import {
  THEN_BUDGET_MS,
  parseStatuslineArgs,
  runStatusline,
  runThen,
  type RunThen,
  type StatuslineDeps,
} from "../src/statusline";

const NOW = Date.parse("2026-10-16T10:00:00Z");
const RESETS = Math.floor(NOW / 1000) + 3600;
const SRC = join(import.meta.dirname, "../src");
const TSX = join(import.meta.dirname, "../../../node_modules/.bin/tsx");

const withLimits = JSON.stringify({
  model: { display_name: "Opus" },
  rate_limits: {
    five_hour: { used_percentage: 82, resets_at: RESETS },
    seven_day: { used_percentage: 12, resets_at: RESETS + 86_400 },
  },
});
const noLimits = JSON.stringify({ model: { display_name: "Opus" }, cwd: "/work" });

function deps(over: Partial<StatuslineDeps> = {}) {
  const sent: unknown[] = [];
  const warned: string[] = [];
  const all: StatuslineDeps = {
    runThen: async () => ({ code: 0, stdout: Buffer.alloc(0), timedOut: false }),
    send: async (body) => {
      sent.push(body);
      return { ok: true };
    },
    now: () => NOW,
    warn: (m) => warned.push(m),
    ...over,
  };
  return { all, sent, warned };
}
/** A previous command that echoes exact bytes, recording what stdin it was given. */
function previous(stdout: Buffer, code = 0) {
  const stdins: Buffer[] = [];
  const run: RunThen = async (_cmd, stdin) => {
    stdins.push(stdin);
    return { code, stdout, timedOut: false };
  };
  return { run, stdins };
}

describe("parseStatuslineArgs", () => {
  it("takes --then <command> or the environment", () => {
    expect(parseStatuslineArgs(["--then", "~/.claude/statusline.sh --x"])).toEqual({
      then: "~/.claude/statusline.sh --x",
    });
    expect(parseStatuslineArgs([], { PHOENIX_STATUSLINE_THEN: "cmd" })).toEqual({ then: "cmd" });
    expect(parseStatuslineArgs(["--then", "arg"], { PHOENIX_STATUSLINE_THEN: "env" })).toEqual({
      then: "arg",
    });
    expect(parseStatuslineArgs([])).toEqual({});
    expect(parseStatuslineArgs(["--then", "   "])).toEqual({});
  });
});

describe("runStatusline", () => {
  it("passes the previous command's stdout through byte for byte, with the same stdin, when there are no usage fields", async () => {
    const out = Buffer.from([
      0x1b, 0x5b, 0x33, 0x32, 0x6d, 0x6f, 0x6b, 0x1b, 0x5b, 0x30, 0x6d, 0x0a, 0xff, 0x00, 0xe2,
      0x82,
    ]);
    const prev = previous(out);
    const { all, sent } = deps({ runThen: prev.run });
    const input = Buffer.from(noLimits);
    const r = await runStatusline({ then: "my-statusline" }, input, all);
    expect(Buffer.compare(r.stdout, out)).toBe(0);
    expect(r.exitCode).toBe(0);
    expect(Buffer.compare(prev.stdins[0]!, input)).toBe(0);
    expect(sent).toEqual([]);
  });

  it("with usage fields: forwards ONLY the documented windows to Core and still passes the output through", async () => {
    const out = Buffer.from("[Opus] 82% 5h\n");
    const prev = previous(out);
    const { all, sent } = deps({ runThen: prev.run });
    const r = await runStatusline({ then: "x" }, Buffer.from(withLimits), all);
    expect(r.stdout.toString()).toBe("[Opus] 82% 5h\n");
    expect(sent).toHaveLength(1);
    const body = sent[0] as { agent: string; samples: { window: string; used_pct: number }[] };
    expect(body.agent).toBe("claude-code");
    expect(body.samples.map((s) => [s.window, s.used_pct])).toEqual([
      ["5h", 82],
      ["weekly", 12],
    ]);
    expect(JSON.stringify(body)).not.toContain("Opus");
    expect(JSON.stringify(body)).not.toContain("model");
  });

  it("prints nothing without a previous command, still forwards usage", async () => {
    const { all, sent } = deps();
    const r = await runStatusline({}, Buffer.from(withLimits), all);
    expect(r.stdout).toHaveLength(0);
    expect(r.exitCode).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("a slow previous command is skipped with nothing printed, usage still forwarded", async () => {
    const { all, sent, warned } = deps({
      runThen: async () => ({ code: null, stdout: Buffer.from("partial"), timedOut: true }),
    });
    const r = await runStatusline({ then: "slow" }, Buffer.from(withLimits), all);
    expect(r.stdout).toHaveLength(0);
    expect(r.exitCode).toBe(0);
    expect(sent).toHaveLength(1);
    expect(warned.join()).toMatch(/longer than 1 second/);
  });

  it("a failing previous command keeps its exit code and stdout; a throwing one prints nothing", async () => {
    const failing = previous(Buffer.from("boom\n"), 3);
    const a = await runStatusline(
      { then: "x" },
      Buffer.from(noLimits),
      deps({ runThen: failing.run }).all,
    );
    expect(a.exitCode).toBe(3);
    expect(a.stdout.toString()).toBe("boom\n");
    const b = await runStatusline(
      { then: "x" },
      Buffer.from(noLimits),
      deps({ runThen: () => Promise.reject(new Error("spawn failed")) }).all,
    );
    expect(b.exitCode).toBe(127);
    expect(b.stdout).toHaveLength(0);
  });

  it("Core down or failing never changes the output", async () => {
    const out = Buffer.from("line\n");
    for (const send of [
      async () => ({ ok: false, message: "Phoenix Core is not running" }),
      async () => {
        throw new Error("boom");
      },
    ]) {
      const { all, warned } = deps({ runThen: previous(out).run, send });
      const r = await runStatusline({ then: "x" }, Buffer.from(withLimits), all);
      expect(r.stdout.toString()).toBe("line\n");
      expect(r.exitCode).toBe(0);
      expect(warned.length).toBeGreaterThan(0);
    }
  });

  it("garbage, empty and oversized stdin do not forward anything and do not throw", async () => {
    for (const input of [
      Buffer.alloc(0),
      Buffer.from("not json"),
      Buffer.from("[1,2]"),
      Buffer.alloc(5_000_000, 0x20),
    ]) {
      const { all, sent } = deps();
      const r = await runStatusline({}, input, all);
      expect(r.exitCode).toBe(0);
      expect(sent).toEqual([]);
    }
  });
});

describe("runThen (real subprocesses, short budgets)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  function script(body: string): string {
    const dir = mkdtempSync(join(tmpdir(), "phoenix-statusline-"));
    dirs.push(dir);
    const file = join(dir, "prev.cjs");
    writeFileSync(file, `#!/usr/bin/env node\n${body}\n`);
    chmodSync(file, 0o755);
    return file;
  }

  it("echoes the same stdin and relays stdout unchanged", async () => {
    const file = script("process.stdin.pipe(process.stdout)");
    const input = Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x31, 0x7d, 0x0a, 0xff, 0xfe]);
    const r = await runThen(`"${process.execPath}" "${file}"`, input, 5_000);
    expect(r.timedOut).toBe(false);
    expect(Buffer.compare(r.stdout, input)).toBe(0);
  });

  it("kills a command that outlives its budget", async () => {
    const file = script("process.stdin.resume(); setTimeout(() => {}, 60_000)");
    const r = await runThen(`"${process.execPath}" "${file}"`, Buffer.from("{}"), 300);
    expect(r.timedOut).toBe(true);
    expect(r.stdout).toHaveLength(0);
  });

  it("reports the exit code of a failing command", async () => {
    const file = script("process.stdout.write('x'); process.exit(7)");
    const r = await runThen(`"${process.execPath}" "${file}"`, Buffer.from("{}"), 5_000);
    expect(r.code).toBe(7);
    expect(r.stdout.toString()).toBe("x");
  });
});

describe("statusline.ts as a process against a real Core", () => {
  const cleanup: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const c of cleanup.splice(0).reverse()) await c();
  });

  function run(args: string[], env: Record<string, string>, stdin: string) {
    const child = spawn(TSX, [join(SRC, "statusline.ts"), ...args], {
      env: { ...process.env, PHOENIX_SESSION_TOKEN: TOKEN, ...env },
    });
    const out: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
    const closed = Promise.withResolvers<{ status: number | null; stdout: Buffer }>();
    child.on("close", (status) => closed.resolve({ status, stdout: Buffer.concat(out) }));
    return closed.promise;
  }

  it("relays usage to Core, prints the previous command's output unchanged, and Core warns once", async () => {
    const c = await startCore();
    cleanup.push(() => c.runtime.stop());
    const dir = mkdtempSync(join(tmpdir(), "phoenix-statusline-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const prev = join(dir, "prev.cjs");
    writeFileSync(prev, "process.stdin.resume(); process.stdout.write('PREV-OUTPUT\\n')");
    const env = { PHOENIX_CORE_URL: c.base };
    const now = Date.now();
    const status = JSON.stringify({
      rate_limits: { five_hour: { used_percentage: 82, resets_at: Math.floor(now / 1000) + 3600 } },
    });
    const r = await run(["--then", `"${process.execPath}" "${prev}"`], env, status);
    expect(r.status).toBe(0);
    expect(r.stdout.toString()).toBe("PREV-OUTPUT\n");
    const usage = (await c.api("GET", "/api/agent/usage")).json;
    expect(usage.usage).toMatchObject([
      { agent: "claude-code", window: "5h", used_pct: 82, level: "warn" },
    ]);
    await run([], env, status);
    const warnings = c.runtime.events
      .recent({ limit: 50 })
      .filter((e) => e.event.event_type === "agent.usage.warning");
    expect(warnings).toHaveLength(1);
  }, 30_000);

  it("exits quickly and prints the previous output even when Core is not running", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phoenix-statusline-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const prev = join(dir, "prev.cjs");
    writeFileSync(prev, "process.stdin.resume(); process.stdout.write('ok\\n')");
    const status = JSON.stringify({
      rate_limits: {
        five_hour: { used_percentage: 5, resets_at: Math.floor(Date.now() / 1000) + 3600 },
      },
    });
    const r = await run(
      ["--then", `"${process.execPath}" "${prev}"`],
      { PHOENIX_CORE_URL: "http://127.0.0.1:9", PHOENIX_RELAY_SOCKET: join(dir, "none.sock") },
      status,
    );
    expect(r.status).toBe(0);
    expect(r.stdout.toString()).toBe("ok\n");
  }, 30_000);

  it("budget constant is one second", () => {
    expect(THEN_BUDGET_MS).toBe(1_000);
  });
});
