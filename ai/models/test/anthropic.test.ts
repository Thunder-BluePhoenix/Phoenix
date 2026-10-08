// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The Anthropic adapter is verified ONLY against a fake that emits the documented wire format.
// No API key was available, so nothing here proves it works against api.anthropic.com.
import { describe, expect, it } from "vitest";
import { AnthropicProvider, ModelError, type FetchLike, type StreamChunk } from "../src";
import { chunked, fakeFetch, json, sse } from "./helpers";

export const SEEDED_KEY = "sk-ant-api03-SEEDEDKEY0123456789abcdefSEEDEDKEY";
const req = {
  privacy: "public" as const,
  purpose: "test",
  messages: [
    { role: "system" as const, content: "be brief" },
    { role: "user" as const, content: "hello" },
  ],
};
/** `key` is passed explicitly (even as undefined) so a missing key can be tested. */
const make = (fetch: FetchLike, ...rest: [key?: string]) =>
  new AnthropicProvider({
    getKey: () => Promise.resolve(rest.length === 0 ? SEEDED_KEY : rest[0]),
    fetch,
  });

const message = {
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-test-1",
  content: [
    { type: "text", text: "Hi " },
    { type: "tool_use", id: "x" },
    { type: "text", text: "there" },
  ],
  stop_reason: "end_turn",
  usage: { input_tokens: 9, output_tokens: 4 },
};

async function collect(it: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

describe("AnthropicProvider.generate", () => {
  it("sends the documented request and labels the answer as cloud", async () => {
    const f = fakeFetch(() => json(message));
    const r = await make(f.fetch).generate({ ...req, maxTokens: 50, temperature: 0.2 });
    const sent = f.requests[0]!;
    expect(sent.url).toBe("https://api.anthropic.com/v1/messages");
    expect(sent.method).toBe("POST");
    expect(sent.headers["x-api-key"]).toBe(SEEDED_KEY);
    expect(sent.headers["anthropic-version"]).toBe("2023-06-01");
    expect(JSON.parse(sent.body)).toEqual({
      model: "claude-haiku-4-5",
      max_tokens: 50,
      temperature: 0.2,
      system: "be brief",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    });
    expect(r.text).toBe("Hi there");
    expect(r.usage).toEqual({ inputTokens: 9, outputTokens: 4 });
    expect(r.provenance).toMatchObject({
      provider: "anthropic",
      model: "claude-test-1",
      locality: "cloud",
    });
    expect(r.provenance.processedBy).toBe("Anthropic (cloud) · claude-test-1 · cloud");
  });

  it("always sends max_tokens (the API requires it)", async () => {
    const f = fakeFetch(() => json(message));
    await make(f.fetch).generate(req);
    expect(JSON.parse(f.requests[0]!.body).max_tokens).toBeGreaterThan(0);
  });

  it("without a key makes no request and fails as an auth error", async () => {
    const f = fakeFetch(() => json(message));
    for (const key of [undefined, "", "   "]) {
      await expect(make(f.fetch, key).generate(req)).rejects.toMatchObject({ kind: "auth" });
    }
    expect(f.requests).toHaveLength(0);
  });

  it("a key getter that throws becomes a generic auth error", async () => {
    const f = fakeFetch(() => json(message));
    const p = new AnthropicProvider({
      getKey: () => Promise.reject(new Error("keychain: " + SEEDED_KEY)),
      fetch: f.fetch,
    });
    const e = await p.generate(req).catch((x: unknown) => x);
    expect(e).toMatchObject({ kind: "auth" });
    expect((e as Error).message).not.toContain(SEEDED_KEY);
  });

  it("401 is a non-retryable auth error, 429 and 529 are retryable, 400 is not", async () => {
    const run = (status: number, headers: Record<string, string> = {}) =>
      make(
        fakeFetch(() =>
          json({ type: "error", error: { type: "x", message: "m" } }, status, headers),
        ).fetch,
      )
        .generate(req)
        .catch((e: unknown) => e as ModelError);
    expect(await run(401)).toMatchObject({ kind: "auth", retryable: false, status: 401 });
    expect(await run(429, { "retry-after": "7" })).toMatchObject({
      kind: "http",
      retryable: true,
      retryAfterMs: 7000,
    });
    expect(await run(529)).toMatchObject({ retryable: true });
    expect(await run(500)).toMatchObject({ retryable: true });
    expect(await run(400)).toMatchObject({ retryable: false });
  });

  it("an error body that echoes the key never reaches the error message", async () => {
    const f = fakeFetch(() =>
      json({ error: { type: "invalid_request_error", message: `bad key ${SEEDED_KEY}` } }, 400),
    );
    const e = await make(f.fetch)
      .generate(req)
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ModelError);
    const message = (e as ModelError).message;
    expect(message).toContain("HTTP 400");
    expect(message).not.toContain(SEEDED_KEY);
    expect(JSON.stringify(e)).not.toContain(SEEDED_KEY);
  });

  it("rejects unreadable replies and refuses requests with no user message", async () => {
    await expect(
      make(fakeFetch(() => json({ content: "text" })).fetch).generate(req),
    ).rejects.toMatchObject({ kind: "protocol" });
    const f = fakeFetch(() => json(message));
    await expect(
      make(f.fetch).generate({ ...req, messages: [req.messages[0]!] }),
    ).rejects.toMatchObject({ kind: "invalid" });
    expect(f.requests).toHaveLength(0);
  });

  it("refuses plain-http and non-loopback base URLs (the key must not travel in clear)", () => {
    const mk = (baseUrl: string) =>
      new AnthropicProvider({ baseUrl, getKey: () => Promise.resolve("k") });
    expect(() => mk("http://api.anthropic.com")).toThrow();
    expect(() => mk("http://192.168.1.2:9")).toThrow();
    expect(() => mk("http://127.0.0.1:9")).not.toThrow();
    expect(() => mk("https://example.test")).not.toThrow();
  });
});

