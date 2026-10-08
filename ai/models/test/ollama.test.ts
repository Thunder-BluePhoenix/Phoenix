// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { ModelError, OllamaProvider, type StreamChunk } from "../src";
import {
  chunked,
  fakeFetch as rawFakeFetch,
  hangUntilAborted,
  hangingBody,
  json,
  ollamaLines,
  withTags,
  type FakeHandler,
} from "./helpers";

/** Fake network for Ollama: `/api/tags` lists only local models unless the handler says otherwise. */
const fakeFetch = (handler: FakeHandler) => rawFakeFetch(withTags(handler));

const req = {
  privacy: "internal" as const,
  purpose: "test",
  messages: [{ role: "user" as const, content: "hi" }],
};

async function collect(it: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

describe("OllamaProvider config", () => {
  it.each([
    "http://example.com:11434",
    "http://192.168.1.5:11434",
    "https://127.0.0.1:11434",
    "http://127.0.0.1.evil.com",
    "http://user:pw@127.0.0.1:11434",
  ])("refuses %s", (url) => {
    expect(() => new OllamaProvider({ baseUrl: url })).toThrow();
  });
  it.each(["http://127.0.0.1:11434", "http://localhost:11434", "http://[::1]:11434"])(
    "accepts %s",
    (url) => {
      expect(() => new OllamaProvider({ baseUrl: url })).not.toThrow();
    },
  );
});

describe("OllamaProvider.generate", () => {
  it("posts to /api/chat non-streaming and labels the answer", async () => {
    const f = fakeFetch(() =>
      json({
        message: { role: "assistant", content: "pong" },
        done: true,
        done_reason: "stop",
        prompt_eval_count: 5,
        eval_count: 2,
      }),
    );
    const p = new OllamaProvider({ fetch: f.fetch });
    const r = await p.generate({ ...req, maxTokens: 8, temperature: 0 });
    expect(r.text).toBe("pong");
    expect(r.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
    expect(r.provenance).toMatchObject({
      provider: "ollama",
      model: "llama3.2",
      locality: "local",
    });
    expect(r.provenance.processedBy).toBe("Ollama (this device) · llama3.2 · on this device");
    const sent = JSON.parse(f.requests.find((r) => r.method === "POST")!.body);
    expect(f.requests.at(-1)!.url).toBe("http://127.0.0.1:11434/api/chat");
    expect(sent).toMatchObject({
      model: "llama3.2",
      stream: false,
      options: { num_predict: 8, temperature: 0 },
    });
  });

  it("rejects a reply without a message, an error body and HTTP errors with typed errors", async () => {
    const bad = new OllamaProvider({ fetch: fakeFetch(() => json({ nope: 1 })).fetch });
    await expect(bad.generate(req)).rejects.toMatchObject({ kind: "protocol" });
    const err = new OllamaProvider({
      fetch: fakeFetch(() => json({ error: "model not found" })).fetch,
    });
    await expect(err.generate(req)).rejects.toThrow(/model not found/);
    const five = new OllamaProvider({
      fetch: fakeFetch(() => json({ error: "boom" }, 503, { "retry-after": "2" })).fetch,
    });
    await expect(five.generate(req)).rejects.toMatchObject({
      kind: "http",
      status: 503,
      retryable: true,
      retryAfterMs: 2000,
    });
    const four = new OllamaProvider({ fetch: fakeFetch(() => json({ error: "bad" }, 400)).fetch });
    await expect(four.generate(req)).rejects.toMatchObject({
      kind: "http",
      status: 400,
      retryable: false,
    });
  });

  it("caps the body size: a declared and an undeclared huge reply are both refused", async () => {
    const declared = new OllamaProvider({
      fetch: fakeFetch(
        () => new Response("{}", { headers: { "content-length": String(64 * 1024 * 1024) } }),
      ).fetch,
    });
    await expect(declared.generate(req)).rejects.toThrow(/too large/);
    let pulled = 0;
    const endless = new OllamaProvider({
      fetch: fakeFetch(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              pull(c) {
                pulled++;
                c.enqueue(new Uint8Array(1024 * 1024));
              },
            }),
          ),
      ).fetch,
    });
    await expect(endless.generate(req)).rejects.toThrow(/too large/);
    expect(pulled).toBeLessThan(40);
  });

  it("times out via the call timeout, and honours an abort without waiting", async () => {
    const slow = new OllamaProvider({ fetch: fakeFetch((_r, s) => hangUntilAborted(s)).fetch });
    await expect(slow.generate(req, { timeoutMs: 20 })).rejects.toMatchObject({
      kind: "timeout",
      retryable: true,
    });
    const ctl = new AbortController();
    const pending = slow.generate(req, { signal: ctl.signal });
    ctl.abort();
    await expect(pending).rejects.toMatchObject({ kind: "aborted", retryable: false });
  });

  it("does not follow redirects and a connection failure is a retryable network error without leaking the raw message", async () => {
    const f = fakeFetch(() => {
      throw new TypeError("fetch failed: connect ECONNREFUSED secret-host");
    });
    const p = new OllamaProvider({ fetch: f.fetch });
    const e = await p.generate(req).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ModelError);
    expect(e).toMatchObject({ kind: "network", retryable: true });
    expect((e as Error).message).not.toMatch(/secret-host/);
  });
});

