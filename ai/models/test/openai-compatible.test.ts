// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The OpenAI-compatible adapter is verified ONLY against a fake that emits the documented wire
// format. No provider key was used: nothing here proves it works against a real vendor.
import { describe, expect, it } from "vitest";
import {
  createEndpointProvider,
  ModelError,
  OPENAI_COMPATIBLE_PRESETS,
  OpenAiCompatibleProvider,
  type FetchLike,
  type StreamChunk,
} from "../src";
import { chunked, fakeFetch, json } from "./helpers";

/** Assembled at runtime: no token-shaped literal in the tree. */
const KEY = ["canary", "key", "0123456789", "abcdef", "CANARY"].join("-");
const req = {
  privacy: "public" as const,
  purpose: "test",
  messages: [
    { role: "system" as const, content: "be brief" },
    { role: "user" as const, content: "hello" },
  ],
  model: "gpt-test",
};
const CLOUD = "https://api.example.test/v1";
const make = (
  fetch: FetchLike,
  over: Partial<ConstructorParameters<typeof OpenAiCompatibleProvider>[0]> = {},
) =>
  new OpenAiCompatibleProvider({
    id: "custom",
    label: "Custom (cloud)",
    baseUrl: CLOUD,
    getKey: () => Promise.resolve(KEY),
    fetch,
    ...over,
  });

const completion = {
  id: "c1",
  model: "gpt-test-2025",
  choices: [
    { index: 0, message: { role: "assistant", content: "hi there" }, finish_reason: "stop" },
  ],
  usage: { prompt_tokens: 9, completion_tokens: 4 },
};

const sse = (...events: unknown[]) =>
  events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join("");

