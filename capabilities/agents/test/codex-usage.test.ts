// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Codex plan usage through an INJECTED app-server (Phase 58). The replies are the documented
// `account/rateLimits/read` example of https://developers.openai.com/codex/app-server with the
// window changed to the plan's 300 minutes. The real `codex` binary is not installed on the machine
// this was written on and was never run: everything here talks to a scripted fake.
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli";
import {
  codexUsageBody,
  readCodexRateLimits,
  type AppServerLauncher,
  type AppServerSession,
} from "../src/codex-usage";
import { validateUsage } from "../src/usage";

const RESETS = Math.floor(Date.now() / 1000) + 3_600;
const OFFICIAL_RESULT = {
  rateLimits: {
    limitId: "codex",
    limitName: null,
    primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: RESETS },
    secondary: { usedPercent: 60, windowDurationMins: 10_080, resetsAt: RESETS + 86_400 },
    rateLimitReachedType: null,
  },
  rateLimitResetCredits: { availableCount: 2, credits: null },
};

interface Fake {
  launch: AppServerLauncher;
  written: Array<Record<string, any>>;
  closed: () => boolean;
}

/** A fake `codex app-server`: `reply` turns each written message into the lines it answers with. */
function fake(reply: (message: Record<string, any>) => string[]): Fake {
  const written: Array<Record<string, any>> = [];
  let closed = false;
  const queue: string[] = [];
  let wake: (() => void) | undefined;
  const session: AppServerSession = {
    write(line) {
      const message = JSON.parse(line) as Record<string, any>;
      written.push(message);
      queue.push(...reply(message));
      wake?.();
    },
    lines: (async function* () {
      while (!closed) {
        while (queue.length > 0) yield queue.shift()!;
        await new Promise<void>((resolve) => (wake = resolve));
      }
    })(),
    close() {
      closed = true;
      wake?.();
    },
  };
  return { launch: () => session, written, closed: () => closed };
}

const official = (m: Record<string, any>): string[] => {
  if (m.method === "initialize") {
    return [
      "not json: a log line",
      JSON.stringify({ id: m.id, result: { userAgent: "codex/0", platformFamily: "unix" } }),
    ];
  }
  if (m.method === "account/rateLimits/read") {
    return [
      JSON.stringify({ method: "account/rateLimits/updated", params: {} }),
      JSON.stringify({ id: m.id, result: OFFICIAL_RESULT }),
    ];
  }
  return [];
};

describe("readCodexRateLimits", () => {
  it("speaks the documented handshake: initialize, initialized, one account/rateLimits/read, then stops", async () => {
    const f = fake(official);
    const result = await readCodexRateLimits(f.launch, { nowMs: Date.now() });
    expect(result).toMatchObject({
      ok: true,
      samples: [
        { agent: "codex", window: "5h", used_pct: 25, reset_credits: 2 },
        { agent: "codex", window: "weekly", used_pct: 60, reset_credits: 2 },
      ],
    });
    expect(f.written.map((m) => m.method)).toEqual([
      "initialize",
      "initialized",
      "account/rateLimits/read",
    ]);
    // the stable API surface only, and no thread, turn, prompt or login request
    expect(JSON.stringify(f.written)).not.toContain("experimentalApi");
    expect(JSON.stringify(f.written)).not.toMatch(/thread|turn|input|login|auth/i);
    expect(f.closed()).toBe(true);
  });

  it("accepts the read result only for the id it asked with, and stops on an error reply", async () => {
    const wrongId = fake((m) =>
      m.method === "initialize"
        ? [JSON.stringify({ id: 0, result: {} })]
        : m.method === "account/rateLimits/read"
          ? [JSON.stringify({ id: 99, result: OFFICIAL_RESULT })]
          : [],
    );
    expect(await readCodexRateLimits(wrongId.launch, { timeoutMs: 200 })).toMatchObject({
      ok: false,
      message: expect.stringContaining("within the time limit"),
    });
    expect(wrongId.closed()).toBe(true);

    const refused = fake((m) =>
      m.method === "initialize"
        ? [JSON.stringify({ id: 0, result: {} })]
        : [JSON.stringify({ id: m.id, error: { code: -32001, message: "Server overloaded" } })],
    );
    const result = await readCodexRateLimits(refused.launch);
    expect(result).toEqual({ ok: false, message: expect.stringContaining("error -32001") });
    // the server's own message text is never passed on
    expect(JSON.stringify(result)).not.toContain("overloaded");
  });

  it("fails cleanly when the process ends early, cannot start, or sends too much", async () => {
    const early = fake((m) => (m.method === "initialize" ? [] : []));
    const ended = readCodexRateLimits(early.launch, { timeoutMs: 5_000 });
    early.launch().close(); // the process ends before it answers
    expect(await ended).toMatchObject({ ok: false });

    const missing: AppServerLauncher = () => {
      throw Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" });
    };
    expect(await readCodexRateLimits(missing)).toEqual({
      ok: false,
      message: "codex was not found on PATH",
    });

    const noisy = fake((m) => (m.method === "initialize" ? Array(300).fill("noise") : []));
    expect(await readCodexRateLimits(noisy.launch, { timeoutMs: 2_000 })).toMatchObject({
      ok: false,
    });
    expect(noisy.closed()).toBe(true);
  });

  it("yields no sample (not a guess) when Codex reports only a window that is not a plan window", async () => {
    const f = fake((m) =>
      m.method === "initialize"
        ? [JSON.stringify({ id: 0, result: {} })]
        : [
            JSON.stringify({
              id: m.id,
              result: {
                rateLimits: {
                  primary: { usedPercent: 25, windowDurationMins: 15, resetsAt: RESETS },
                },
              },
            }),
          ],
    );
    expect(await readCodexRateLimits(f.launch)).toEqual({ ok: true, samples: [] });
  });
});