describe("AnthropicProvider.embed", () => {
  it("is unsupported: typed error, no request", async () => {
    const f = fakeFetch(() => json({}));
    const p = make(f.fetch);
    expect(p.capabilities.embed).toBe(false);
    await expect(p.embed({ privacy: "public", purpose: "t", input: ["a"] })).rejects.toMatchObject({
      name: "ModelError",
      kind: "unsupported",
    });
    expect(f.requests).toHaveLength(0);
  });
});

describe("AnthropicProvider.stream (documented SSE format, mock only)", () => {
  const start = {
    event: "message_start",
    data: {
      type: "message_start",
      message: { id: "m", model: "claude-test-1", usage: { input_tokens: 11, output_tokens: 1 } },
    },
  };
  const delta = (text: string) => ({
    event: "content_block_delta",
    data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
  });
  const end = [
    { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
    {
      event: "message_delta",
      data: {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 6 },
      },
    },
    { event: "message_stop", data: { type: "message_stop" } },
  ];

  it("assembles text, usage and finish reason; sends stream:true", async () => {
    const f = fakeFetch(() =>
      chunked([
        sse(start, { event: "ping", data: { type: "ping" } }, delta("Hel"), delta("lo"), ...end),
      ]),
    );
    const chunks = await collect(make(f.fetch).stream(req));
    expect(JSON.parse(f.requests[0]!.body).stream).toBe(true);
    expect(
      chunks
        .filter((c) => c.kind === "text")
        .map((c) => (c as { text: string }).text)
        .join(""),
    ).toBe("Hello");
    expect(chunks.at(-1)).toMatchObject({
      kind: "done",
      finishReason: "end_turn",
      usage: { inputTokens: 11, outputTokens: 6 },
    });
    expect(chunks[0]?.provenance).toMatchObject({ model: "claude-test-1", locality: "cloud" });
  });

  it("handles events split across network chunks (mid-line and between event/data)", async () => {
    const whole = sse(start, delta("Hel"), delta("lo"), ...end);
    const parts: string[] = [];
    for (let i = 0; i < whole.length; i += 5) parts.push(whole.slice(i, i + 5));
    const chunks = await collect(make(fakeFetch(() => chunked(parts)).fetch).stream(req));
    expect(chunks.filter((c) => c.kind === "text")).toHaveLength(2);
    expect(chunks.at(-1)?.kind).toBe("done");
  });

  it("skips a data line that is not JSON and non-text deltas", async () => {
    const raw =
      `event: content_block_delta\ndata: {broken\n\n` +
      sse(
        start,
        {
          event: "content_block_delta",
          data: {
            type: "content_block_delta",
            delta: { type: "input_json_delta", partial_json: "{}" },
          },
        },
        delta("ok"),
        ...end,
      );
    const chunks = await collect(make(fakeFetch(() => chunked([raw])).fetch).stream(req));
    expect(
      chunks.filter((c) => c.kind === "text").map((c) => (c as { text: string }).text),
    ).toEqual(["ok"]);
  });

  it("an error event mid-stream throws after the text already received; overloaded is retryable", async () => {
    const body = sse(start, delta("partial"), {
      event: "error",
      data: {
        type: "error",
        error: { type: "overloaded_error", message: `Overloaded ${SEEDED_KEY}` },
      },
    });
    const seen: string[] = [];
    const e = await (async () => {
      for await (const c of make(fakeFetch(() => chunked([body])).fetch).stream(req))
        if (c.kind === "text") seen.push(c.text);
    })().catch((x: unknown) => x);
    expect(seen).toEqual(["partial"]);
    expect(e).toMatchObject({ kind: "http", retryable: true });
    expect((e as ModelError).message).toMatch(/overloaded_error/);
    expect((e as ModelError).message).not.toContain(SEEDED_KEY);
  });

  it("a stream that ends without message_stop is an error", async () => {
    const chunks = collect(
      make(fakeFetch(() => chunked([sse(start, delta("a"))])).fetch).stream(req),
    );
    await expect(chunks).rejects.toThrow(/ended before it finished/);
  });

  it("abort mid-stream stops reading and cancels the body", async () => {
    let cancelled = false;
    let pulls = 0;
    const enc = new TextEncoder();
    const ctl = new AbortController();
    const body = new Response(
      new ReadableStream<Uint8Array>({
        pull(c) {
          pulls++;
          c.enqueue(enc.encode(pulls === 1 ? sse(start) : sse(delta("x"))));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
    const got: string[] = [];
    const run = (async () => {
      for await (const c of make(fakeFetch(() => body).fetch).stream(req, { signal: ctl.signal })) {
        if (c.kind === "text") got.push(c.text);
        if (got.length === 2) ctl.abort();
      }
    })();
    await expect(run).rejects.toMatchObject({ kind: "aborted" });
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(10);
  });
});

describe("AnthropicProvider.health / models never expose the key", () => {
  it("reports each state with fixed text", async () => {
    expect(await make(fakeFetch(() => json({ data: [] })).fetch, undefined).health()).toEqual({
      available: false,
      detail: "No Anthropic API key is set",
    });
    const rejected = await make(
      fakeFetch(() => json({ error: { message: SEEDED_KEY } }, 401)).fetch,
    ).health();
    expect(rejected).toEqual({ available: false, detail: "Anthropic rejected the API key" });
    const down = await make(
      fakeFetch(() => {
        throw new TypeError(SEEDED_KEY);
      }).fetch,
    ).health();
    expect(down).toEqual({ available: false, detail: "Anthropic API is not reachable" });
    const ok = await make(fakeFetch(() => json({ data: [{ id: "claude-x" }] })).fetch).health();
    expect(ok.available).toBe(true);
    for (const h of [rejected, down, ok]) expect(JSON.stringify(h)).not.toContain(SEEDED_KEY);
  });

  it("health sends no user data and models() lists ids", async () => {
    const f = fakeFetch(() => json({ data: [{ id: "claude-x" }, { id: 5 }, "bad"] }));
    const p = make(f.fetch);
    await p.health();
    expect(f.requests[0]).toMatchObject({ method: "GET", body: "" });
    expect(await p.models()).toEqual([{ id: "claude-x", kind: "chat" }]);
  });
});
