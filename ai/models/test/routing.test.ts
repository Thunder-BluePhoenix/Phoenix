// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 63: purpose categories, per-purpose routing (always behind the SAME gate), cost from the
// user's own prices, and the "explicit only" rule for providers the user has to choose.
import { describe, expect, it } from "vitest";
import {
  AiService,
  AllProvidersFailedError,
  costOf,
  ModelError,
  createDefaultProviders,
  NoProviderError,
  ProviderRegistry,
  purposeCategory,
  PURPOSE_ANSWER_FROM_MEMORY,
  PURPOSE_CLEANUP,
  SENSITIVE_CLOUD_PURPOSES,
  type AiSettings,
  type GenerateTask,
  type ModelProvider,
} from "../src";
import { fakeFetch, fakeProvider, json, provenanceOf, type FakeFetch } from "./helpers";

const KEY = ["canary", "route", "0123456789", "CANARY"].join("-");
const OPEN: AiSettings = {
  enabled: true,
  cloudOptIn: { public: true, internal: true, sensitive: false },
};

const task = (
  purpose = "test",
  privacy: "public" | "internal" | "sensitive" = "public",
  over: Partial<GenerateTask> = {},
): GenerateTask => ({
  kind: "generate",
  request: { privacy, purpose, messages: [{ role: "user", content: "hi" }] },
  ...over,
});

describe("purposeCategory", () => {
  it("maps the known purposes", () => {
    expect(purposeCategory(PURPOSE_ANSWER_FROM_MEMORY)).toBe("chat");
    expect(purposeCategory(PURPOSE_CLEANUP)).toBe("cleanup");
    expect(purposeCategory("embed memory for retrieval")).toBe("embeddings");
    expect(purposeCategory("embed a retrieval query")).toBe("embeddings");
  });

  it("an unknown purpose is 'summaries', the most conservative category", () => {
    for (const p of [
      "extract decisions and action items from a meeting",
      "diagnose a CI failure",
      "rerank retrieval candidates",
      "",
      "anything at all",
      // Inherited members of Object must not resolve to a category.
      "__proto__",
      "constructor",
      "toString",
      "hasOwnProperty",
    ]) {
      expect(purposeCategory(p), p).toBe("summaries");
    }
  });

  it("dictation clean-up is not a purpose the sensitive-cloud gate accepts", () => {
    expect(SENSITIVE_CLOUD_PURPOSES).not.toContain(PURPOSE_CLEANUP);
  });
});

describe("costOf: only from the user's prices", () => {
  const cloud = { provider: "openai", model: "m-1", locality: "cloud" as const };
  const usage = { inputTokens: 2_000_000, outputTokens: 500_000 };
  const prices = { "openai:m-1": { input_per_mtok: 3, output_per_mtok: 12 } };

  it("computes input and output separately", () => {
    expect(costOf(cloud, undefined, usage, prices)).toEqual({
      amount: 2 * 3 + 0.5 * 12,
      currency: "USD",
      basis: "user-configured prices",
    });
  });

  it("is null without a price, without usage, without both token counts, and for a local model", () => {
    expect(costOf(cloud, undefined, usage, undefined)).toBeNull();
    expect(costOf(cloud, undefined, usage, {})).toBeNull();
    expect(costOf(cloud, undefined, undefined, prices)).toBeNull();
    expect(costOf(cloud, undefined, { inputTokens: 5 }, prices)).toBeNull();
    expect(costOf({ ...cloud, locality: "local" }, undefined, usage, prices)).toBeNull();
  });

  it("falls back to the model that was asked for when the server reports a dated name", () => {
    const dated = { ...cloud, model: "m-1-2026-01-01" };
    expect(costOf(dated, "m-1", usage, prices)).not.toBeNull();
    expect(costOf(dated, undefined, usage, prices)).toBeNull();
  });

  it("a price table cannot be reached through Object.prototype", () => {
    expect(
      costOf({ ...cloud, provider: "constructor", model: "x" }, "toString", usage, {}),
    ).toBeNull();
  });

  it("zero prices are a price (free tier), not 'unknown'", () => {
    expect(
      costOf(cloud, undefined, usage, { "openai:m-1": { input_per_mtok: 0, output_per_mtok: 0 } }),
    ).toMatchObject({ amount: 0 });
  });
});

