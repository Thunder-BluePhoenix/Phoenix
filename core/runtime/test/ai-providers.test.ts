// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 63 through the public HTTP API: per-provider write-only keys, routing/endpoints/prices
// settings, and a routed cloud provider behind the same gate. All network is a fake: no real
// provider, no real key.
import type { CapabilityModule } from "@phoenix/capability-manager";
import { MemorySecretStore } from "@phoenix/persistence";
import type { RawCapture } from "@phoenix/ai-memory";
import type { FetchLike } from "@phoenix/ai-models";
import { afterEach, describe, expect, it } from "vitest";
import { fakeNetwork, type FakeNetwork } from "./ai-network";
import { startCore, type TestCore } from "./helpers";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

/** Assembled at runtime: no credential-shaped literal in the tree. */
const KEY = ["PROVCANARY", "0123456789", "abcdef", "PROVCANARY"].join("-");
const OTHER_KEY = ["OTHERCANARY", "9876543210", "fedcba"].join("-");

const fakeKage: CapabilityModule = {
  manifest: {
    id: "kage",
    name: "Kage (test double)",
    version: "0.0.1",
    description: "Test double for the meeting capability",
    license: "GPL-3.0-or-later",
    events: ["kage.*"],
    permissions: [],
    data_categories: [],
    commands: [],
  },
};

interface Sent {
  url: string;
  authorization: string | undefined;
  googKey: string | undefined;
  body: string;
}

/** Plays Ollama (via the shared fake), OpenAI-compatible servers and Gemini. Records everything. */
interface Network {
  fetch: FetchLike;
  sent: Sent[];
  base: FakeNetwork;
}

function network(ollama: "up" | "down" = "up"): Network {
  const base = fakeNetwork({ ollama });
  const sent: Sent[] = [];
  const fetch: FetchLike = async (url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    sent.push({
      url,
      authorization: lower.authorization,
      googKey: lower["x-goog-api-key"],
      body: typeof init?.body === "string" ? init.body : "",
    });
    const u = new URL(url);
    if (u.pathname.endsWith("/chat/completions")) {
      const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
      return Response.json({
        model: local ? "local-model" : "gpt-test-2026",
        choices: [{ message: { content: local ? "lmstudio answer" : "openai answer" } }],
        usage: { prompt_tokens: 1_000_000, completion_tokens: 500_000 },
      });
    }
    if (u.pathname.endsWith("/models")) {
      return Response.json(
        u.hostname === "generativelanguage.googleapis.com"
          ? {
              models: [
                { name: "models/gemini-x", supportedGenerationMethods: ["generateContent"] },
              ],
            }
          : { data: [{ id: "gpt-test-2026" }, { id: "text-embedding-x" }, { id: "kimi:cloud" }] },
      );
    }
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
      if (u.port !== "11434") return Response.json({ data: [{ id: "local-model" }] });
    }
    return base.fetch(url, init);
  };
  return { fetch, sent, base };
}

async function boot(net = network(), secrets = new MemorySecretStore()) {
  const secretStore = secrets;
  const core = await startCore(
    {},
    { capabilities: [fakeKage], secrets, runtime: { fetch: net.fetch } },
  );
  cleanups.push(() => core.runtime.stop());
  return { ...core, secrets, net };
}

/** A secret store whose delete does not finish until the test lets it. */
class DeferredDeleteStore extends MemorySecretStore {
  readonly deleteStarted = Promise.withResolvers<void>();
  readonly release = Promise.withResolvers<void>();
  override async delete(ref: string): Promise<void> {
    this.deleteStarted.resolve();
    await this.release.promise;
    await super.delete(ref);
  }
}
type Core = TestCore & { secrets: MemorySecretStore; net: Network };

const T = "2026-10-07T10:00:00.000Z";
const gitMemory = (text: string): RawCapture => ({
  source: "git",
  sourceRef: "phoenix",
  scope: "repo:phoenix",
  contentType: "commit",
  observedAt: T,
  provenance: {},
  dedupeKey: "k1",
  text,
});
const QUESTION = "what did we decide about the database lock";

