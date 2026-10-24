// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 78: the installed generic hook (Codex and the other agents of agent-hook.ts) sends the
// generic usage report to POST /api/agent/live/usage, but only for an explicit `phoenix_usage`
// object. Run against a fake Core that records requests; the recorded body is then fed to the real
// Phase 78 usage rig. No Codex payload was observed: nothing here claims one.
import { spawn } from "node:child_process";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeRigs, usageRig } from "../../../core/runtime/test/agent-usage-rig";
import { runAgentHook } from "../src/agent-hook";
import { mapGenericUsage } from "../src/relay/generic-map";

const TOKEN_FOR_TESTS = "fake-tok";
const TSX = join(import.meta.dirname, "../../../node_modules/.bin/tsx");
const HOOK = join(import.meta.dirname, "../src/agent-hook.ts");

interface Hit {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: unknown;
}

let server: Server | undefined;
let hits: Hit[] = [];

async function fakeCore(): Promise<string> {
  hits = [];
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      hits.push({
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "null"),
      });
      res.setHeader("content-type", "application/json");
      res.end('{"accepted":1}');
    });
  });
  const listening = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", () => listening.resolve());
  await listening.promise;
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(() => {
  vi.stubEnv("PHOENIX_SESSION_TOKEN", TOKEN_FOR_TESTS);
  vi.stubEnv("PHOENIX_RELAY_SOCKET", "");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  closeRigs();
  server?.closeAllConnections();
  const closed = Promise.withResolvers<void>();
  if (server) server.close(() => closed.resolve());
  else closed.resolve();
  await closed.promise;
  server = undefined;
});

const payload = (over: Record<string, unknown> = {}) => ({
  session_id: "c1",
  cwd: "/work/app",
  phoenix_usage: { model: "gpt-x", input_tokens: 1_200, output_tokens: 300, cost_usd: 0.5 },
  ...over,
});

const usageHits = () => hits.filter((h) => h.url === "/api/agent/live/usage");

