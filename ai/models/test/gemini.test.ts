// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The Gemini adapter is verified ONLY against a fake that emits the documented wire format
// (https://ai.google.dev/api/generate-content). No key was used: nothing here proves it works
// against generativelanguage.googleapis.com.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_GEMINI_URL,
  GeminiProvider,
  ModelError,
  type FetchLike,
  type StreamChunk,
} from "../src";
import { chunked, fakeFetch, json } from "./helpers";

const KEY = ["canary", "gem", "0123456789", "abcdef", "CANARY"].join("-");
const req = {
  privacy: "public" as const,
  purpose: "test",
  messages: [
    { role: "system" as const, content: "be brief" },
    { role: "user" as const, content: "hello" },
    { role: "assistant" as const, content: "hi" },
    { role: "user" as const, content: "and now?" },
  ],
  model: "gemini-test",
};
/** `key` is passed explicitly (even as undefined) so a missing key can be tested. */
const make = (fetch: FetchLike, ...rest: [key?: string]) =>
  new GeminiProvider({ getKey: () => Promise.resolve(rest.length === 0 ? KEY : rest[0]), fetch });

const reply = {
  candidates: [
    {
      content: { role: "model", parts: [{ text: "Hello " }, { text: "there" }] },
      finishReason: "STOP",
    },
  ],
  usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 3, totalTokenCount: 14 },
  modelVersion: "gemini-test-001",
};