async function withMemory(core: Core) {
  expect(
    core.runtime.memory.pipeline.capture(gitMemory("We decided the database lock is a file"))
      .status,
  ).toBe("stored");
}

const ask = async (core: Core) =>
  (await core.api("POST", "/api/memory/ask", { question: QUESTION })).json;
const settings = (core: Core, body: unknown) => core.api("POST", "/api/ai/settings", body);

describe("per-provider keys are write-only", () => {
  it("stores each key under phoenix.ai.<id>_api_key, returns nothing secret, audits without the value", async () => {
    const core = await boot();
    for (const [id, key] of [
      ["openai", KEY],
      ["gemini", OTHER_KEY],
      ["anthropic", KEY],
    ] as const) {
      const r = await core.api("POST", `/api/ai/providers/${id}/secret`, { value: key });
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ provider: id, key_set: true });
      expect(await core.secrets.get(`phoenix.ai.${id}_api_key`)).toBe(key);
    }
    const status = (await core.api("GET", "/api/ai/status")).json;
    const keyed = Object.fromEntries(
      status.providers.map((p: { id: string; key_set: boolean }) => [p.id, p.key_set]),
    );
    expect(keyed).toMatchObject({
      openai: true,
      gemini: true,
      anthropic: true,
      deepseek: false,
      ollama: false,
    });
    for (const path of [
      "/api/ai/status",
      "/api/audit",
      "/api/privacy",
      "/api/diagnostics",
      "/api/permissions",
      "/api/capabilities",
    ]) {
      const text = JSON.stringify((await core.api("GET", path)).json);
      expect(text, path).not.toContain("CANARY");
    }
    const audit = (await core.api("GET", "/api/audit")).json.entries as {
      action: string;
      details: unknown;
    }[];
    const sets = audit.filter((e) => e.action === "ai.secret.set");
    expect(
      sets.map((e) => e.details).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ).toEqual([{ provider: "anthropic" }, { provider: "gemini" }, { provider: "openai" }]);
    const del = await core.api("DELETE", "/api/ai/providers/openai/secret");
    expect(del.json).toEqual({ provider: "openai", key_set: false });
    expect(await core.secrets.get("phoenix.ai.openai_api_key")).toBeUndefined();
    expect(await core.secrets.get("phoenix.ai.gemini_api_key")).toBe(OTHER_KEY);
  });

  it("an unknown provider id is 404 and a malformed id is 400; nothing is stored", async () => {
    const core = await boot();
    for (const id of ["nope", "openai2", "zz"]) {
      expect(
        (await core.api("POST", `/api/ai/providers/${id}/secret`, { value: KEY })).status,
        id,
      ).toBe(404);
      expect((await core.api("DELETE", `/api/ai/providers/${id}/secret`)).status, id).toBe(404);
    }
    for (const id of [
      "Bad",
      "a",
      "1abc",
      "has_underscore",
      "x".repeat(40),
      "..%2F..",
      "a%00b",
      "openai%0a",
    ]) {
      expect(
        (await core.api("POST", `/api/ai/providers/${id}/secret`, { value: KEY })).status,
        id,
      ).toBe(400);
    }
    for (const body of [
      {},
      { value: 5 },
      { value: "" },
      { value: "a".repeat(8193) },
      { value: "two\nlines" },
    ]) {
      expect(
        (await core.api("POST", "/api/ai/providers/openai/secret", body)).status,
        JSON.stringify(body).slice(0, 30),
      ).toBe(400);
    }
    expect([...(core.secrets as unknown as { values: Map<string, string> }).values.keys()]).toEqual(
      [],
    );
  });

  it("the old single /api/ai/secret route is gone", async () => {
    const core = await boot();
    expect((await core.api("POST", "/api/ai/secret", { value: KEY })).status).toBe(404);
    expect((await core.api("DELETE", "/api/ai/secret")).status).toBe(404);
    expect(await core.secrets.get("phoenix.ai.anthropic_api_key")).toBeUndefined();
  });

  it("needs the session token", async () => {
    const core = await boot();
    for (const authorization of ["", "Bearer wrong"]) {
      expect(
        (
          await core.api(
            "POST",
            "/api/ai/providers/openai/secret",
            { value: KEY },
            { authorization },
          )
        ).status,
      ).toBe(401);
      expect(
        (await core.api("DELETE", "/api/ai/providers/openai/secret", undefined, { authorization }))
          .status,
      ).toBe(401);
    }
    expect(await core.secrets.get("phoenix.ai.openai_api_key")).toBeUndefined();
  });
});