describe("agent-hook phoenix_usage → POST /api/agent/live/usage", () => {
  it("sends exactly the validated body, with the session token, and nothing else", async () => {
    vi.stubEnv("PHOENIX_CORE_URL", await fakeCore());
    const note = await runAgentHook(
      ["--agent", "codex"],
      JSON.stringify(
        payload({ prompt: "SECRET PROMPT TEXT", last_assistant_message: "SECRET ANSWER" }),
      ),
      {},
    );
    expect(note).toEqual({ note: "" });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      method: "POST",
      url: "/api/agent/live/usage",
      headers: { authorization: `Bearer ${TOKEN_FOR_TESTS}` },
    });
    expect(hits[0]?.body).toEqual({
      agent: "codex",
      session_id: "c1",
      model: "gpt-x",
      project: "app",
      input_tokens: 1_200,
      output_tokens: 300,
      cost_usd: 0.5,
    });
    expect(JSON.stringify(hits)).not.toContain("SECRET");
  });

  it("sends the state report and the usage report together on a Stop event", async () => {
    vi.stubEnv("PHOENIX_CORE_URL", await fakeCore());
    await runAgentHook(
      ["--agent", "codex"],
      JSON.stringify(payload({ hook_event_name: "Stop" })),
      {},
    );
    expect(hits.map((h) => h.url).sort()).toEqual([
      "/api/agent/live/usage",
      "/api/capabilities/agents/commands/report",
    ]);
    expect(usageHits()[0]?.body).toMatchObject({ agent: "codex", session_id: "c1" });
  });

  it("accepts a cost-only or a tokens-only report and never invents the missing numbers", async () => {
    vi.stubEnv("PHOENIX_CORE_URL", await fakeCore());
    await runAgentHook(
      ["--agent", "my-agent"],
      JSON.stringify(payload({ phoenix_usage: { cost_usd: 2 } })),
      {},
    );
    await runAgentHook(
      ["--agent", "my-agent"],
      JSON.stringify(payload({ phoenix_usage: { input_tokens: 7 } })),
      {},
    );
    expect(usageHits().map((h) => h.body)).toEqual([
      { agent: "my-agent", session_id: "c1", model: "", project: "app", cost_usd: 2 },
      { agent: "my-agent", session_id: "c1", model: "", project: "app", input_tokens: 7 },
    ]);
  });

  it.each([
    ["fractional tokens", { input_tokens: 1.5 }],
    ["negative tokens", { output_tokens: -1 }],
    ["tokens as a string", { input_tokens: "1000" }],
    ["tokens past 1e12", { input_tokens: 1_000_000_000_001 }],
    ["NaN-like tokens", { input_tokens: null }],
    ["negative cost", { cost_usd: -0.01 }],
    ["cost past 100000", { cost_usd: 100_001 }],
    ["no numbers at all", { model: "gpt-x" }],
    ["an empty object", {}],
    ["an unknown field (prompt text)", { input_tokens: 1, prompt: "SECRET PROMPT TEXT" }],
    ["an unknown field (session_id inside)", { input_tokens: 1, session_id: "other" }],
    ["an invalid model", { input_tokens: 1, model: "gpt x; rm -rf" }],
    ["a model that is not a string", { input_tokens: 1, model: 5 }],
  ])("sends nothing for %s", async (_name, usage) => {
    vi.stubEnv("PHOENIX_CORE_URL", await fakeCore());
    const result = await runAgentHook(
      ["--agent", "codex"],
      JSON.stringify(payload({ phoenix_usage: usage })),
      {},
    );
    expect(result).toEqual({ note: "" });
    expect(hits).toEqual([]);
  });

  it.each([
    ["phoenix_usage as an array", { phoenix_usage: [1, 2] }],
    ["phoenix_usage as a string", { phoenix_usage: "1000 tokens" }],
    ["phoenix_usage null", { phoenix_usage: null }],
    ["no session id", { session_id: undefined }],
    ["an invalid session id", { session_id: "bad id with spaces" }],
    [
      "native token-looking fields only (never read)",
      { phoenix_usage: undefined, usage: { input_tokens: 5 }, input_tokens: 5, total_tokens: 9 },
    ],
  ])("sends nothing for %s", async (_name, over) => {
    vi.stubEnv("PHOENIX_CORE_URL", await fakeCore());
    await runAgentHook(["--agent", "codex"], JSON.stringify(payload(over)), {});
    expect(hits).toEqual([]);
  });

  it("sends nothing for non-JSON or an invalid agent slug", async () => {
    vi.stubEnv("PHOENIX_CORE_URL", await fakeCore());
    await runAgentHook(["--agent", "codex"], "not json {phoenix_usage", {});
    await runAgentHook(["--agent", "Bad_Name"], JSON.stringify(payload()), {});
    expect(hits).toEqual([]);
  });

  it("never sends the token to a non-loopback address", async () => {
    await fakeCore();
    vi.stubEnv("PHOENIX_CORE_URL", "http://example.invalid:4870");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await runAgentHook(["--agent", "codex"], JSON.stringify(payload()), {});
    expect(result.note).toContain("agent usage not reported");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(hits).toEqual([]);
  });

  it("the plugin environment can name the session; the project is a folder name only", () => {
    expect(
      mapGenericUsage(
        { phoenix_usage: { input_tokens: 3 } },
        { agent: "amp", env: { PHOENIX_AGENT_ID: "a1", PHOENIX_AGENT_WORKSPACE: "/home/me/proj" } },
      ),
    ).toEqual({ agent: "amp", session_id: "a1", model: "", project: "proj", input_tokens: 3 });
  });

  it("the real hook subprocess posts the body, prints {} and exits 0", async () => {
    const url = await fakeCore();
    const child = spawn(TSX, [HOOK, "--agent", "codex"], {
      env: {
        ...process.env,
        PHOENIX_CORE_URL: url,
        PHOENIX_SESSION_TOKEN: TOKEN_FOR_TESTS,
        PHOENIX_RELAY_SOCKET: join(process.cwd(), "no-such.sock"),
      },
    });
    let stdout = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c));
    child.stdin.end(JSON.stringify(payload()));
    const closed = Promise.withResolvers<number | null>();
    child.on("close", (status) => closed.resolve(status));
    expect(await closed.promise).toBe(0);
    expect(stdout).toBe("{}\n");
    expect(usageHits()).toHaveLength(1);
    expect(usageHits()[0]?.body).toMatchObject({ agent: "codex", input_tokens: 1_200 });
  });
});

describe("what the hook sends is what Core stores (Phase 78 usage rig)", () => {
  it("the recorded body is accepted by the usage runtime and shows in the mission view", async () => {
    vi.stubEnv("PHOENIX_CORE_URL", await fakeCore());
    await runAgentHook(["--agent", "codex"], JSON.stringify(payload()), {});
    const r = usageRig();
    expect(r.report(usageHits()[0]?.body)).toEqual({ accepted: 1 });
    const view = await r.usage.mission(undefined);
    expect(view.totals).toMatchObject({ input_tokens: 1_200, output_tokens: 300, cost_usd: 0.5 });
    expect(view.by_agent[0]).toMatchObject({ agent: "codex" });
  });
});
