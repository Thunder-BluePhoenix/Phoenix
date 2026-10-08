// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createLogger, type LogRecord } from "@phoenix/logging";
import { describe, expect, it } from "vitest";
import {
  AiDisabledError,
  AiService,
  AllProvidersFailedError,
  ModelError,
  NoProviderError,
  ProviderRegistry,
  createDefaultProviders,
  type AiSettings,
  type AiServiceDeps,
  type GenerateTask,
  type ModelProvider,
  type StreamChunk,
} from "../src";
import {
  chunked,
  fakeFetch as rawFakeFetch,
  fakeProvider,
  json,
  ollamaLines,
  provenanceOf,
  withTags,
  type FakeFetch,
  type FakeHandler,
} from "./helpers";

const fakeFetch = (handler: FakeHandler) => rawFakeFetch(withTags(handler));
const KEY = "sk-ant-api03-LEAKCANARY0123456789abcdefLEAKCANARY";
const gen = (over: Partial<GenerateTask> = {}): GenerateTask => ({
  kind: "generate",
  request: { privacy: "public", purpose: "test", messages: [{ role: "user", content: "hi" }] },
  ...over,
});
const ON: AiSettings = { enabled: true, cloudOptIn: { public: true, internal: true } };

interface Rig {
  service: AiService;
  sleeps: number[];
  settings: AiSettings;
  grant: { value: boolean };
  logs: LogRecord[];
}

function rig(
  providers: ModelProvider[],
  over: Partial<AiSettings> = {},
  deps: Partial<AiServiceDeps> = {},
): Rig {
  const registry = new ProviderRegistry();
  for (const p of providers) registry.register(p);
  const settings: AiSettings = { ...ON, ...over };
  const grant = { value: true };
  const sleeps: number[] = [];
  const logs: LogRecord[] = [];
  const service = new AiService({
    registry,
    policy: { allowed: () => grant.value },
    settings: () => settings,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    logger: createLogger({ sink: (r) => logs.push(r), level: "debug" }),
    ...deps,
  });
  return { service, sleeps, settings, grant, logs };
}

const fail = (status: number, retryAfterMs?: number) => () =>
  Promise.reject(
    new ModelError("http", "x", `HTTP ${status}`, {
      status,
      retryable: status === 429 || status >= 500,
      retryAfterMs,
    }),
  );

describe("disabled", () => {
  it("every entry point rejects with AiDisabledError and the network sees zero requests", async () => {
    const f = fakeFetch(() => json({}));
    const registry = createDefaultProviders({
      fetch: f.fetch,
      anthropicKey: () => Promise.resolve(KEY),
    });
    const service = new AiService({
      registry,
      policy: { allowed: () => true },
      settings: () => ({ enabled: false, cloudOptIn: { public: true, internal: true } }),
    });
    const req = { privacy: "public" as const, purpose: "t" };
    const msgs = [{ role: "user" as const, content: "x" }];
    await expect(
      service.run({ kind: "generate", request: { ...req, messages: msgs } }),
    ).rejects.toBeInstanceOf(AiDisabledError);
    await expect(
      service.run({ kind: "stream", request: { ...req, messages: msgs } }),
    ).rejects.toBeInstanceOf(AiDisabledError);
    await expect(
      service.run({ kind: "embed", request: { ...req, input: ["x"] } }),
    ).rejects.toBeInstanceOf(AiDisabledError);
    expect(() => service.plan({ kind: "generate", privacy: "public" })).toThrow(AiDisabledError);
    expect(await service.status()).toMatchObject({ enabled: false, providers: [] });
    expect(f.requests).toHaveLength(0);
  });

  it("is checked on every call: turning AI off applies immediately, turning it on works without restart", async () => {
    const p = fakeProvider({ id: "ollama", locality: "local" });
    const r = rig([p], { enabled: true });
    await r.service.run(gen());
    r.settings.enabled = false;
    await expect(r.service.run(gen())).rejects.toBeInstanceOf(AiDisabledError);
    expect(p.calls).toMatchObject({ generate: 1 });
    r.settings.enabled = true;
    await r.service.run(gen());
    expect(p.calls.generate).toBe(2);
  });

  it("a disabled provider is not even health-checked", async () => {
    const p = fakeProvider({ id: "ollama", locality: "local" });
    const r = rig([p], { enabled: false });
    await expect(r.service.run(gen())).rejects.toBeInstanceOf(AiDisabledError);
    expect(p.calls).toEqual({ generate: 0, stream: 0, embed: 0, health: 0 });
  });
});