describe("GET /api/ai/status", () => {
  it("lists every provider with locality, label, key state and no models unless asked; contacts nothing while AI is off", async () => {
    const core = await boot();
    const s = (await core.api("GET", "/api/ai/status")).json;
    expect(s).toMatchObject({
      enabled: false,
      routing: { chat: null, summaries: null, cleanup: null },
      endpoints: [],
      prices: {},
    });
    const byId = Object.fromEntries(s.providers.map((p: { id: string }) => [p.id, p]));
    expect(byId.ollama).toMatchObject({ locality: "local", key_policy: "none", kind: "builtin" });
    expect(byId.lmstudio).toMatchObject({
      locality: "local",
      key_policy: "optional",
      kind: "preset",
      base_url: "http://localhost:1234/v1",
    });
    expect(byId.openai).toMatchObject({
      locality: "cloud",
      key_policy: "required",
      key_set: false,
      kind: "preset",
      reason: "AI is off",
      models: null,
    });
    expect(byId.gemini).toMatchObject({
      locality: "cloud",
      key_policy: "required",
      kind: "builtin",
    });
    expect(core.net.sent).toEqual([]);
    expect(core.net.base.requests).toEqual([]);
  });

  it("lists models only for the provider asked for, filters models a local server forwards to a remote host, and needs the grant for cloud", async () => {
    const core = await boot();
    await settings(core, { enabled: true });
    await core.api("POST", "/api/ai/providers/openai/secret", { value: KEY });
    const noGrant = (await core.api("GET", "/api/ai/status?models=openai")).json;
    expect(noGrant.providers.find((p: { id: string }) => p.id === "openai")).toMatchObject({
      models: null,
      models_error: "Allow external AI processing to list this provider's models",
    });
    expect(core.net.sent.filter((s) => s.url.startsWith("https://api.openai.com"))).toEqual([]);
    await core.api("POST", "/api/ai/external-processing", { granted: true });
    const listed = (await core.api("GET", "/api/ai/status?models=openai")).json;
    const openai = listed.providers.find((p: { id: string }) => p.id === "openai");
    expect(openai.models).toEqual([
      { id: "gpt-test-2026", kind: "chat" },
      { id: "text-embedding-x", kind: "embed" },
      { id: "kimi:cloud", kind: "chat" },
    ]);
    expect(listed.providers.filter((p: { models: unknown }) => p.models !== null)).toHaveLength(1);
    expect(
      core.net.sent.find((s) => s.url === "https://api.openai.com/v1/models")?.authorization,
    ).toBe(`Bearer ${KEY}`);
    expect((await core.api("GET", "/api/ai/status?models=Bad_Id")).status).toBe(400);
  });
});