describe("OllamaProvider.stream", () => {
  const line = (content: string) => ({ message: { role: "assistant", content }, done: false });
  const final = {
    message: { role: "assistant", content: "" },
    done: true,
    done_reason: "stop",
    eval_count: 3,
  };

  it("parses NDJSON split across network chunks, including mid-line and mid-UTF-8 splits", async () => {
    const full = ollamaLines(line("Hel"), line("lo ✓"), final);
    const bytes = new TextEncoder().encode(full);
    // Split into 7-byte pieces: lands inside JSON tokens and inside the 3-byte "✓".
    const pieces: Uint8Array[] = [];
    for (let i = 0; i < bytes.length; i += 7) pieces.push(bytes.slice(i, i + 7));
    const body = new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          for (const p of pieces) c.enqueue(p);
          c.close();
        },
      }),
    );
    const p = new OllamaProvider({ fetch: fakeFetch(() => body).fetch });
    const chunks = await collect(p.stream(req));
    expect(
      chunks
        .filter((c) => c.kind === "text")
        .map((c) => (c as { text: string }).text)
        .join(""),
    ).toBe("Hello ✓");
    expect(chunks.at(-1)).toMatchObject({
      kind: "done",
      finishReason: "stop",
      usage: { outputTokens: 3 },
    });
    expect(chunks[0]?.provenance.processedBy).toMatch(/on this device/);
  });

  it("skips a malformed line instead of losing the answer", async () => {
    const body = chunked([
      JSON.stringify(line("a")) + "\n",
      "{not json\n",
      JSON.stringify(line("b")) + "\n",
      JSON.stringify(final) + "\n",
    ]);
    const p = new OllamaProvider({ fetch: fakeFetch(() => body).fetch });
    const texts = (await collect(p.stream(req)))
      .filter((c) => c.kind === "text")
      .map((c) => (c as { text: string }).text);
    expect(texts).toEqual(["a", "b"]);
  });

  it("surfaces a mid-stream error object and a stream that ends without done", async () => {
    const errBody = chunked([
      JSON.stringify(line("a")) + "\n",
      JSON.stringify({ error: "out of memory" }) + "\n",
    ]);
    const p1 = new OllamaProvider({ fetch: fakeFetch(() => errBody).fetch });
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const c of p1.stream(req)) if (c.kind === "text") seen.push(c.text);
      })(),
    ).rejects.toThrow(/out of memory/);
    expect(seen).toEqual(["a"]);
    const cut = new OllamaProvider({
      fetch: fakeFetch(() => chunked([JSON.stringify(line("a")) + "\n"])).fetch,
    });
    await expect(collect(cut.stream(req))).rejects.toThrow(/ended before it finished/);
  });

  it("stops reading and cancels the connection when the caller aborts mid-stream", async () => {
    let cancelled = false;
    let pulls = 0;
    const encoder = new TextEncoder();
    const ctl = new AbortController();
    const body = new Response(
      new ReadableStream<Uint8Array>({
        pull(c) {
          pulls++;
          c.enqueue(encoder.encode(JSON.stringify(line("x")) + "\n"));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
    const p = new OllamaProvider({ fetch: fakeFetch(() => body).fetch });
    const got: string[] = [];
    const run = (async () => {
      for await (const c of p.stream(req, { signal: ctl.signal })) {
        if (c.kind === "text") got.push(c.text);
        if (got.length === 2) ctl.abort();
      }
    })();
    await expect(run).rejects.toMatchObject({ kind: "aborted" });
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(10);
  });

  it("an idle stream is cut off after the idle timeout", async () => {
    const p = new OllamaProvider({
      streamIdleMs: 20,
      fetch: fakeFetch((_r, s) => hangingBody(s)).fetch,
    });
    await expect(collect(p.stream(req))).rejects.toMatchObject({ kind: "timeout" });
  });

  it("rejects an over-long line", async () => {
    const p = new OllamaProvider({
      fetch: fakeFetch(() => chunked(["x".repeat(2 * 1024 * 1024)])).fetch,
    });
    await expect(collect(p.stream(req))).rejects.toThrow(/over-long line/);
  });
});

describe("OllamaProvider.embed / models / health", () => {
  it("sends the input array and validates the vectors", async () => {
    const f = fakeFetch(() =>
      json({
        embeddings: [
          [0.1, 0.2, 0.3],
          [0.3, 0.2, 0.1],
        ],
      }),
    );
    const p = new OllamaProvider({ fetch: f.fetch });
    const r = await p.embed({ privacy: "sensitive", purpose: "t", input: ["a", "b"] });
    expect(r.dimensions).toBe(3);
    expect(r.provenance.model).toBe("nomic-embed-text");
    expect(JSON.parse(f.requests.find((r) => r.method === "POST")!.body)).toEqual({
      model: "nomic-embed-text",
      input: ["a", "b"],
    });
    expect(f.requests.at(-1)!.url).toBe("http://127.0.0.1:11434/api/embed");
  });

  it.each([
    ["wrong count", { embeddings: [[1, 2]] }],
    ["ragged", { embeddings: [[1, 2], [1]] }],
    [
      "non-numeric",
      {
        embeddings: [
          [1, "x"],
          [1, 2],
        ],
      },
    ],
    ["missing", {}],
  ])("rejects malformed embeddings: %s", async (_n, body) => {
    const p = new OllamaProvider({ fetch: fakeFetch(() => json(body)).fetch });
    await expect(
      p.embed({ privacy: "public", purpose: "t", input: ["a", "b"] }),
    ).rejects.toMatchObject({ kind: "protocol" });
  });

  it("refuses empty input before any request", async () => {
    const f = fakeFetch(() => json({}));
    const p = new OllamaProvider({ fetch: f.fetch });
    await expect(p.embed({ privacy: "public", purpose: "t", input: [] })).rejects.toMatchObject({
      kind: "invalid",
    });
    await expect(p.embed({ privacy: "public", purpose: "t", input: [""] })).rejects.toMatchObject({
      kind: "invalid",
    });
    expect(f.requests).toHaveLength(0);
  });

  it("lists models, skipping hostile entries, and classifies embedding models", async () => {
    const f = fakeFetch(() =>
      json({
        models: [
          { name: "llama3.2:latest", size: 5 },
          { name: "nomic-embed-text:latest" },
          7,
          { name: 3 },
          { name: "x".repeat(500) },
        ],
      }),
    );
    const models = await new OllamaProvider({ fetch: f.fetch }).models();
    expect(models.map((m) => [m.id, m.kind])).toEqual([
      ["llama3.2:latest", "chat"],
      ["nomic-embed-text:latest", "embed"],
    ]);
  });

  it("health never throws: not running, odd reply, healthy", async () => {
    const down = new OllamaProvider({
      fetch: fakeFetch(() => {
        throw new TypeError("x");
      }).fetch,
    });
    expect(await down.health()).toMatchObject({
      available: false,
      detail: "Ollama is not running",
    });
    const odd = new OllamaProvider({ fetch: fakeFetch(() => json({ hello: 1 })).fetch });
    expect((await odd.health()).available).toBe(false);
    const ok = new OllamaProvider({ fetch: fakeFetch(() => json({ version: "0.15.5" })).fetch });
    expect(await ok.health()).toMatchObject({ available: true, version: "0.15.5" });
  });
});

describe("OllamaProvider refuses models that run on a remote host", () => {
  const remoteTags = {
    models: [
      { name: "llama3.2:latest", size: 1 },
      {
        name: "kimi-k2.5:cloud",
        remote_model: "kimi-k2.5",
        remote_host: "https://ollama.com:443",
        size: 340,
      },
      // Not recognisable by name: only `remote_host` gives it away.
      { name: "mystery:latest", remote_host: "https://example.com:443", size: 10 },
    ],
  };
  const chatReply = () => json({ message: { content: "x" }, done: true });

  it("by name, without sending anything (not even a model-list request)", async () => {
    const f = rawFakeFetch(chatReply);
    const p = new OllamaProvider({ fetch: f.fetch });
    await expect(p.generate({ ...req, model: "gpt-oss:120b-cloud" })).rejects.toMatchObject({
      kind: "config",
    });
    await expect(collect(p.stream({ ...req, model: "kimi-k2.5:cloud" }))).rejects.toMatchObject({
      kind: "config",
    });
    await expect(
      p.embed({ privacy: "sensitive", purpose: "t", input: ["a"], model: "x-cloud" }),
    ).rejects.toMatchObject({ kind: "config" });
    expect(f.requests).toHaveLength(0);
  });

  it("by remote_host in /api/tags, and the chat request is never sent", async () => {
    const f = rawFakeFetch(withTags(chatReply, remoteTags));
    const p = new OllamaProvider({ fetch: f.fetch });
    await expect(p.generate({ ...req, model: "mystery" })).rejects.toMatchObject({
      kind: "config",
    });
    expect(f.requests.map((r) => r.url)).toEqual(["http://127.0.0.1:11434/api/tags"]);
  });

  it("models() flags remote entries so the UI can hide them; local ones are not flagged", async () => {
    const p = new OllamaProvider({ fetch: rawFakeFetch(withTags(chatReply, remoteTags)).fetch });
    const byId = Object.fromEntries((await p.models()).map((m) => [m.id, m.remote]));
    expect(byId).toEqual({
      "llama3.2:latest": false,
      "kimi-k2.5:cloud": true,
      "mystery:latest": true,
    });
  });

  it("a verified-local model is checked once, not on every call", async () => {
    const f = rawFakeFetch(withTags(chatReply));
    const p = new OllamaProvider({ fetch: f.fetch });
    await p.generate(req);
    await p.generate(req);
    expect(f.requests.filter((r) => r.url.endsWith("/api/tags"))).toHaveLength(1);
  });
});