const sse = (...events: unknown[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");

async function collect(it: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

describe("GeminiProvider.generate", () => {
  it("posts to :generateContent with the key ONLY in x-goog-api-key, never in the URL", async () => {
    const f = fakeFetch(() => json(reply));
    const r = await make(f.fetch).generate({ ...req, maxTokens: 20, temperature: 0 });
    expect(r.text).toBe("Hello there");
    expect(r.finishReason).toBe("STOP");
    expect(r.usage).toEqual({ inputTokens: 11, outputTokens: 3 });
    expect(r.provenance).toMatchObject({
      provider: "gemini",
      model: "gemini-test-001",
      locality: "cloud",
    });
    const sent = f.requests[0]!;
    expect(sent.url).toBe(`${DEFAULT_GEMINI_URL}/models/gemini-test:generateContent`);
    expect(sent.url).not.toContain(KEY);
    expect(sent.url).not.toContain("key=");
    expect(sent.headers["x-goog-api-key"]).toBe(KEY);
    expect(sent.headers).not.toHaveProperty("authorization");
    expect(JSON.parse(sent.body)).toEqual({
      contents: [
        { role: "user", parts: [{ text: "hello" }] },
        { role: "model", parts: [{ text: "hi" }] },
        { role: "user", parts: [{ text: "and now?" }] },
      ],
      systemInstruction: { parts: [{ text: "be brief" }] },
      generationConfig: { maxOutputTokens: 20, temperature: 0 },
    });
  });

  it("asks for redirects to be errors", async () => {
    let redirect: RequestInit["redirect"];
    await make(async (_u, init) => {
      redirect = init?.redirect;
      return json(reply);
    }).generate(req);
    expect(redirect).toBe("error");
  });

  it("a missing key fails with the clear message and sends nothing", async () => {
    const f = fakeFetch(() => json(reply));
    await expect(make(f.fetch, undefined).generate(req)).rejects.toMatchObject({
      kind: "auth",
      message: "No API key is set for Google Gemini (cloud)",
    });
    expect(f.requests).toHaveLength(0);
  });

  it("maps HTTP errors without the key or the server's text", async () => {
    for (const [status, kind, retryable] of [
      [400, "http", false],
      [401, "auth", false],
      [403, "auth", false],
      [429, "http", true],
      [503, "http", true],
    ] as const) {
      const f = fakeFetch(() =>
        json({ error: { message: `echo ${KEY} and hello`, status: "X" } }, status),
      );
      const e = (await make(f.fetch)
        .generate(req)
        .catch((x: unknown) => x)) as ModelError;
      expect(e.kind, String(status)).toBe(kind);
      expect(e.retryable).toBe(retryable);
      expect(e.message).not.toContain(KEY);
      expect(e.message).not.toContain("echo");
    }
  });

  it("a blocked prompt (no candidates) and a malformed reply are protocol errors", async () => {
    for (const body of [{ promptFeedback: { blockReason: "SAFETY" } }, { candidates: [] }]) {
      const f = fakeFetch(() => json(body));
      await expect(make(f.fetch).generate(req)).rejects.toMatchObject({ kind: "protocol" });
    }
    await expect(
      make(fakeFetch(() => new Response("nope", { status: 200 })).fetch).generate(req),
    ).rejects.toMatchObject({ kind: "protocol" });
  });

  it("does not let a model name reach another endpoint or smuggle a path", async () => {
    const f = fakeFetch(() => json(reply));
    for (const model of ["a/b", "gemini:embedContent", "../x", "a b", "a?b=1", ""]) {
      await expect(make(f.fetch).generate({ ...req, model })).rejects.toMatchObject({
        kind: "invalid",
      });
    }
    expect(f.requests).toHaveLength(0);
  });

  it("without a model a cloud service asks the user to choose rather than guessing", async () => {
    const f = fakeFetch(() => json(reply));
    await expect(make(f.fetch).generate({ ...req, model: undefined })).rejects.toMatchObject({
      kind: "config",
    });
    expect(f.requests).toHaveLength(0);
  });
});

describe("GeminiProvider.stream", () => {
  const events = [
    { candidates: [{ content: { parts: [{ text: "Hel" }] } }], modelVersion: "gemini-test-001" },
    {
      candidates: [{ content: { parts: [{ text: "lo" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
    },
  ];

  it("uses :streamGenerateContent?alt=sse with the key in the header and yields text then done", async () => {
    const f = fakeFetch(() => new Response(sse(...events), { status: 200 }));
    const chunks = await collect(make(f.fetch).stream(req));
    expect(
      chunks.filter((c) => c.kind === "text").map((c) => (c as { text: string }).text),
    ).toEqual(["Hel", "lo"]);
    expect(chunks.at(-1)).toMatchObject({
      kind: "done",
      finishReason: "STOP",
      usage: { inputTokens: 5, outputTokens: 2 },
      provenance: { model: "gemini-test-001" },
    });
    expect(f.requests[0]!.url).toBe(
      `${DEFAULT_GEMINI_URL}/models/gemini-test:streamGenerateContent?alt=sse`,
    );
    expect(f.requests[0]!.url).not.toContain(KEY);
    expect(f.requests[0]!.headers["x-goog-api-key"]).toBe(KEY);
  });

  it("handles chunk boundaries inside an event and a stream cut off early", async () => {
    const raw = sse(...events);
    const f = fakeFetch(() => chunked([raw.slice(0, 20), raw.slice(20, 90), raw.slice(90)]));
    expect((await collect(make(f.fetch).stream(req))).map((c) => c.kind)).toEqual([
      "text",
      "text",
      "done",
    ]);
    const cut = fakeFetch(() => new Response(sse(events[0]), { status: 200 }));
    await expect(collect(make(cut.fetch).stream(req))).rejects.toMatchObject({ kind: "protocol" });
  });

  it("an in-stream error leaks neither the key nor the server's text; a missing key sends nothing", async () => {
    const bad = fakeFetch(
      () => new Response(sse({ error: { message: `leak ${KEY}` } }), { status: 200 }),
    );
    const e = (await collect(make(bad.fetch).stream(req)).catch((x: unknown) => x)) as ModelError;
    expect(e.kind).toBe("http");
    expect(e.message).not.toContain("leak");
    const none = fakeFetch(() => json({}));
    await expect(collect(make(none.fetch, undefined).stream(req))).rejects.toMatchObject({
      kind: "auth",
    });
    expect(none.requests).toHaveLength(0);
  });
});

describe("GeminiProvider.embed / models / health", () => {
  it("embed uses :batchEmbedContents and returns one vector per input, in order", async () => {
    const f = fakeFetch(() => json({ embeddings: [{ values: [1, 0] }, { values: [0, 1] }] }));
    const r = await make(f.fetch).embed({ privacy: "public", purpose: "t", input: ["a", "b"] });
    expect(r.embeddings).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(f.requests[0]!.url).toBe(
      `${DEFAULT_GEMINI_URL}/models/gemini-embedding-001:batchEmbedContents`,
    );
    expect(f.requests[0]!.headers["x-goog-api-key"]).toBe(KEY);
    expect(JSON.parse(f.requests[0]!.body)).toEqual({
      requests: [
        { model: "models/gemini-embedding-001", content: { parts: [{ text: "a" }] } },
        { model: "models/gemini-embedding-001", content: { parts: [{ text: "b" }] } },
      ],
    });
    const bad = fakeFetch(() => json({ embeddings: [{ values: [1] }] }));
    await expect(
      make(bad.fetch).embed({ privacy: "public", purpose: "t", input: ["a", "b"] }),
    ).rejects.toMatchObject({
      kind: "protocol",
    });
    await expect(
      make(f.fetch).embed({ privacy: "public", purpose: "t", input: [] }),
    ).rejects.toMatchObject({
      kind: "invalid",
    });
    // Cloud embedding is not offered to the router.
    expect(make(f.fetch).capabilities.embed).toBe(false);
  });

  it("models strips the models/ prefix and tells chat from embedding models", async () => {
    const f = fakeFetch(() =>
      json({
        models: [
          {
            name: "models/gemini-a",
            supportedGenerationMethods: ["generateContent", "countTokens"],
          },
          { name: "models/gemini-embedding-001", supportedGenerationMethods: ["embedContent"] },
          { name: "models/odd" },
          { nope: true },
        ],
      }),
    );
    expect(await make(f.fetch).models()).toEqual([
      { id: "gemini-a", kind: "chat" },
      { id: "gemini-embedding-001", kind: "embed" },
      { id: "odd", kind: "unknown" },
    ]);
    expect(f.requests[0]!.url).toBe(`${DEFAULT_GEMINI_URL}/models?pageSize=100`);
    expect(f.requests[0]!.headers["x-goog-api-key"]).toBe(KEY);
  });

  it("health reports fixed text and never the key", async () => {
    const ok = fakeFetch(() => json({ models: [] }));
    expect(await make(ok.fetch).health()).toMatchObject({ available: true });
    expect(ok.requests[0]!.body).toBe("");
    expect(await make(ok.fetch, undefined).health()).toEqual({
      available: false,
      detail: "No API key is set for Google Gemini (cloud)",
    });
    expect(await make(fakeFetch(() => json({}, 403)).fetch).health()).toEqual({
      available: false,
      detail: "Google Gemini (cloud) rejected the API key",
    });
    expect(JSON.stringify(await make(() => Promise.reject(new Error(KEY))).health())).not.toContain(
      KEY,
    );
  });

  it("rejects a non-https remote base URL and credentials in the URL", () => {
    const f = fakeFetch(() => json({}));
    expect(
      () =>
        new GeminiProvider({
          getKey: () => Promise.resolve(KEY),
          fetch: f.fetch,
          baseUrl: "http://generativelanguage.googleapis.com/v1beta",
        }),
    ).toThrow(/https/);
    expect(
      () =>
        new GeminiProvider({
          getKey: () => Promise.resolve(KEY),
          fetch: f.fetch,
          baseUrl: "https://u:p@generativelanguage.googleapis.com/v1beta",
        }),
    ).toThrow(/credentials/);
  });
});