describe("routing, endpoints and prices settings", () => {
  const bad: [string, unknown][] = [
    ["routing not an object", { routing: "chat" }],
    ["routing unknown category", { routing: { embeddings: { provider: "ollama" } } }],
    [
      "routing prototype category",
      { routing: { __proto__: { provider: "ollama" }, constructor: { provider: "ollama" } } },
    ],
    ["route unknown provider", { routing: { chat: { provider: "nope" } } }],
    ["route extra field", { routing: { chat: { provider: "ollama", base_url: "http://x" } } }],
    ["route bad model", { routing: { chat: { provider: "openai", model: "a b" } } }],
    ["route model not a string", { routing: { chat: { provider: "openai", model: 5 } } }],
    ["endpoints not a list", { endpoints: {} }],
    [
      "too many endpoints",
      {
        endpoints: Array.from({ length: 9 }, (_, i) => ({
          id: `ep-${i}x`,
          label: "L",
          base_url: "https://a.example.test/v1",
        })),
      },
    ],
    [
      "endpoint bad id",
      { endpoints: [{ id: "Bad_Id", label: "L", base_url: "https://a.example.test/v1" }] },
    ],
    [
      "endpoint reserved id",
      { endpoints: [{ id: "openai", label: "L", base_url: "https://a.example.test/v1" }] },
    ],
    [
      "endpoint duplicate id",
      {
        endpoints: [
          { id: "mine", label: "L", base_url: "https://a.example.test/v1" },
          { id: "mine", label: "M", base_url: "https://b.example.test/v1" },
        ],
      },
    ],
    [
      "endpoint http remote",
      { endpoints: [{ id: "mine", label: "L", base_url: "http://a.example.test/v1" }] },
    ],
    [
      "endpoint credentials",
      { endpoints: [{ id: "mine", label: "L", base_url: "https://u:p@a.example.test/v1" }] },
    ],
    [
      "endpoint query",
      { endpoints: [{ id: "mine", label: "L", base_url: "https://a.example.test/v1?k=1" }] },
    ],
    [
      "endpoint label too long",
      { endpoints: [{ id: "mine", label: "x".repeat(41), base_url: "https://a.example.test/v1" }] },
    ],
    [
      "endpoint label bidi",
      {
        endpoints: [{ id: "mine", label: "safe\u202Eevil", base_url: "https://a.example.test/v1" }],
      },
    ],
    [
      "endpoint label zero width",
      { endpoints: [{ id: "mine", label: "a\u200Bb", base_url: "https://a.example.test/v1" }] },
    ],
    [
      "endpoint label control",
      { endpoints: [{ id: "mine", label: "a\nb", base_url: "https://a.example.test/v1" }] },
    ],
    [
      "endpoint unknown preset",
      {
        endpoints: [
          { id: "mine", label: "L", base_url: "https://a.example.test/v1", preset: "nope" },
        ],
      },
    ],
    [
      "endpoint extra field",
      {
        endpoints: [
          { id: "mine", label: "L", base_url: "https://a.example.test/v1", locality: "local" },
        ],
      },
    ],
    ["price unknown provider", { prices: { "nope:m": { input_per_mtok: 1, output_per_mtok: 1 } } }],
    ["price bad key", { prices: { openai: { input_per_mtok: 1, output_per_mtok: 1 } } }],
    ["price negative", { prices: { "openai:m": { input_per_mtok: -1, output_per_mtok: 1 } } }],
    ["price NaN-like", { prices: { "openai:m": { input_per_mtok: "1", output_per_mtok: 1 } } }],
    ["price huge", { prices: { "openai:m": { input_per_mtok: 1e12, output_per_mtok: 1 } } }],
    [
      "price extra field",
      { prices: { "openai:m": { input_per_mtok: 1, output_per_mtok: 1, currency: "EUR" } } },
    ],
  ];

  it.each(bad)("%s is a 400 and changes nothing", async (_name, body) => {
    const core = await boot();
    const before = JSON.stringify((await core.api("GET", "/api/ai/status")).json);
    const r = await settings(core, body);
    expect(r.status).toBe(400);
    expect(JSON.stringify((await core.api("GET", "/api/ai/status")).json)).toBe(before);
  });

  it("stores routing per category (merge, null clears), endpoints and prices, and audits the change without prices or URLs", async () => {
    const core = await boot();
    let s = (
      await settings(core, {
        routing: {
          chat: { provider: "openai", model: "gpt-test-2026" },
          summaries: { provider: "ollama" },
        },
      })
    ).json;
    expect(s.routing).toEqual({
      chat: { provider: "openai", model: "gpt-test-2026" },
      summaries: { provider: "ollama", model: null },
      cleanup: null,
    });
    s = (await settings(core, { routing: { chat: null } })).json;
    expect(s.routing).toEqual({
      chat: null,
      summaries: { provider: "ollama", model: null },
      cleanup: null,
    });
    s = (
      await settings(core, {
        endpoints: [
          { id: "mine", label: "My server", base_url: "https://llm.example.test/v1/" },
          {
            id: "home",
            label: "Home box",
            base_url: "http://localhost:8080/v1",
            preset: "lmstudio",
          },
        ],
        prices: { "openai:gpt-test-2026": { input_per_mtok: 2.5, output_per_mtok: 10 } },
      })
    ).json;
    // Locality is derived from the URL; the trailing slash is normalised.
    expect(s.endpoints).toEqual([
      {
        id: "mine",
        label: "My server",
        base_url: "https://llm.example.test/v1",
        preset: null,
        locality: "cloud",
      },
      {
        id: "home",
        label: "Home box",
        base_url: "http://localhost:8080/v1",
        preset: "lmstudio",
        locality: "local",
      },
    ]);
    expect(s.providers.find((p: { id: string }) => p.id === "mine")).toMatchObject({
      kind: "custom",
      locality: "cloud",
      key_policy: "required",
    });
    expect(s.providers.find((p: { id: string }) => p.id === "home")).toMatchObject({
      kind: "custom",
      locality: "local",
      key_policy: "optional",
    });
    expect(s.prices).toEqual({
      "openai:gpt-test-2026": { input_per_mtok: 2.5, output_per_mtok: 10 },
    });
    // A route may point at an endpoint created in the same request.
    s = (
      await settings(core, {
        endpoints: [{ id: "fresh", label: "Fresh", base_url: "https://f.example.test/v1" }],
        routing: { cleanup: { provider: "fresh" } },
      })
    ).json;
    expect(s.routing.cleanup).toEqual({ provider: "fresh", model: null });
    const audit = JSON.stringify((await core.api("GET", "/api/audit")).json.entries);
    expect(audit).not.toContain("llm.example.test");
    expect(audit).not.toContain("input_per_mtok");
  });

  it("a key belongs to its destination: removing an endpoint or changing its URL deletes the key", async () => {
    const core = await boot();
    await settings(core, {
      endpoints: [{ id: "mine", label: "Mine", base_url: "https://a.example.test/v1" }],
    });
    await core.api("POST", "/api/ai/providers/mine/secret", { value: KEY });
    expect(await core.secrets.get("phoenix.ai.mine_api_key")).toBe(KEY);
    // Same URL: the key stays.
    await settings(core, {
      endpoints: [{ id: "mine", label: "Renamed", base_url: "https://a.example.test/v1" }],
    });
    expect(await core.secrets.get("phoenix.ai.mine_api_key")).toBe(KEY);
    // Another URL: the key must not follow to a new host.
    await settings(core, {
      endpoints: [{ id: "mine", label: "Renamed", base_url: "https://b.example.test/v1" }],
    });
    expect(await core.secrets.get("phoenix.ai.mine_api_key")).toBeUndefined();
    await core.api("POST", "/api/ai/providers/mine/secret", { value: KEY });
    await settings(core, { endpoints: [] });
    expect(await core.secrets.get("phoenix.ai.mine_api_key")).toBeUndefined();
    expect((await core.api("POST", "/api/ai/providers/mine/secret", { value: KEY })).status).toBe(
      404,
    );
  });

  it("replacing an endpoint never lets the old key reach the new host, even while the old key's deletion is still pending", async () => {
    const secrets = new DeferredDeleteStore();
    const core = await boot(network(), secrets);
    await withMemory(core);
    await settings(core, {
      enabled: true,
      cloud_opt_in: { public: true, internal: true },
      endpoints: [{ id: "mine", label: "Mine", base_url: "https://a.example.test/v1" }],
      routing: { chat: { provider: "mine", model: "m-1" } },
    });
    await core.api("POST", "/api/ai/external-processing", { granted: true });
    await core.api("POST", "/api/ai/providers/mine/secret", { value: KEY });
    const hostOf = (s: Sent) => new URL(s.url).host;
    // Same id, another host: Core starts deleting the key and the store has not finished yet.
    const replacing = settings(core, {
      endpoints: [{ id: "mine", label: "Mine", base_url: "https://b.example.test/v1" }],
    });
    await secrets.deleteStarted.promise;
    // A question asked in that window must not carry the key to the NEW host.
    await ask(core);
    secrets.release.resolve();
    expect((await replacing).status).toBe(200);
    const afterwards = await ask(core);
    expect(afterwards.ai_used).toBe(false);
    expect(afterwards.note).toContain("No API key is set for Mine");
    const toNewHost = core.net.sent.filter((s) => hostOf(s) === "b.example.test");
    expect(toNewHost.filter((s) => s.authorization !== undefined)).toEqual([]);
    expect(toNewHost.some((s) => s.url.endsWith("/chat/completions"))).toBe(false);
    expect(await secrets.get("phoenix.ai.mine_api_key")).toBeUndefined();
  });

  it("a key written while an endpoint change is in flight is applied after it, never to the half-changed endpoint", async () => {
    const secrets = new DeferredDeleteStore();
    const core = await boot(network(), secrets);
    await settings(core, {
      endpoints: [{ id: "mine", label: "Mine", base_url: "https://a.example.test/v1" }],
    });
    await core.api("POST", "/api/ai/providers/mine/secret", { value: KEY });
    const replacing = settings(core, {
      endpoints: [{ id: "mine", label: "Mine", base_url: "https://b.example.test/v1" }],
    });
    await secrets.deleteStarted.promise;
    // The user saves a key for the NEW destination at the same moment: it must queue behind the change.
    const writing = core.api("POST", "/api/ai/providers/mine/secret", { value: OTHER_KEY });
    secrets.release.resolve();
    await replacing;
    expect((await writing).status).toBe(200);
    expect(await secrets.get("phoenix.ai.mine_api_key")).toBe(OTHER_KEY);
  });

  it("settings survive a restart of the settings read (stored values are re-validated on read)", async () => {
    const core = await boot();
    await settings(core, { routing: { chat: { provider: "openai" } } });
    core.runtime.settings.set("ai.settings", {
      enabled: true,
      routing: {
        chat: { provider: "../../x" },
        summaries: { provider: "ollama", model: "bad model" },
        constructor: { provider: "ollama" },
      },
      prices: { "openai:m": { input_per_mtok: -5, output_per_mtok: 1 }, "x:y": 3 },
      endpoints: [
        { id: "BAD", label: "x", base_url: "https://a.example.test" },
        { id: "ok-one", label: "Ok", base_url: "http://evil.example.test/v1" },
      ],
    });
    const s = (await core.api("GET", "/api/ai/status")).json;
    expect(s.routing).toEqual({
      chat: null,
      summaries: { provider: "ollama", model: null },
      cleanup: null,
    });
    expect(s.prices).toEqual({});
    // An unsafe stored endpoint is not a provider (so it can never be sent a key).
    expect(s.providers.map((p: { id: string }) => p.id)).not.toContain("ok-one");
  });
});