describe("gate: no silent external transmission", () => {
  /** Real adapters over one fake network, so we can assert what actually left the machine. */
  function network(handler?: FakeHandler) {
    const f = fakeFetch(
      handler ??
        ((req) => {
          if (req.url.startsWith("https://api.anthropic.com")) {
            return json({
              model: "claude-test-1",
              content: [{ type: "text", text: "cloud answer" }],
              usage: {},
            });
          }
          if (req.url.endsWith("/api/version")) return json({ version: "0.15.5" });
          return json({ message: { role: "assistant", content: "local answer" }, done: true });
        }),
    );
    return {
      f,
      registry: createDefaultProviders({
        fetch: f.fetch,
        anthropicKey: () => Promise.resolve(KEY),
      }),
    };
  }
  const cloudRequests = (f: FakeFetch) => f.requests.filter((r) => r.url.includes("anthropic"));
  const build = (registry: ProviderRegistry, grant: () => boolean, optIn = ON.cloudOptIn) =>
    new AiService({
      registry,
      policy: { allowed: grant },
      settings: () => ({ enabled: true, preferred: "anthropic", cloudOptIn: optIn }),
    });

  it("without the grant, a preferred cloud provider receives ZERO requests (not even a health probe) and the local one answers", async () => {
    const { f, registry } = network();
    const out = await build(registry, () => false).run(gen());
    expect(cloudRequests(f)).toHaveLength(0);
    expect(out.provider).toBe("ollama");
    expect(out.provenance.locality).toBe("local");
    expect(out.attempts.find((a) => a.provider === "anthropic")).toMatchObject({
      outcome: "skipped",
      calls: 0,
      reason: expect.stringContaining("AI_external_processing"),
    });
  });

  it("with the grant but no opt-in for the class, the cloud still receives nothing", async () => {
    const { f, registry } = network();
    const out = await build(registry, () => true, { public: false, internal: true }).run(gen());
    expect(cloudRequests(f)).toHaveLength(0);
    expect(out.provider).toBe("ollama");
    expect(out.attempts[0]?.reason).toMatch(/not enabled for public/);
  });

  it("when nothing local is up and cloud is not allowed, the call fails visibly instead of sending anyway", async () => {
    const { f, registry } = network((req) => {
      if (req.url.includes("anthropic")) return json({ content: [] });
      throw new TypeError("connect ECONNREFUSED");
    });
    const e = await build(registry, () => false)
      .run(gen())
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(NoProviderError);
    expect((e as NoProviderError).attempts.map((a) => [a.provider, a.outcome, a.reason])).toEqual([
      ["anthropic", "skipped", "AI_external_processing permission is not granted"],
      ["ollama", "skipped", "unavailable (offline or not running)"],
    ]);
    expect(cloudRequests(f)).toHaveLength(0);
  });

  it("a plan with nothing allowed is a NoProviderError carrying every reason", async () => {
    const { f, registry } = network();
    const only = new ProviderRegistry();
    only.register(registry.get("anthropic")!);
    const e = await build(only, () => true)
      .run(gen({ request: { ...gen().request, privacy: "sensitive" } }))
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(NoProviderError);
    expect((e as NoProviderError).details.join(" ")).toMatch(
      /sensitive data never leaves this device/,
    );
    expect(f.requests).toHaveLength(0);
  });

  it("sensitive data never reaches the cloud even with grant + opt-in + preferred, for generate, stream and embed", async () => {
    const { f, registry } = network((req) => {
      if (req.url.endsWith("/api/version")) return json({ version: "x" });
      if (req.url.endsWith("/api/embed")) return json({ embeddings: [[1, 2]] });
      if (req.url.includes("anthropic")) return json({ content: [{ type: "text", text: "LEAK" }] });
      if (req.body.includes('"stream":true'))
        return chunked([ollamaLines({ message: { content: "ok" }, done: false }, { done: true })]);
      return json({ message: { content: "ok" }, done: true });
    });
    const s = build(registry, () => true);
    const sensitive = "sensitive" as const;
    const base = { privacy: sensitive, purpose: "t" };
    const msgs = [{ role: "user" as const, content: "my secret diary" }];
    const g = await s.run({ kind: "generate", request: { ...base, messages: msgs } });
    const st = await s.run({ kind: "stream", request: { ...base, messages: msgs } });
    for await (const _ of st.stream) void _;
    const em = await s.run({ kind: "embed", request: { ...base, input: ["diary"] } });
    expect([g.provider, st.provider, em.provider]).toEqual(["ollama", "ollama", "ollama"]);
    expect(cloudRequests(f)).toHaveLength(0);
    expect(f.requests.every((r) => r.url.startsWith("http://127.0.0.1:11434"))).toBe(true);
  });

  it("with grant + opt-in the cloud is used, labelled, and the key is sent only to it", async () => {
    const { f, registry } = network();
    const out = await build(registry, () => true).run(gen());
    expect(out.provider).toBe("anthropic");
    expect(out.provenance.processedBy).toBe("Anthropic (cloud) · claude-test-1 · cloud");
    expect(
      f.requests
        .filter((r) => r.headers["x-api-key"] !== undefined)
        .every((r) => r.url.startsWith("https://api.anthropic.com")),
    ).toBe(true);
  });

  it("revoking the grant between retries stops the cloud call that would have been the retry", async () => {
    let calls = 0;
    const cloud = fakeProvider({
      id: "anthropic",
      locality: "cloud",
      generate: () => {
        calls++;
        return fail(503)();
      },
    });
    const r = rig([cloud], { preferred: "anthropic" });
    const revokeOnSleep = new AiService({
      registry: (() => {
        const reg = new ProviderRegistry();
        reg.register(cloud);
        return reg;
      })(),
      policy: { allowed: () => r.grant.value },
      settings: () => r.settings,
      sleep: () => {
        r.grant.value = false;
        return Promise.resolve();
      },
    });
    const e = await revokeOnSleep.run(gen()).catch((x: unknown) => x);
    expect(calls).toBe(1);
    expect(e).toBeInstanceOf(AllProvidersFailedError);
    expect((e as AllProvidersFailedError).attempts[0]?.reason).toMatch(/AI_external_processing/);
  });
});