describe("codexUsageBody", () => {
  it("is accepted by Core's own validation and carries nothing but the window numbers", async () => {
    const read = await readCodexRateLimits(fake(official).launch);
    if (!read.ok) throw new Error("fixture failed");
    const body = codexUsageBody(read.samples);
    const checked = validateUsage(body, Date.now());
    expect(checked.ok).toBe(true);
    expect(body.samples).toHaveLength(2);
    expect(Object.keys(body.samples[0]!).sort()).toEqual([
      "reset_credits",
      "resets_at",
      "used_pct",
      "window",
    ]);
  });
});

describe("phoenix-agent codex-usage", () => {
  const servers: Array<ReturnType<typeof createServer>> = [];
  afterEach(() => {
    for (const s of servers.splice(0)) s.close();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function fakeCore(): Promise<{ bodies: unknown[] }> {
    const bodies: unknown[] = [];
    const server = createServer((req: IncomingMessage, res) => {
      let text = "";
      req.on("data", (c: Buffer) => (text += c));
      req.on("end", () => {
        if (req.url === "/api/agent/live/usage") bodies.push(JSON.parse(text));
        res.writeHead(200, { "content-type": "application/json" }).end("{}");
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    vi.stubEnv("PHOENIX_CORE_URL", `http://127.0.0.1:${address.port}`);
    vi.stubEnv("PHOENIX_SESSION_TOKEN", "t");
    return { bodies };
  }

  it("sends the plan windows read from the injected app-server to Core's usage route", async () => {
    const core = await fakeCore();
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((t) => (out.push(String(t)), true));
    const code = await run(["codex-usage"], { codexAppServer: fake(official).launch });
    expect(code).toBe(0);
    expect(core.bodies).toHaveLength(1);
    expect(core.bodies[0]).toMatchObject({
      agent: "codex",
      samples: [
        { window: "5h", used_pct: 25, reset_credits: 2 },
        { window: "weekly", used_pct: 60, reset_credits: 2 },
      ],
    });
    expect(out.join("")).toMatch(/5h: 25% used/);
  });

  it("exits 1 and sends nothing when Codex fails, reports no plan window, or arguments are given", async () => {
    const core = await fakeCore();
    const err: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((t) => (err.push(String(t)), true));
    const none = fake((m) =>
      m.method === "initialize"
        ? [JSON.stringify({ id: 0, result: {} })]
        : [JSON.stringify({ id: m.id, result: { rateLimits: {} } })],
    );
    expect(await run(["codex-usage"], { codexAppServer: none.launch })).toBe(1);
    expect(
      await run(["codex-usage"], {
        codexAppServer: () => {
          throw Object.assign(new Error("x"), { code: "ENOENT" });
        },
      }),
    ).toBe(1);
    expect(await run(["codex-usage", "--oops"])).toBe(2);
    expect(core.bodies).toEqual([]);
    expect(err.join("")).toMatch(/no 5-hour or weekly plan window/);
    expect(err.join("")).toMatch(/not found on PATH/);
  });
});