describe("a routed cloud provider is behind the same gate", () => {
  async function routed(core: Core, over: Record<string, unknown> = {}) {
    await withMemory(core);
    await core.api("POST", "/api/ai/providers/openai/secret", { value: KEY });
    await settings(core, {
      enabled: true,
      cloud_opt_in: { public: true, internal: true },
      routing: { chat: { provider: "openai", model: "gpt-test-2026" } },
      prices: { "openai:gpt-test-2026": { input_per_mtok: 2, output_per_mtok: 4 } },
      ...over,
    });
  }
  const openaiRequests = (core: Core) =>
    core.net.sent.filter((s) => s.url.startsWith("https://api.openai.com"));

  it("without the AI_external_processing grant nothing is sent and the refusal is visible", async () => {
    const core = await boot();
    await routed(core);
    const a = await ask(core);
    expect(a.ai_used).toBe(false);
    expect(a.note).toContain("AI_external_processing permission is not granted");
    expect(openaiRequests(core)).toEqual([]);
    // Local Ollama did not take over silently.
    expect(core.net.base.chats()).toEqual([]);
  });

  it("without the class opt-in nothing is sent", async () => {
    const core = await boot();
    await routed(core, { cloud_opt_in: { public: false, internal: false } });
    await core.api("POST", "/api/ai/external-processing", { granted: true });
    const a = await ask(core);
    expect(a.ai_used).toBe(false);
    expect(a.note).toMatch(/cloud AI is not enabled for internal data/);
    expect(openaiRequests(core)).toEqual([]);
  });

  it("with grant + opt-in + key it answers, labelled with model/provider/locality/usage and a cost from the user's prices only", async () => {
    const core = await boot();
    await routed(core);
    await core.api("POST", "/api/ai/external-processing", { granted: true });
    const a = await ask(core);
    expect(a).toMatchObject({
      ai_used: true,
      interpretation: "openai answer",
      model: "gpt-test-2026",
      provider: "openai",
      provider_label: "OpenAI (cloud)",
      locality: "cloud",
      usage: { input_tokens: 1_000_000, output_tokens: 500_000 },
      cost: { amount: 4, currency: "USD", basis: "user-configured prices" },
    });
    expect(a.processed_by).toMatch(/OpenAI.*cloud$/);
    const sent = openaiRequests(core).filter((s) => s.url.endsWith("/chat/completions"));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(sent[0]!.body).model).toBe("gpt-test-2026");
    // No price entered -> the cost is unknown, not invented.
    await settings(core, { prices: {} });
    expect((await ask(core)).cost).toBeNull();
    // Nothing secret anywhere the UI or the audit log can read.
    const everything = JSON.stringify([
      a,
      (await core.api("GET", "/api/ai/status")).json,
      (await core.api("GET", "/api/audit")).json,
    ]);
    expect(everything).not.toContain("CANARY");
  });

  it("a missing key fails clearly: 'No API key is set for OpenAI (cloud)', and the chat request is never sent", async () => {
    const core = await boot();
    await routed(core);
    await core.api("DELETE", "/api/ai/providers/openai/secret");
    await core.api("POST", "/api/ai/external-processing", { granted: true });
    const a = await ask(core);
    expect(a.ai_used).toBe(false);
    expect(a.note).toContain("No API key is set for OpenAI (cloud)");
    expect(openaiRequests(core)).toEqual([]);
    const status = (await core.api("GET", "/api/ai/status")).json;
    expect(status.providers.find((p: { id: string }) => p.id === "openai")).toMatchObject({
      available: false,
      reason: "No API key is set for OpenAI (cloud)",
    });
  });

  it("revoking the grant stops the very next send", async () => {
    const core = await boot();
    await routed(core);
    await core.api("POST", "/api/ai/external-processing", { granted: true });
    expect((await ask(core)).ai_used).toBe(true);
    await core.api("POST", "/api/ai/external-processing", { granted: false });
    expect((await ask(core)).ai_used).toBe(false);
    expect(openaiRequests(core).filter((s) => s.url.endsWith("/chat/completions"))).toHaveLength(1);
  });

  it("a key set for a provider nobody routed to does not make it receive requests", async () => {
    const core = await boot();
    await withMemory(core);
    for (const id of ["openai", "gemini", "deepseek", "qwen", "moonshot"]) {
      await core.api("POST", `/api/ai/providers/${id}/secret`, { value: KEY });
    }
    await settings(core, { enabled: true, cloud_opt_in: { public: true, internal: true } });
    await core.api("POST", "/api/ai/external-processing", { granted: true });
    const a = await ask(core);
    expect(a.provider).toBe("ollama");
    expect(a.locality).toBe("local");
    expect(a.cost).toBeNull();
    // Nothing was sent to any of the new providers, though each has a key: they are used only
    // when the user routes work to them.
    const cloudHosts = core.net.sent.filter(
      (s) => !/^http:\/\/(127\.0\.0\.1|localhost)/.test(s.url),
    );
    expect(cloudHosts.filter((s) => !s.url.startsWith("https://api.anthropic.com"))).toEqual([]);
  });

  it("LM Studio (loopback) answers with no grant and no key, as on this device and free", async () => {
    const core = await boot(network("down"));
    await withMemory(core);
    await settings(core, {
      enabled: true,
      routing: { chat: { provider: "lmstudio", model: "local-model" } },
    });
    const a = await ask(core);
    expect(a).toMatchObject({
      ai_used: true,
      interpretation: "lmstudio answer",
      provider: "lmstudio",
      locality: "local",
      cost: null,
    });
    expect(a.processed_by).toMatch(/on this device$/);
    // Only this device was contacted: the Ollama and LM Studio health probes and one LM Studio chat.
    const hosts = [...new Set(core.net.sent.map((s) => new URL(s.url).origin))].sort();
    expect(hosts).toEqual(["http://127.0.0.1:11434", "http://localhost:1234"]);
    expect(core.net.sent.filter((s) => s.url.endsWith("/chat/completions"))).toHaveLength(1);
    expect(core.net.sent.some((s) => s.authorization !== undefined)).toBe(false);
  });

  it("the key is sent to its provider only: never to another, never in a URL", async () => {
    const core = await boot();
    await routed(core);
    await core.api("POST", "/api/ai/external-processing", { granted: true });
    await ask(core);
    for (const s of core.net.sent) {
      expect(s.url).not.toContain("CANARY");
      if (s.authorization?.includes(KEY))
        expect(s.url.startsWith("https://api.openai.com/")).toBe(true);
    }
  });
});