describe("retries", () => {
  it("retries a 503 with exponential backoff via the injected sleeper, then succeeds", async () => {
    let n = 0;
    const p = fakeProvider({
      id: "ollama",
      locality: "local",
      generate: () =>
        ++n < 3
          ? fail(503)()
          : Promise.resolve({ text: "ok", provenance: provenanceOf("ollama", "local") }),
    });
    const r = rig([p]);
    const out = await r.service.run(gen());
    expect(out.result.text).toBe("ok");
    expect(p.calls.generate).toBe(3);
    expect(r.sleeps).toEqual([500, 1000]);
    expect(out.attempts).toEqual([{ provider: "ollama", outcome: "answered", calls: 3 }]);
  });

  it("is bounded: gives up after maxAttempts and does not sleep after the last try", async () => {
    const p = fakeProvider({ id: "ollama", locality: "local", generate: fail(500) });
    const r = rig([p], {}, { retry: { maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 250 } });
    await expect(r.service.run(gen())).rejects.toBeInstanceOf(AllProvidersFailedError);
    expect(p.calls.generate).toBe(4);
    expect(r.sleeps).toEqual([100, 200, 250]);
  });

  it("honours Retry-After when it is longer than the backoff", async () => {
    let n = 0;
    const p = fakeProvider({
      id: "ollama",
      locality: "local",
      generate: () =>
        ++n < 2
          ? fail(429, 7000)()
          : Promise.resolve({ text: "ok", provenance: provenanceOf("ollama", "local") }),
    });
    const r = rig([p]);
    await r.service.run(gen());
    expect(r.sleeps).toEqual([7000]);
  });

  it.each([400, 404, 422])("never retries HTTP %i", async (status) => {
    const p = fakeProvider({ id: "ollama", locality: "local", generate: fail(status) });
    const r = rig([p]);
    await expect(r.service.run(gen())).rejects.toBeInstanceOf(AllProvidersFailedError);
    expect(p.calls.generate).toBe(1);
    expect(r.sleeps).toEqual([]);
  });

  it("never retries an auth error or an unsupported call", async () => {
    const p = fakeProvider({
      id: "ollama",
      locality: "local",
      generate: () => Promise.reject(new ModelError("auth", "ollama", "no")),
    });
    const r = rig([p]);
    await expect(r.service.run(gen())).rejects.toBeInstanceOf(AllProvidersFailedError);
    expect(p.calls.generate).toBe(1);
  });

  it("retries embed too, but never a stream", async () => {
    let embeds = 0;
    const p = fakeProvider({
      id: "ollama",
      locality: "local",
      embed: () =>
        ++embeds < 2
          ? fail(502)()
          : Promise.resolve({
              embeddings: [[1]],
              dimensions: 1,
              provenance: provenanceOf("ollama", "local"),
            }),
      // eslint-disable-next-line require-yield
      stream: async function* (): AsyncGenerator<StreamChunk> {
        throw new ModelError("network", "ollama", "down", { retryable: true });
      },
    });
    const r = rig([p]);
    await r.service.run({
      kind: "embed",
      request: { privacy: "public", purpose: "t", input: ["a"] },
    });
    expect(embeds).toBe(2);
    await expect(r.service.run({ kind: "stream", request: gen().request })).rejects.toBeInstanceOf(
      AllProvidersFailedError,
    );
    expect(p.calls.stream).toBe(1);
  });

  it("abort during backoff stops immediately and does not fall back", async () => {
    const a = fakeProvider({ id: "a-local", locality: "local", generate: fail(503) });
    const b = fakeProvider({ id: "b-local", locality: "local" });
    const ctl = new AbortController();
    const r = rig(
      [a, b],
      {},
      {
        sleep: () => {
          ctl.abort();
          return Promise.reject(new ModelError("aborted", "ai", "The request was cancelled"));
        },
      },
    );
    await expect(r.service.run(gen({ signal: ctl.signal }))).rejects.toMatchObject({
      kind: "aborted",
    });
    expect(a.calls.generate).toBe(1);
    expect(b.calls.generate).toBe(0);
  });

  it("an already-aborted signal makes no provider call", async () => {
    const p = fakeProvider({ id: "ollama", locality: "local" });
    const ctl = new AbortController();
    ctl.abort();
    const r = rig([p]);
    await expect(r.service.run(gen({ signal: ctl.signal }))).rejects.toMatchObject({
      kind: "aborted",
    });
    expect(p.calls.generate).toBe(0);
  });

  it("passes the signal and timeout to the provider", async () => {
    let seen: { signal?: AbortSignal; timeoutMs?: number } = {};
    const p = fakeProvider({
      id: "ollama",
      locality: "local",
      generate: (_req, opts) => {
        seen = opts;
        return Promise.resolve({ text: "ok", provenance: provenanceOf("ollama", "local") });
      },
    });
    const ctl = new AbortController();
    await rig([p]).service.run(gen({ signal: ctl.signal, timeoutMs: 1234 }));
    expect(seen).toEqual({ signal: ctl.signal, timeoutMs: 1234 });
  });
});

