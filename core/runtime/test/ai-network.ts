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
export function fakeNetwork(options: { ollama?: "up" | "down" } = {}): FakeNetwork {
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
    if (url.endsWith("/api/tags")) return json({ models: [{ name: "llama3.2:latest", size: 1 }] });
    return json({ message: { role: "assistant", content: "local interpretation" }, done: true });
  };
  return {
    fetch: fetchFn,
    requests,
    cloud: () => requests.filter((r) => r.url.startsWith("https://api.anthropic.com")),
    chats: () =>
      requests.filter((r) => r.url.endsWith("/api/chat") || r.url.endsWith("/v1/messages")),
  };
}