describe("the privacy sentence names the new providers", () => {
  it("is still true: cloud providers are named only when granted + opted in; local ones named when chosen", async () => {
    const core = await boot();
    const sentence = async () => (await core.api("GET", "/api/privacy")).json.external_ai as string;
    await settings(core, { enabled: true, routing: { chat: { provider: "lmstudio" } } });
    expect(await sentence()).toMatch(
      /processed on this device by Ollama; nothing is sent to external AI providers\. Public and internal text may also go to LM Studio \(this device\), a server you configured on this device; Phoenix cannot verify that it keeps text on this device, so sensitive data is never sent to it\./,
    );
    expect(await sentence()).not.toMatch(/OpenAI|Gemini|DeepSeek|Qwen|Moonshot/);
    await settings(core, { cloud_opt_in: { public: true, internal: true } });
    expect(await sentence()).not.toMatch(/OpenAI/); // opt-in without the grant sends nothing
    await core.api("POST", "/api/ai/external-processing", { granted: true });
    const granted = await sentence();
    for (const name of [
      "Anthropic (cloud)",
      "OpenAI (cloud)",
      "DeepSeek (cloud)",
      "Qwen (cloud",
      "Moonshot Kimi (cloud)",
      "Google Gemini (cloud)",
    ]) {
      expect(granted, name).toContain(name);
    }
    expect(granted).toMatch(/also go to LM Studio \(this device\), a server you configured/);
    expect(granted).not.toMatch(/Sensitive memories .*LM Studio/);
    expect(granted).toMatch(/Meeting transcripts are only read by a model on this device/);
    expect(granted).toMatch(/embeds memory text on this device only/);
    expect(granted).not.toMatch(/Sensitive memories/);
    await settings(core, { cloud_opt_in: { sensitive: true } });
    expect(await sentence()).toMatch(/Sensitive memories .* only when you ask Fawkes a question/);
    // A user-added cloud endpoint is named too.
    await settings(core, {
      endpoints: [{ id: "mine", label: "My server", base_url: "https://llm.example.test/v1" }],
    });
    expect(await sentence()).toContain("My server");
  });

  it("no cloud provider is ever an embedder", async () => {
    const core = await boot();
    await settings(core, {
      endpoints: [{ id: "mine", label: "My server", base_url: "https://llm.example.test/v1" }],
    });
    // LM Studio is a user-run loopback server Phoenix cannot vet, so it is not an embedder either.
    expect(core.runtime.ai.embeddingProviders()).toEqual(["ollama"]);
    const retrieval = await core.api("POST", "/api/retrieval/settings", { provider: "openai" });
    expect(retrieval.status).toBe(400);
  });
});