describe("fallback", () => {
  it("falls through allowed candidates in plan order and reports who answered and who failed", async () => {
    const a = fakeProvider({ id: "a-local", locality: "local", costTier: 0, generate: fail(400) });
    const b = fakeProvider({ id: "b-local", locality: "local", costTier: 1, generate: fail(400) });
    const c = fakeProvider({ id: "c-cloud", locality: "cloud", costTier: 2 });
    const r = rig([c, b, a]);
    const out = await r.service.run(gen());
    expect(out.provider).toBe("c-cloud");
    expect(out.provenance.provider).toBe("c-cloud");
    expect(out.attempts.map((x) => [x.provider, x.outcome])).toEqual([
      ["a-local", "failed"],
      ["b-local", "failed"],
      ["c-cloud", "answered"],
    ]);
    expect(out.attempts[0]?.reason).toContain("400");
  });

  it("never falls back to a provider the gate refuses", async () => {
    const a = fakeProvider({ id: "a-local", locality: "local", generate: fail(400) });
    const c = fakeProvider({ id: "c-cloud", locality: "cloud" });
    const r = rig([a, c], {}, {});
    r.grant.value = false;
    await expect(r.service.run(gen())).rejects.toBeInstanceOf(AllProvidersFailedError);
    expect(c.calls).toEqual({ generate: 0, stream: 0, embed: 0, health: 0 });
  });

  it("the user's preferred provider goes first; a failing one falls back to the other", async () => {
    const local = fakeProvider({ id: "ollama", locality: "local" });
    const cloud = fakeProvider({ id: "anthropic", locality: "cloud", generate: fail(400) });
    const r = rig([local, cloud], { preferred: "anthropic" });
    const out = await r.service.run(gen());
    expect(cloud.calls.generate).toBe(1);
    expect(out.provider).toBe("ollama");
  });

  it("a provider whose health check says it is down is skipped without a generate call; health is cached for healthTtlMs", async () => {
    let t = 0;
    let up = false;
    const down = fakeProvider({
      id: "a-local",
      locality: "local",
      health: () => Promise.resolve({ available: up, detail: up ? "ok" : "down" }),
    });
    const other = fakeProvider({ id: "b-local", locality: "local", costTier: 1 });
    const r = rig([down, other], {}, { now: () => t, healthTtlMs: 1000 });
    expect((await r.service.run(gen())).provider).toBe("b-local");
    expect(down.calls.generate).toBe(0);
    await r.service.run(gen());
    expect(down.calls.health).toBe(1);
    up = true;
    t = 1000;
    expect((await r.service.run(gen())).provider).toBe("a-local");
    expect(down.calls.health).toBe(2);
  });

  it("a network failure marks the provider down so the next call skips it", async () => {
    const flaky = fakeProvider({
      id: "a-local",
      locality: "local",
      generate: () =>
        Promise.reject(new ModelError("network", "a-local", "down", { retryable: false })),
    });
    const other = fakeProvider({ id: "b-local", locality: "local", costTier: 1 });
    const r = rig([flaky, other], {}, { now: () => 0 });
    await r.service.run(gen());
    await r.service.run(gen());
    expect(flaky.calls.generate).toBe(1);
  });
});