describe("AiService routing", () => {
  interface Rig {
    service: AiService;
    settings: AiSettings;
    grant: { value: boolean };
    audits: string[];
  }
  function rig(providers: ModelProvider[], over: Partial<AiSettings> = {}): Rig {
    const registry = new ProviderRegistry();
    for (const p of providers) registry.register(p);
    const settings: AiSettings = { ...OPEN, ...over };
    const grant = { value: true };
    const audits: string[] = [];
    const service = new AiService({
      registry,
      policy: { allowed: () => grant.value },
      settings: () => settings,
      auditCloudSend: (r) => audits.push(r.provider),
      sleep: () => Promise.resolve(),
    });
    return { service, settings, grant, audits };
  }
  /** A cloud provider that only answers when the user chose it. */
  const cloudProvider = (id: string, over: Record<string, unknown> = {}) => ({
    ...fakeProvider({ id, locality: "cloud" }),
    explicitOnly: true,
    keyPolicy: "required" as const,
    ...over,
  });

  it("local-first by default: with nothing routed, a cloud provider is never used or even contacted", async () => {
    const local = fakeProvider({ id: "ollama", locality: "local" });
    const cloud = cloudProvider("openai");
    const r = rig([local, cloud]);
    const out = await r.service.run(task());
    expect(out.provider).toBe("ollama");
    expect(cloud.calls).toEqual({ generate: 0, stream: 0, embed: 0, health: 0 });
    // Even with Ollama down, an explicit-only cloud provider does not take over by itself.
    local.calls.health = 0;
    const down = rig([
      fakeProvider({
        id: "ollama",
        locality: "local",
        health: () => Promise.resolve({ available: false, detail: "off" }),
      }),
      cloud,
    ]);
    await expect(down.service.run(task())).rejects.toBeInstanceOf(NoProviderError);
    expect(cloud.calls.generate).toBe(0);
  });

  it("a route beats the global `preferred`", async () => {
    const local = fakeProvider({ id: "ollama", locality: "local" });
    const a = cloudProvider("openai");
    const b = cloudProvider("deepseek");
    const r = rig([local, a, b], {
      preferred: "deepseek",
      routing: { summaries: { provider: "openai" } },
    });
    const out = await r.service.run(task("some summary purpose"));
    expect(out.provider).toBe("openai");
    expect(b.calls.generate).toBe(0);
    expect(local.calls.generate).toBe(0);
    // A route for a different category does not affect this one: `preferred` applies.
    const chat = await r.service.run(task(PURPOSE_ANSWER_FROM_MEMORY));
    expect(chat.provider).toBe("deepseek");
  });

  it("an unknown purpose uses the summaries route", async () => {
    const a = cloudProvider("openai");
    const r = rig([fakeProvider({ id: "ollama", locality: "local" }), a], {
      routing: { summaries: { provider: "openai" }, chat: { provider: "ollama" } },
    });
    expect((await r.service.run(task("brand new purpose"))).provider).toBe("openai");
    expect((await r.service.run(task(PURPOSE_ANSWER_FROM_MEMORY))).provider).toBe("ollama");
  });

  it("the routed model is used when the request names none, and an explicit request model wins", async () => {
    const seen: (string | undefined)[] = [];
    const p = {
      ...fakeProvider({
        id: "openai",
        locality: "cloud",
        generate: (req) => {
          seen.push(req.model);
          return Promise.resolve({ text: "x", provenance: provenanceOf("openai", "cloud") });
        },
      }),
      explicitOnly: true,
    };
    const r = rig([p], { routing: { chat: { provider: "openai", model: "routed-model" } } });
    await r.service.run(task(PURPOSE_ANSWER_FROM_MEMORY));
    const t = task(PURPOSE_ANSWER_FROM_MEMORY);
    await r.service.run({ ...t, request: { ...t.request, model: "asked-model" } });
    expect(seen).toEqual(["routed-model", "asked-model"]);
  });

  it("the route is the ONLY provider tried: its failure does not fall through to another", async () => {
    const local = fakeProvider({ id: "ollama", locality: "local" });
    const bad = {
      ...fakeProvider({
        id: "openai",
        locality: "cloud",
        generate: () => Promise.reject(new ModelError("http", "openai", "boom", { status: 400 })),
      }),
      explicitOnly: true,
    };
    const r = rig([local, bad], { routing: { chat: { provider: "openai" } } });
    const e = await r.service.run(task(PURPOSE_ANSWER_FROM_MEMORY)).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AllProvidersFailedError);
    expect((e as AllProvidersFailedError).routedTo).toBe("openai");
    expect(local.calls.generate).toBe(0);
  });

  describe("the gate still applies to a routed cloud provider", () => {
    it("AI off: nothing happens", async () => {
      const p = cloudProvider("openai");
      const r = rig([p], { enabled: false, routing: { chat: { provider: "openai" } } });
      await expect(r.service.run(task(PURPOSE_ANSWER_FROM_MEMORY))).rejects.toMatchObject({
        name: "AiDisabledError",
      });
      expect(p.calls).toEqual({ generate: 0, stream: 0, embed: 0, health: 0 });
    });

    it("without the AI_external_processing grant: refused with the reason, provider never contacted", async () => {
      const p = cloudProvider("openai");
      const r = rig([p], { routing: { chat: { provider: "openai" } } });
      r.grant.value = false;
      const e = (await r.service
        .run(task(PURPOSE_ANSWER_FROM_MEMORY))
        .catch((x: unknown) => x)) as NoProviderError;
      expect(e).toBeInstanceOf(NoProviderError);
      expect(e.routedTo).toBe("openai");
      expect(e.attempts).toEqual([
        {
          provider: "openai",
          outcome: "skipped",
          reason: "AI_external_processing permission is not granted",
          calls: 0,
        },
      ]);
      expect(p.calls).toEqual({ generate: 0, stream: 0, embed: 0, health: 0 });
    });

    it.each(["public", "internal", "sensitive"] as const)(
      "without the %s class opt-in: refused (per class), others unaffected",
      async (cls) => {
        const p = cloudProvider("openai");
        const optIn = { public: true, internal: true, sensitive: true, [cls]: false };
        const r = rig([p], { cloudOptIn: optIn, routing: { chat: { provider: "openai" } } });
        const e = (await r.service
          .run(task(PURPOSE_ANSWER_FROM_MEMORY, cls))
          .catch((x: unknown) => x)) as NoProviderError;
        expect(e).toBeInstanceOf(NoProviderError);
        expect(e.attempts[0]?.reason).toMatch(
          cls === "sensitive" ? /sensitive data stays on this device/ : /not enabled for/,
        );
        expect(p.calls.generate).toBe(0);
        const other = cls === "public" ? "internal" : "public";
        expect((await r.service.run(task(PURPOSE_ANSWER_FROM_MEMORY, other))).provider).toBe(
          "openai",
        );
      },
    );

    it("sensitive data on a purpose outside SENSITIVE_CLOUD_PURPOSES (e.g. dictation clean-up) is refused even with every opt-in", async () => {
      const p = cloudProvider("openai");
      const r = rig([p], {
        cloudOptIn: { public: true, internal: true, sensitive: true },
        routing: { cleanup: { provider: "openai" } },
      });
      const e = (await r.service
        .run(task(PURPOSE_CLEANUP, "sensitive"))
        .catch((x: unknown) => x)) as NoProviderError;
      expect(e).toBeInstanceOf(NoProviderError);
      expect(e.attempts[0]?.reason).toMatch(/purpose is not covered/);
      expect(p.calls.generate).toBe(0);
    });

    it("with grant + opt-in the routed cloud provider runs, and a sensitive send is audited", async () => {
      const p = cloudProvider("openai");
      const r = rig([p], {
        cloudOptIn: { public: true, internal: true, sensitive: true },
        routing: { chat: { provider: "openai" } },
      });
      const out = await r.service.run(task(PURPOSE_ANSWER_FROM_MEMORY, "sensitive"));
      expect(out.provider).toBe("openai");
      expect(r.audits).toEqual(["openai"]);
      // Revoking the grant stops the next send immediately.
      r.grant.value = false;
      await expect(
        r.service.run(task(PURPOSE_ANSWER_FROM_MEMORY, "sensitive")),
      ).rejects.toBeInstanceOf(NoProviderError);
      expect(p.calls.generate).toBe(1);
    });

    it("a route to a provider that no longer exists is a visible refusal, not a silent fallback", async () => {
      const local = fakeProvider({ id: "ollama", locality: "local" });
      const r = rig([local], { routing: { chat: { provider: "gone" } } });
      const e = (await r.service
        .run(task(PURPOSE_ANSWER_FROM_MEMORY))
        .catch((x: unknown) => x)) as NoProviderError;
      expect(e).toBeInstanceOf(NoProviderError);
      expect(e.attempts[0]?.reason).toMatch(/no longer exists/);
      expect(local.calls.generate).toBe(0);
    });
  });

  it("embeddings ignore routing: they never go to a cloud provider", async () => {
    const local = fakeProvider({ id: "ollama", locality: "local" });
    const cloud = cloudProvider("openai");
    const r = rig([local, cloud], {
      routing: { summaries: { provider: "openai" }, chat: { provider: "openai" } },
    });
    const out = await r.service.run({
      kind: "embed",
      request: { privacy: "public", purpose: "embed memory for retrieval", input: ["a"] },
    });
    expect(out.provider).toBe("ollama");
    expect(cloud.calls.embed).toBe(0);
  });

  it("status() does not contact a provider nobody chose", async () => {
    const local = fakeProvider({ id: "ollama", locality: "local" });
    const cloud = cloudProvider("openai");
    const r = rig([local, cloud], { routing: {} });
    const s = await r.service.status();
    expect(cloud.calls.health).toBe(0);
    expect(s.providers.find((p) => p.id === "openai")).toMatchObject({
      available: undefined,
      keyPolicy: "required",
      detail: "not checked (used only when you choose it)",
    });
  });

  it("cost and label are attached from the user's prices; local answers cost null", async () => {
    const withUsage = (id: string, locality: "local" | "cloud") => ({
      ...fakeProvider({
        id,
        locality,
        generate: () =>
          Promise.resolve({
            text: "x",
            provenance: { ...provenanceOf(id, locality), model: "m-1" },
            usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
          }),
      }),
      explicitOnly: locality === "cloud",
    });
    const r = rig([withUsage("ollama", "local"), withUsage("openai", "cloud")], {
      routing: { chat: { provider: "openai" } },
      prices: { "openai:m-1": { input_per_mtok: 1, output_per_mtok: 2 } },
    });
    const cloud = await r.service.run(task(PURPOSE_ANSWER_FROM_MEMORY));
    expect(cloud.provenance.cost).toEqual({
      amount: 3,
      currency: "USD",
      basis: "user-configured prices",
    });
    expect(cloud.provenance.usage).toEqual({ inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cloud.provenance.label).toBe("openai");
    r.settings.prices = {};
    expect((await r.service.run(task(PURPOSE_ANSWER_FROM_MEMORY))).provenance.cost).toBeNull();
    r.settings.routing = {};
    const local = await r.service.run(task(PURPOSE_ANSWER_FROM_MEMORY));
    expect(local.provider).toBe("ollama");
    expect(local.provenance.cost).toBeNull();
  });

  it("a streamed answer reports cost on its final chunk", async () => {
    const provider = {
      ...fakeProvider({
        id: "openai",
        locality: "cloud",
        stream: async function* () {
          const provenance = { ...provenanceOf("openai", "cloud"), model: "m-1" };
          yield { kind: "text" as const, text: "a", provenance };
          yield {
            kind: "done" as const,
            provenance,
            usage: { inputTokens: 1_000_000, outputTokens: 0 },
          };
        },
      }),
      explicitOnly: true,
    };
    const r = rig([provider], {
      routing: { chat: { provider: "openai" } },
      prices: { "openai:m-1": { input_per_mtok: 5, output_per_mtok: 5 } },
    });
    const out = await r.service.run({ ...task(PURPOSE_ANSWER_FROM_MEMORY), kind: "stream" });
    const chunks = [];
    for await (const c of out.stream) chunks.push(c);
    expect(chunks.at(-1)).toMatchObject({ kind: "done", provenance: { cost: { amount: 5 } } });
  });
});