async function collect(it: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

describe("locality is derived from the URL, never claimed", () => {
  it.each([
    ["https://api.example.test/v1", "cloud"],
    ["http://localhost:1234/v1", "local"],
    ["http://127.0.0.1:8080/v1", "local"],
    ["https://127.0.0.1:8443/v1", "local"],
    ["http://[::1]:1234/v1", "local"],
    // A look-alike host is not loopback.
    ["https://localhost.evil.example/v1", "cloud"],
    ["https://127.0.0.1.evil.example/v1", "cloud"],
  ])("%s is %s", (baseUrl, locality) => {
    const p = make(fakeFetch(() => json({})).fetch, { baseUrl });
    expect(p.locality).toBe(locality);
    expect(p.keyPolicy).toBe(locality === "cloud" ? "required" : "optional");
    expect(p.costTier).toBe(locality === "cloud" ? 2 : 0);
    // Only a server on this device is offered for embeddings.
    expect(p.capabilities.embed).toBe(locality === "local");
  });

  it.each([
    ["http://api.example.test/v1", /must use https/],
    ["http://192.168.1.5:1234/v1", /must use https/],
    ["ftp://api.example.test/v1", /must use https/],
    ["not a url", /not a valid URL/],
    ["https://user:pw@api.example.test/v1", /must not contain credentials/],
    ["https://:pw@api.example.test/v1", /must not contain credentials/],
    ["https://api.example.test/v1?key=abc", /query string or fragment/],
    ["https://api.example.test/v1#frag", /query string or fragment/],
  ])("rejects %s before any request or key read", (baseUrl, message) => {
    let keyReads = 0;
    const f = fakeFetch(() => json({}));
    expect(() =>
      make(f.fetch, {
        baseUrl,
        getKey: () => {
          keyReads++;
          return Promise.resolve(KEY);
        },
      }),
    ).toThrow(ModelError);
    expect(() => make(f.fetch, { baseUrl })).toThrow(message);
    expect(f.requests).toHaveLength(0);
    expect(keyReads).toBe(0);
  });

  it("a trailing slash in the base URL is normalised", async () => {
    const f = fakeFetch(() => json(completion));
    await make(f.fetch, { baseUrl: `${CLOUD}///` }).generate(req);
    expect(f.requests[0]!.url).toBe(`${CLOUD}/chat/completions`);
  });
});

describe("generate", () => {
  it("posts the documented body with the key as a Bearer header and parses text, model and usage", async () => {
    const f = fakeFetch(() => json(completion));
    const r = await make(f.fetch).generate({ ...req, maxTokens: 50, temperature: 0 });
    expect(r.text).toBe("hi there");
    expect(r.provenance).toMatchObject({
      provider: "custom",
      model: "gpt-test-2025",
      locality: "cloud",
    });
    expect(r.usage).toEqual({ inputTokens: 9, outputTokens: 4 });
    expect(r.finishReason).toBe("stop");
    const sent = f.requests[0]!;
    expect(sent.method).toBe("POST");
    expect(sent.url).toBe(`${CLOUD}/chat/completions`);
    expect(sent.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(sent.url).not.toContain(KEY);
    expect(JSON.parse(sent.body)).toEqual({
      model: "gpt-test",
      messages: req.messages,
      stream: false,
      max_tokens: 50,
      temperature: 0,
    });
  });

  it("uses max_completion_tokens when configured (OpenAI's own name)", async () => {
    const f = fakeFetch(() => json(completion));
    await make(f.fetch, { maxTokensField: "max_completion_tokens" }).generate({
      ...req,
      maxTokens: 5,
    });
    expect(JSON.parse(f.requests[0]!.body)).toMatchObject({ max_completion_tokens: 5 });
    expect(JSON.parse(f.requests[0]!.body)).not.toHaveProperty("max_tokens");
  });

  it("never follows a redirect: the request asks fetch to error on redirects", async () => {
    let redirect: RequestInit["redirect"];
    const fetch: FetchLike = async (_url, init) => {
      redirect = init?.redirect;
      return json(completion);
    };
    await make(fetch).generate(req);
    expect(redirect).toBe("error");
  });

  it("a redirect (fetch rejects) is a network error that does not mention the key or the target", async () => {
    const fetch: FetchLike = () =>
      Promise.reject(new TypeError(`redirect to https://evil.example/?k=${KEY}`));
    const e = await make(fetch)
      .generate(req)
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ModelError);
    expect((e as ModelError).kind).toBe("network");
    expect((e as ModelError).message).not.toContain(KEY);
    expect((e as ModelError).message).not.toContain("evil");
  });

  it("a missing key fails clearly and sends nothing", async () => {
    const f = fakeFetch(() => json(completion));
    const e = await make(f.fetch, { getKey: () => Promise.resolve(undefined) })
      .generate(req)
      .catch((x: unknown) => x);
    expect(e).toMatchObject({ kind: "auth", message: "No API key is set for Custom (cloud)" });
    expect(f.requests).toHaveLength(0);
    const blank = await make(f.fetch, { getKey: () => Promise.resolve("   ") })
      .generate(req)
      .catch((x: unknown) => x);
    expect(blank).toMatchObject({ kind: "auth", message: "No API key is set for Custom (cloud)" });
  });

  it("an unreadable key store is an auth error that names no secret", async () => {
    const e = await make(fakeFetch(() => json({})).fetch, {
      getKey: () => Promise.reject(new Error(`keychain says ${KEY}`)),
    })
      .generate(req)
      .catch((x: unknown) => x);
    expect(e).toMatchObject({ kind: "auth" });
    expect((e as ModelError).message).not.toContain(KEY);
  });

  it("a server on this device works without a key and sends no Authorization header", async () => {
    const f = fakeFetch(() => json(completion));
    const p = make(f.fetch, {
      baseUrl: "http://localhost:1234/v1",
      getKey: () => Promise.resolve(undefined),
    });
    const r = await p.generate(req);
    expect(r.provenance.locality).toBe("local");
    expect(f.requests[0]!.headers).not.toHaveProperty("authorization");
  });

  it("maps HTTP errors without ever putting the server's text or the key in the message", async () => {
    const secretText = `the key ${KEY} is bad; prompt was hello`;
    for (const [status, kind, retryable] of [
      [401, "auth", false],
      [403, "auth", false],
      [429, "http", true],
      [500, "http", true],
      [400, "http", false],
    ] as const) {
      const f = fakeFetch(() => json({ error: { message: secretText, type: "x" } }, status));
      const e = (await make(f.fetch)
        .generate(req)
        .catch((x: unknown) => x)) as ModelError;
      expect(e, String(status)).toBeInstanceOf(ModelError);
      expect(e.kind).toBe(kind);
      expect(e.retryable).toBe(retryable);
      expect(e.message).not.toContain(KEY);
      expect(e.message).not.toContain("prompt was hello");
      expect(e.message).not.toContain("the key");
      expect(e.status).toBe(status);
    }
  });

  it("429 carries Retry-After; an unparsable success body is a protocol error", async () => {
    const limited = fakeFetch(() => json({}, 429, { "retry-after": "2" }));
    const e = (await make(limited.fetch)
      .generate(req)
      .catch((x: unknown) => x)) as ModelError;
    expect(e.retryAfterMs).toBe(2000);
    for (const body of [
      "not json",
      JSON.stringify({ choices: [] }),
      JSON.stringify({ choices: [{ message: { content: null } }] }),
    ]) {
      const f = fakeFetch(() => new Response(body, { status: 200 }));
      await expect(make(f.fetch).generate(req)).rejects.toMatchObject({ kind: "protocol" });
    }
  });

  it("without a model it uses the preset default, then (local only) the first listed chat model; a cloud server never guesses", async () => {
    const withDefault = fakeFetch(() => json(completion));
    await make(withDefault.fetch, { defaultModel: "dflt" }).generate({ ...req, model: undefined });
    expect(JSON.parse(withDefault.requests[0]!.body).model).toBe("dflt");

    const cloud = fakeFetch(() => json(completion));
    await expect(make(cloud.fetch).generate({ ...req, model: undefined })).rejects.toMatchObject({
      kind: "config",
      message: "Choose a model for Custom (cloud) in the model switcher",
    });
    expect(cloud.requests).toHaveLength(0);

    const local = fakeFetch((r) =>
      r.url.endsWith("/models")
        ? json({ data: [{ id: "text-embedding-x" }, { id: "qwen-local" }] })
        : json(completion),
    );
    await make(local.fetch, { baseUrl: "http://localhost:1234/v1" }).generate({
      ...req,
      model: undefined,
    });
    expect(JSON.parse(local.requests[1]!.body).model).toBe("qwen-local");
  });

  it("rejects a malformed model name and empty messages before sending", async () => {
    const f = fakeFetch(() => json(completion));
    for (const model of ["", "a b", "x\ny", "../../etc", "a".repeat(201)]) {
      await expect(make(f.fetch).generate({ ...req, model })).rejects.toMatchObject({
        kind: "invalid",
      });
    }
    await expect(make(f.fetch).generate({ ...req, messages: [] })).rejects.toMatchObject({
      kind: "invalid",
    });
    expect(f.requests).toHaveLength(0);
  });

  it("refuses a model a local server forwards to a remote host", async () => {
    const f = fakeFetch(() => json(completion));
    const p = make(f.fetch, {
      baseUrl: "http://localhost:11434/v1",
      getKey: () => Promise.resolve(undefined),
    });
    await expect(p.generate({ ...req, model: "gpt-oss:120b-cloud" })).rejects.toMatchObject({
      kind: "config",
    });
    expect(f.requests).toHaveLength(0);
  });
});

describe("stream (documented SSE format, mock only)", () => {
  const events = [
    { model: "gpt-test-2025", choices: [{ index: 0, delta: { role: "assistant", content: "" } }] },
    { choices: [{ index: 0, delta: { content: "Hel" } }] },
    { choices: [{ index: 0, delta: { content: "lo" } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    { choices: [], usage: { prompt_tokens: 7, completion_tokens: 2 } },
  ];

  it("yields text chunks then done with usage; asks for usage; ends at [DONE]", async () => {
    const f = fakeFetch(() => new Response(sse(...events, "[DONE]"), { status: 200 }));
    const chunks = await collect(make(f.fetch).stream(req));
    expect(
      chunks.filter((c) => c.kind === "text").map((c) => (c as { text: string }).text),
    ).toEqual(["Hel", "lo"]);
    const done = chunks.at(-1)!;
    expect(done).toMatchObject({
      kind: "done",
      finishReason: "stop",
      usage: { inputTokens: 7, outputTokens: 2 },
      provenance: { model: "gpt-test-2025" },
    });
    const body = JSON.parse(f.requests[0]!.body);
    expect(body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(f.requests[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it("copes with events split across network chunks and ignores bad JSON lines and comments", async () => {
    const raw = `: keep-alive\n\ndata: {oops\n\n${sse(...events, "[DONE]")}`;
    const parts = [raw.slice(0, 17), raw.slice(17, 61), raw.slice(61)];
    const f = fakeFetch(() => chunked(parts));
    const chunks = await collect(make(f.fetch).stream(req));
    expect(chunks.map((c) => c.kind)).toEqual(["text", "text", "done"]);
  });

  it("a stream cut off before it finishes is a protocol error, and an in-stream error leaks nothing", async () => {
    const cut = fakeFetch(() => new Response(sse(events[1]), { status: 200 }));
    await expect(collect(make(cut.fetch).stream(req))).rejects.toMatchObject({ kind: "protocol" });
    const bad = fakeFetch(
      () => new Response(sse({ error: { message: `leak ${KEY}` } }), { status: 200 }),
    );
    const e = (await collect(make(bad.fetch).stream(req)).catch((x: unknown) => x)) as ModelError;
    expect(e).toMatchObject({ kind: "http" });
    expect(e.message).not.toContain(KEY);
    expect(e.message).not.toContain("leak");
  });

  it("an HTTP error before the stream starts is mapped like generate, a missing key sends nothing", async () => {
    const f = fakeFetch(() => json({ error: { message: KEY } }, 401));
    const e = (await collect(make(f.fetch).stream(req)).catch((x: unknown) => x)) as ModelError;
    expect(e.kind).toBe("auth");
    expect(e.message).not.toContain(KEY);
    const none = fakeFetch(() => json({}));
    await expect(
      collect(make(none.fetch, { getKey: () => Promise.resolve(undefined) }).stream(req)),
    ).rejects.toMatchObject({ message: "No API key is set for Custom (cloud)" });
    expect(none.requests).toHaveLength(0);
  });
});

describe("embed", () => {
  const vectors = {
    model: "embed-test",
    data: [
      { index: 1, embedding: [0, 1] },
      { index: 0, embedding: [1, 0] },
    ],
  };

  it("posts model + input, orders vectors by index, reports dimensions", async () => {
    const f = fakeFetch(() => json(vectors));
    const p = make(f.fetch, { baseUrl: "http://localhost:1234/v1", embedModel: "embed-test" });
    const r = await p.embed({ privacy: "public", purpose: "t", input: ["a", "b"] });
    expect(r.embeddings).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(r.dimensions).toBe(2);
    expect(r.provenance).toMatchObject({
      provider: "custom",
      model: "embed-test",
      locality: "local",
    });
    expect(JSON.parse(f.requests[0]!.body)).toEqual({ model: "embed-test", input: ["a", "b"] });
    expect(f.requests[0]!.url).toBe("http://localhost:1234/v1/embeddings");
  });

  it("rejects empty input, a missing model, and unusable replies", async () => {
    const f = fakeFetch(() => json(vectors));
    const p = make(f.fetch, { embedModel: "embed-test" });
    await expect(p.embed({ privacy: "public", purpose: "t", input: [] })).rejects.toMatchObject({
      kind: "invalid",
    });
    await expect(p.embed({ privacy: "public", purpose: "t", input: [""] })).rejects.toMatchObject({
      kind: "invalid",
    });
    await expect(
      make(f.fetch).embed({ privacy: "public", purpose: "t", input: ["a"] }),
    ).rejects.toMatchObject({
      kind: "invalid",
    });
    expect(f.requests).toHaveLength(0);
    for (const body of [
      { data: [] },
      { data: [{ embedding: [1] }, { embedding: [1, 2] }] },
      { data: [{ embedding: ["x"] }, { embedding: [1] }] },
      { nodata: true },
    ]) {
      const bad = fakeFetch(() => json(body));
      await expect(
        make(bad.fetch, { embedModel: "embed-test" }).embed({
          privacy: "public",
          purpose: "t",
          input: ["a", "b"],
        }),
      ).rejects.toMatchObject({ kind: "protocol" });
    }
  });
});

describe("models and health never expose the key", () => {
  it("lists /models, keeps embed models apart, drops junk entries", async () => {
    const f = fakeFetch(() =>
      json({
        data: [{ id: "gpt-a" }, { id: "text-embedding-3-small" }, { id: 5 }, "x", { id: "" }],
      }),
    );
    expect(await make(f.fetch).models()).toEqual([
      { id: "gpt-a", kind: "chat", remote: false },
      { id: "text-embedding-3-small", kind: "embed", remote: false },
    ]);
    expect(f.requests[0]).toMatchObject({ method: "GET", url: `${CLOUD}/models` });
    await expect(make(fakeFetch(() => json({ nope: 1 })).fetch).models()).rejects.toMatchObject({
      kind: "protocol",
    });
  });

  it("reports each health state with fixed text", async () => {
    const ok = fakeFetch(() => json({ data: [] }));
    expect(await make(ok.fetch).health()).toMatchObject({
      available: true,
      detail: "Custom (cloud) is reachable",
    });
    expect(ok.requests[0]!.url).toBe(`${CLOUD}/models`);
    // A health check carries no user data.
    expect(ok.requests[0]!.body).toBe("");
    expect(await make(ok.fetch, { getKey: () => Promise.resolve(undefined) }).health()).toEqual({
      available: false,
      detail: "No API key is set for Custom (cloud)",
    });
    expect(await make(fakeFetch(() => json({ error: KEY }, 401)).fetch).health()).toEqual({
      available: false,
      detail: "Custom (cloud) rejected the API key",
    });
    const down = await make(() => Promise.reject(new TypeError(`boom ${KEY}`))).health();
    expect(down).toEqual({ available: false, detail: "Custom (cloud) is not reachable" });
    // A server without a model list (LM Studio builds, some proxies) still works.
    expect(await make(fakeFetch(() => json({}, 404)).fetch).health()).toMatchObject({
      available: true,
    });
  });
});

describe("presets and user endpoints", () => {
  it("ships exactly the vendors whose URL was read from public docs, each with its source", () => {
    expect(OPENAI_COMPATIBLE_PRESETS.map((p) => [p.id, p.baseUrl])).toEqual([
      ["openai", "https://api.openai.com/v1"],
      ["deepseek", "https://api.deepseek.com"],
      ["qwen", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"],
      ["moonshot", "https://api.moonshot.ai/v1"],
      ["lmstudio", "http://localhost:1234/v1"],
    ]);
    for (const p of OPENAI_COMPATIBLE_PRESETS) expect(p.docs).toMatch(/^https:\/\//);
  });

  it("every preset passes the URL rules; LM Studio is local and needs no key, the rest are cloud and need one", () => {
    for (const preset of OPENAI_COMPATIBLE_PRESETS) {
      const p = createEndpointProvider(
        { id: preset.id, label: preset.label, base_url: preset.baseUrl, preset: preset.id },
        {},
      );
      expect(p.locality, preset.id).toBe(preset.id === "lmstudio" ? "local" : "cloud");
      expect(p.keyPolicy, preset.id).toBe(preset.id === "lmstudio" ? "optional" : "required");
      expect(p.defaultModel, preset.id).toBe(preset.defaultModel);
    }
  });

  it("a user endpoint cannot claim to be local: the URL decides", () => {
    const evil = createEndpointProvider({
      id: "mine",
      label: "Mine",
      base_url: "https://localhost.evil.example/v1",
    });
    expect(evil.locality).toBe("cloud");
    expect(() =>
      createEndpointProvider({ id: "mine", label: "Mine", base_url: "http://10.0.0.5:1234/v1" }),
    ).toThrow(/must use https/);
  });

  it("explicit-only: an added server is never an automatic fallback", () => {
    expect(make(fakeFetch(() => json({})).fetch).explicitOnly).toBe(true);
  });
});