describe("streaming through the service", () => {
  const chunks = (id: string): ((req: unknown) => AsyncIterable<StreamChunk>) =>
    async function* () {
      const provenance = provenanceOf(id, "local");
      yield { kind: "text", text: "a", provenance };
      yield { kind: "text", text: "b", provenance };
      yield { kind: "done", provenance };
    };

  it("yields every chunk including the first and reports the answering provider", async () => {
    const p = fakeProvider({ id: "ollama", locality: "local", stream: chunks("ollama") });
    const out = await rig([p]).service.run({ kind: "stream", request: gen().request });
    const got: string[] = [];
    for await (const c of out.stream) got.push(c.kind === "text" ? c.text : c.kind);
    expect(got).toEqual(["a", "b", "done"]);
    expect(out.provenance.processedBy).toMatch(/ollama/);
  });

  it("falls back when the first provider fails before any output", async () => {
    const a = fakeProvider({
      id: "a-local",
      locality: "local",
      // eslint-disable-next-line require-yield
      stream: async function* () {
        throw new ModelError("http", "a-local", "HTTP 500", { status: 500, retryable: true });
      },
    });
    const b = fakeProvider({
      id: "b-local",
      locality: "local",
      costTier: 1,
      stream: chunks("b-local"),
    });
    const out = await rig([a, b]).service.run({ kind: "stream", request: gen().request });
    expect(out.provider).toBe("b-local");
    expect(a.calls.stream).toBe(1);
  });

  it("an error after the first chunk reaches the consumer and is NOT replayed on another provider", async () => {
    const a = fakeProvider({
      id: "a-local",
      locality: "local",
      stream: async function* () {
        yield { kind: "text", text: "partial", provenance: provenanceOf("a-local", "local") };
        throw new ModelError("network", "a-local", "dropped", { retryable: true });
      },
    });
    const b = fakeProvider({ id: "b-local", locality: "local", costTier: 1 });
    const out = await rig([a, b]).service.run({ kind: "stream", request: gen().request });
    const got: string[] = [];
    await expect(
      (async () => {
        for await (const c of out.stream) if (c.kind === "text") got.push(c.text);
      })(),
    ).rejects.toMatchObject({ kind: "network" });
    expect(got).toEqual(["partial"]);
    expect(b.calls.stream).toBe(0);
  });
});

