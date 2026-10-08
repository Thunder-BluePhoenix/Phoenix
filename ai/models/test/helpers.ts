// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { FetchLike } from "../src";

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

export interface FakeFetch {
  fetch: FetchLike;
  requests: RecordedRequest[];
}

export type FakeHandler = (
  req: RecordedRequest,
  signal: AbortSignal | undefined,
) => Response | Promise<Response>;

/** A fetch that records every request and answers through `handler`. */
export function fakeFetch(handler: FakeHandler): FakeFetch {
  const requests: RecordedRequest[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>))
      headers[k.toLowerCase()] = v;
    const req: RecordedRequest = {
      url,
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : "",
    };
    requests.push(req);
    return handler(req, init?.signal ?? undefined);
  };
  return { fetch: fetchFn, requests };
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

/** A streaming body that emits `parts` as separate network chunks, then optionally stays open. */
export function chunked(
  parts: string[],
  opts: { hold?: boolean; signal?: AbortSignal } = {},
): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const part = parts[i++];
      if (part !== undefined) controller.enqueue(encoder.encode(part));
      else if (!opts.hold) controller.close();
      else return new Promise<void>(() => {});
    },
  });
  return new Response(stream, { status: 200 });
}

/** A body that never produces data until the request is aborted, then errors like undici does. */
export function hangingBody(signal: AbortSignal | undefined): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener(
        "abort",
        () => controller.error(new DOMException("aborted", "AbortError")),
        {
          once: true,
        },
      );
    },
  });
  return new Response(stream, { status: 200 });
}

/** Rejects when `signal` aborts, like fetch does. */
export function hangUntilAborted(signal: AbortSignal | undefined): Promise<Response> {
  const done = Promise.withResolvers<Response>();
  if (signal?.aborted) done.reject(new DOMException("aborted", "AbortError"));
  signal?.addEventListener("abort", () => done.reject(new DOMException("aborted", "AbortError")), {
    once: true,
  });
  return done.promise;
}

export const ollamaLines = (...objs: unknown[]): string =>
  objs.map((o) => JSON.stringify(o)).join("\n") + "\n";

export function sse(...events: { event: string; data: unknown }[]): string {
  return events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join("");
}

import {
  processedByLabel,
  type CallOptions,
  type CostTier,
  type EmbedRequest,
  type EmbedResult,
  type GenerateRequest,
  type GenerateResult,
  type Locality,
  type ModelProvider,
  type ProviderCapabilities,
  type ProviderHealth,
  type StreamChunk,
} from "../src";

export interface FakeProviderInit {
  id: string;
  locality: Locality;
  costTier?: CostTier;
  typicalLatencyMs?: number;
  capabilities?: ProviderCapabilities;
  health?: () => Promise<ProviderHealth>;
  generate?: (req: GenerateRequest, opts: CallOptions) => Promise<GenerateResult>;
  stream?: (req: GenerateRequest, opts: CallOptions) => AsyncIterable<StreamChunk>;
  embed?: (req: EmbedRequest, opts: CallOptions) => Promise<EmbedResult>;
}

export interface FakeProvider extends ModelProvider {
  calls: { generate: number; stream: number; embed: number; health: number };
}

export function provenanceOf(id: string, locality: Locality) {
  return { provider: id, model: "m", locality, processedBy: processedByLabel(id, "m", locality) };
}

/** A scriptable provider that counts every call made to it. */
export function fakeProvider(init: FakeProviderInit): FakeProvider {
  const calls = { generate: 0, stream: 0, embed: 0, health: 0 };
  const provenance = provenanceOf(init.id, init.locality);
  return {
    id: init.id,
    label: init.id,
    locality: init.locality,
    capabilities: init.capabilities ?? { generate: true, stream: true, embed: true },
    costTier: init.costTier ?? (init.locality === "local" ? 0 : 2),
    typicalLatencyMs: init.typicalLatencyMs ?? 1000,
    calls,
    models: () => Promise.resolve([]),
    health: () => {
      calls.health++;
      return init.health ? init.health() : Promise.resolve({ available: true, detail: "ok" });
    },
    generate: (req, opts = {}) => {
      calls.generate++;
      return init.generate
        ? init.generate(req, opts)
        : Promise.resolve({ text: `from ${init.id}`, provenance });
    },
    stream: (req, opts = {}) => {
      calls.stream++;
      if (init.stream) return init.stream(req, opts);
      return (async function* (): AsyncGenerator<StreamChunk> {
        yield { kind: "text", text: `from ${init.id}`, provenance };
        yield { kind: "done", provenance };
      })();
    },
    embed: (req, opts = {}) => {
      calls.embed++;
      return init.embed
        ? init.embed(req, opts)
        : Promise.resolve({ embeddings: [[1, 0]], dimensions: 2, provenance });
    },
  };
}

/** Models a typical fake Ollama reports on `/api/tags`: all local. */
export const LOCAL_TAGS = {
  models: [
    { name: "llama3.2:latest", size: 1 },
    { name: "nomic-embed-text:latest", size: 1 },
  ],
};

/** Wraps a handler so `GET /api/tags` is answered (as the adapter checks models are local). */
export function withTags(handler: FakeHandler, tags: unknown = LOCAL_TAGS): FakeHandler {
  return (req, signal) => (req.url.endsWith("/api/tags") ? json(tags) : handler(req, signal));
}