describe("real adapters through the gate (fake network)", () => {
  const net = (handler?: (url: string) => Response): FakeFetch =>
    fakeFetch((req) => {
      if (handler) return handler(req.url);
      if (req.url.includes("/chat/completions")) {
        return json({
          model: "m-1",
          choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        });
      }
      if (req.url.endsWith("/models")) return json({ data: [{ id: "m-1" }] });
      return json({ version: "0" });
    });

  function build(f: FakeFetch, grant: () => boolean, settings: AiSettings) {
    return new AiService({
      registry: createDefaultProviders({ fetch: f.fetch, keyFor: () => Promise.resolve(KEY) }),
      policy: { allowed: grant },
      settings: () => settings,
      auditCloudSend: () => {},
    });
  }

  it("a routed OpenAI cloud provider sends NOTHING when the grant is missing; with the grant it does, with the key", async () => {
    const f = net();
    let granted = false;
    const settings: AiSettings = {
      ...OPEN,
      routing: { chat: { provider: "openai", model: "m-1" } },
    };
    const service = build(f, () => granted, settings);
    await expect(service.run(task(PURPOSE_ANSWER_FROM_MEMORY))).rejects.toBeInstanceOf(
      NoProviderError,
    );
    expect(f.requests).toEqual([]);
    granted = true;
    const out = await service.run(task(PURPOSE_ANSWER_FROM_MEMORY));
    expect(out.provenance).toMatchObject({ provider: "openai", locality: "cloud", model: "m-1" });
    const chat = f.requests.find((r) => r.url.includes("/chat/completions"))!;
    expect(chat.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(chat.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it("LM Studio (loopback) is local: it runs with no grant, no opt-in and no key", async () => {
    const f = net();
    const registry = createDefaultProviders({
      fetch: f.fetch,
      keyFor: () => Promise.resolve(undefined),
    });
    const service = new AiService({
      registry,
      policy: { allowed: () => false },
      settings: () => ({
        enabled: true,
        cloudOptIn: { public: false, internal: false, sensitive: false },
        routing: { chat: { provider: "lmstudio", model: "m-1" } },
      }),
    });
    const out = await service.run(task(PURPOSE_ANSWER_FROM_MEMORY, "sensitive"));
    expect(out.provenance).toMatchObject({ provider: "lmstudio", locality: "local" });
    expect(out.provenance.cost).toBeNull();
    expect(f.requests.map((r) => new URL(r.url).origin)).toEqual([
      "http://localhost:1234",
      "http://localhost:1234",
    ]);
    expect(f.requests.some((r) => "authorization" in r.headers)).toBe(false);
  });

  it("a routed cloud provider with no key fails with 'No API key is set for <label>' and sends no chat request", async () => {
    const f = net();
    const service = new AiService({
      registry: createDefaultProviders({
        fetch: f.fetch,
        keyFor: () => Promise.resolve(undefined),
      }),
      policy: { allowed: () => true },
      settings: () => ({ ...OPEN, routing: { chat: { provider: "deepseek", model: "m-1" } } }),
    });
    const e = (await service
      .run(task(PURPOSE_ANSWER_FROM_MEMORY))
      .catch((x: unknown) => x)) as NoProviderError;
    expect(e).toBeInstanceOf(NoProviderError);
    expect(e.attempts[0]?.reason).toBe("No API key is set for DeepSeek (cloud)");
    expect(f.requests).toEqual([]);
  });
});