describe("the API key never leaks", () => {
  it("is absent from errors, attempts, status, plans and logs across success, failure and fallback", async () => {
    const f = fakeFetch((req) => {
      if (req.url.endsWith("/api/version")) return json({ version: "0.15.5" });
      if (req.url.includes("/v1/models")) return json({ data: [] });
      if (req.url.includes("anthropic"))
        return json(
          { error: { type: "x", message: `echo ${KEY} ${req.headers["x-api-key"]}` } },
          400,
        );
      return json({ message: { content: "local" }, done: true });
    });
    const registry = createDefaultProviders({
      fetch: f.fetch,
      anthropicKey: () => Promise.resolve(KEY),
    });
    const logs: LogRecord[] = [];
    const service = new AiService({
      registry,
      policy: { allowed: () => true },
      settings: () => ({ enabled: true, preferred: "anthropic", cloudOptIn: ON.cloudOptIn }),
      logger: createLogger({ sink: (r) => logs.push(r), level: "debug" }),
      sleep: () => Promise.resolve(),
    });
    const out = await service.run(gen());
    expect(out.provider).toBe("ollama");
    const status = await service.status();
    const plan = service.plan({ kind: "generate", privacy: "public" });
    // The key really was sent to the cloud provider (so the test can fail if it leaked).
    expect(f.requests.some((r) => r.headers["x-api-key"] === KEY)).toBe(true);
    const everything = JSON.stringify([out.attempts, status, plan, logs]);
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain("LEAKCANARY");
    expect(out.attempts[0]).toMatchObject({ provider: "anthropic", outcome: "failed" });
  });
});

describe("status", () => {
  it("shows per-class access so the UI can explain what is allowed", async () => {
    const local = fakeProvider({ id: "ollama", locality: "local" });
    const cloud = fakeProvider({ id: "anthropic", locality: "cloud" });
    const r = rig([local, cloud], { cloudOptIn: { public: true, internal: false } });
    const s = await r.service.status();
    const a = s.providers.find((p) => p.id === "anthropic")!;
    expect(a.access.public.allowed).toBe(true);
    expect(a.access.internal).toMatchObject({
      allowed: false,
      reason: expect.stringContaining("internal"),
    });
    expect(a.access.sensitive.allowed).toBe(false);
    expect(s.providers.find((p) => p.id === "ollama")?.access.sensitive.allowed).toBe(true);
  });
});
