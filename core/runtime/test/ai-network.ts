// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { FetchLike } from "@phoenix/ai-models";

export interface RecordedRequest {
  url: string;
  method: string;
  body: string;
}

export interface FakeNetwork {
  fetch: FetchLike;
  requests: RecordedRequest[];
  /** Requests whose host is the Anthropic API. */
  cloud(): RecordedRequest[];
  /** Requests that carry user text (a chat call), as opposed to a health probe. */
  chats(): RecordedRequest[];
}

const OLLAMA = "http://127.0.0.1:11434";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * A fetch that records everything and plays both providers. Nothing leaves the process.
 * `ollama: "down"` makes the local model unreachable, to show data does not fall through to the
 * cloud on its own.
 */
export function fakeNetwork(
  options: {
    ollama?: "up" | "down";
    /** The text Ollama's chat answers with, given the request body. Default: a fixed sentence. */
    chat?: (body: string) => string;
    /** Turns each string given to /api/embed into a vector. Default: a 4-word bag-of-concepts. */
    embed?: (text: string) => number[];
  } = {},
): FakeNetwork {
  const requests: RecordedRequest[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    requests.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
    });
    if (url.startsWith("https://api.anthropic.com")) {
      if (url.includes("/v1/models")) return json({ data: [{ id: "claude-test" }] });
      return json({
        model: "claude-test",
        content: [{ type: "text", text: "cloud interpretation" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    }
    if (!url.startsWith(OLLAMA) || options.ollama === "down") {
      throw new TypeError("fetch failed");
    }
    if (url.endsWith("/api/version")) return json({ version: "0.15.5" });
    if (url.endsWith("/api/tags")) {
      return json({
        models: [
          { name: "llama3.2:latest", size: 1 },
          { name: "nomic-embed-text:latest", size: 1 },
        ],
      });
    }
    if (url.endsWith("/api/embed")) {
      const input = (
        JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { input: string[] }
      ).input;
      return json({ embeddings: input.map((t) => (options.embed ?? conceptVector)(t)) });
    }
    const content =
      options.chat?.(typeof init?.body === "string" ? init.body : "") ?? "local interpretation";
    return json({ message: { role: "assistant", content }, done: true });
  };
  return {
    fetch: fetchFn,
    requests,
    cloud: () => requests.filter((r) => r.url.startsWith("https://api.anthropic.com")),
    chats: () =>
      requests.filter((r) => r.url.endsWith("/api/chat") || r.url.endsWith("/v1/messages")),
  };
}

/** Words in one group mean the same thing, so a reworded question lands next to its memory. */
const CONCEPTS: Record<string, number> = {
  automobile: 0,
  car: 0,
  vehicle: 0,
  quick: 1,
  fast: 1,
  rapid: 1,
  mutex: 2,
  lock: 2,
  deadlock: 2,
  datastore: 3,
  database: 3,
  storage: 3,
};

/** A deterministic 8-dimensional embedding for tests: one slot per concept, the rest by length. */
export function conceptVector(text: string): number[] {
  const v = Array.from({ length: 8 }, (): number => 0);
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const at = CONCEPTS[w] ?? 4 + (w.length % 4);
    v[at] = (v[at] ?? 0) + 1;
  }
  return v;
}
