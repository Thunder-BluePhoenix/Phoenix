// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Cloud adapter: the Google Gemini API (Generative Language API, v1beta). Prompts leave this
// device, so nothing here is reached except through AiService's gate. The API key is sent in the
// `x-goog-api-key` header and NEVER in the query string (a URL ends up in logs and proxies).
//
// Endpoints, from Google's public documentation:
//   base URL  https://generativelanguage.googleapis.com/v1beta
//   POST {base}/models/{model}:generateContent                (https://ai.google.dev/api/generate-content)
//   POST {base}/models/{model}:streamGenerateContent?alt=sse  (same page, "Method: models.streamGenerateContent")
//   POST {base}/models/{model}:batchEmbedContents             (https://ai.google.dev/api/embeddings)
//   GET  {base}/models                                        (https://ai.google.dev/api/models)
// The key header is documented at https://ai.google.dev/gemini-api/docs/embeddings (REST example).
import { ModelError } from "./errors";
import {
  count,
  createScope,
  isRecord,
  parseJsonObject,
  readLines,
  readSse,
  send,
  str,
} from "./http";
import {
  assertModelId,
  KeyedProvider,
  readVectors,
  usageOf,
  type KeyedProviderConfig,
} from "./keyed-provider";
import type {
  CallOptions,
  ChatMessage,
  EmbedRequest,
  EmbedResult,
  GenerateRequest,
  GenerateResult,
  ModelInfo,
  ProviderCapabilities,
  StreamChunk,
  Usage,
} from "./types";

export const GEMINI_ID = "gemini";
export const GEMINI_LABEL = "Google Gemini (cloud)";
/** Documented in https://ai.google.dev/gemini-api/docs/embeddings (text-only model). */
export const DEFAULT_GEMINI_EMBED_MODEL = "gemini-embedding-001";
export const DEFAULT_GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiOptions extends Partial<Pick<KeyedProviderConfig, "baseUrl">> {
  getKey: KeyedProviderConfig["getKey"];
  fetch?: KeyedProviderConfig["fetch"];
  /** Used when a request names no model. Absent = the first chat model Google lists. */
  model?: string;
  generateTimeoutMs?: number;
  streamIdleMs?: number;
  streamTotalMs?: number;
  healthTimeoutMs?: number;
}

/** Gemini calls the assistant role "model". System text goes in `systemInstruction`. */
function contentsOf(
  messages: ChatMessage[],
): { role: "user" | "model"; parts: { text: string }[] }[] {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
}

export class GeminiProvider extends KeyedProvider {
  // embed() exists, but the router never sends memory text to a cloud embedder, so it is not offered.
  readonly capabilities: ProviderCapabilities = { generate: true, stream: true, embed: false };
  readonly costTier = 2 as const;
  readonly typicalLatencyMs = 2_500;
  readonly defaultModel: string | undefined;

  constructor(options: GeminiOptions) {
    super({
      id: GEMINI_ID,
      label: GEMINI_LABEL,
      baseUrl: options.baseUrl ?? DEFAULT_GEMINI_URL,
      getKey: options.getKey,
      fetch: options.fetch,
      generateTimeoutMs: options.generateTimeoutMs,
      streamIdleMs: options.streamIdleMs,
      streamTotalMs: options.streamTotalMs,
      healthTimeoutMs: options.healthTimeoutMs,
    });
    this.defaultModel = options.model;
  }

  protected modelsPath(limit?: number): string {
    return limit === undefined ? "/models?pageSize=100" : `/models?pageSize=${limit}`;
  }

  protected authHeaders(key: string | undefined): Record<string, string> {
    return key === undefined ? {} : { "x-goog-api-key": key };
  }

  protected parseModels(body: Record<string, unknown>): ModelInfo[] {
    if (!Array.isArray(body.models)) {
      throw new ModelError("protocol", this.id, "Gemini sent an unexpected model list");
    }
    const out: ModelInfo[] = [];
    for (const entry of body.models as unknown[]) {
      if (!isRecord(entry)) continue;
      // Names look like "models/gemini-x"; requests take the part after "models/".
      const id = str(entry.name)?.replace(/^models\//, "");
      if (id === undefined || id.length === 0 || id.length > 200) continue;
      const methods = Array.isArray(entry.supportedGenerationMethods)
        ? (entry.supportedGenerationMethods as unknown[])
        : [];
      const kind = methods.includes("generateContent")
        ? "chat"
        : methods.includes("embedContent")
          ? "embed"
          : "unknown";
      out.push({ id, kind });
    }
    return out;
  }

  private async model(req: GenerateRequest): Promise<string> {
    return assertModelId(
      req.model ?? this.defaultModel ?? (await this.firstChatModel()),
      this.id,
      "path",
    );
  }

  private requestBody(req: GenerateRequest): string {
    const contents = contentsOf(req.messages);
    if (contents.length === 0) {
      throw new ModelError("invalid", this.id, "A request needs at least one user message");
    }
    const system = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const generationConfig: Record<string, number> = {};
    if (req.maxTokens !== undefined) generationConfig.maxOutputTokens = req.maxTokens;
    if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
    return JSON.stringify({
      contents,
      ...(system !== "" ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
    });
  }

  private usage(raw: unknown): Usage | undefined {
    return isRecord(raw)
      ? usageOf(count(raw.promptTokenCount), count(raw.candidatesTokenCount))
      : undefined;
  }

  /** The text of the first candidate and why it stopped. A blocked prompt has no candidates. */
  private candidate(body: Record<string, unknown>): { text: string; finish?: string } | undefined {
    const first = Array.isArray(body.candidates) ? (body.candidates as unknown[])[0] : undefined;
    if (!isRecord(first)) return undefined;
    const parts =
      isRecord(first.content) && Array.isArray(first.content.parts) ? first.content.parts : [];
    let text = "";
    for (const part of parts as unknown[]) {
      if (isRecord(part) && typeof part.text === "string" && part.thought !== true)
        text += part.text;
    }
    return { text, finish: str(first.finishReason) };
  }

  async generate(req: GenerateRequest, opts: CallOptions = {}): Promise<GenerateResult> {
    const key = await this.requireKey();
    const model = await this.model(req);
    const body = this.requestBody(req);
    const scope = createScope(opts.signal, { totalMs: opts.timeoutMs ?? this.generateTimeoutMs });
    try {
      const res = await send(
        this.fetchFn,
        this.id,
        this.url(`/models/${encodeURIComponent(model)}:generateContent`),
        {
          method: "POST",
          headers: this.headers(key),
          body,
          secrets: key === undefined ? [] : [key],
          errorDetail: false,
        },
        scope,
      );
      const parsed = await this.readObject(res, scope);
      const candidate = this.candidate(parsed);
      if (!candidate) {
        throw new ModelError(
          "protocol",
          this.id,
          "Gemini returned no answer (the prompt may have been blocked)",
        );
      }
      return {
        text: candidate.text,
        provenance: this.provenance(str(parsed.modelVersion) ?? model),
        usage: this.usage(parsed.usageMetadata),
        finishReason: candidate.finish,
      };
    } finally {
      scope.dispose();
    }
  }

  async *stream(req: GenerateRequest, opts: CallOptions = {}): AsyncGenerator<StreamChunk> {
    const key = await this.requireKey();
    const model = await this.model(req);
    const body = this.requestBody(req);
    const scope = createScope(opts.signal, {
      totalMs: opts.timeoutMs ?? this.streamTotalMs,
      idleMs: this.streamIdleMs,
    });
    let provenance = this.provenance(model);
    let usage: Usage | undefined;
    let finishReason: string | undefined;
    let sawAnswer = false;
    try {
      const res = await send(
        this.fetchFn,
        this.id,
        this.url(`/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`),
        {
          method: "POST",
          headers: this.headers(key),
          body,
          secrets: key === undefined ? [] : [key],
          errorDetail: false,
        },
        scope,
      );
      for await (const event of readSse(readLines(res, this.id, scope))) {
        const data = parseJsonObject(event.data);
        if (!data) continue;
        if (data.error !== undefined) {
          throw new ModelError("http", this.id, "Gemini reported an error while answering");
        }
        const served = str(data.modelVersion);
        if (served !== undefined && served !== provenance.model)
          provenance = this.provenance(served);
        usage = this.usage(data.usageMetadata) ?? usage;
        const candidate = this.candidate(data);
        if (!candidate) continue;
        sawAnswer = true;
        if (candidate.text.length > 0) yield { kind: "text", text: candidate.text, provenance };
        finishReason = candidate.finish ?? finishReason;
      }
      // Gemini ends the stream by closing it: a stream that never carried a candidate is an error.
      if (!sawAnswer || finishReason === undefined) {
        throw new ModelError("protocol", this.id, "Gemini stream ended before it finished");
      }
      yield { kind: "done", provenance, usage, finishReason };
    } finally {
      scope.dispose();
    }
  }

  /**
   * `batchEmbedContents`: one request, one vector per input, in order. The router never asks a
   * cloud provider to embed (embeddings stay on this device); this exists so the adapter is
   * complete and so that rule is the only thing standing between memory text and the cloud.
   */
  async embed(req: EmbedRequest, opts: CallOptions = {}): Promise<EmbedResult> {
    if (req.input.length === 0 || req.input.some((s) => s.length === 0)) {
      throw new ModelError("invalid", this.id, "Embedding input must be non-empty strings");
    }
    const model = assertModelId(req.model ?? DEFAULT_GEMINI_EMBED_MODEL, this.id, "path");
    const key = await this.requireKey();
    const scope = createScope(opts.signal, { totalMs: opts.timeoutMs ?? this.generateTimeoutMs });
    try {
      const res = await send(
        this.fetchFn,
        this.id,
        this.url(`/models/${encodeURIComponent(model)}:batchEmbedContents`),
        {
          method: "POST",
          headers: this.headers(key),
          body: JSON.stringify({
            requests: req.input.map((text) => ({
              model: `models/${model}`,
              content: { parts: [{ text }] },
            })),
          }),
          secrets: key === undefined ? [] : [key],
          errorDetail: false,
        },
        scope,
      );
      const parsed = await this.readObject(res, scope);
      const list = Array.isArray(parsed.embeddings) ? (parsed.embeddings as unknown[]) : [];
      const vectors = readVectors(
        list.map((e) => (isRecord(e) ? e.values : undefined)),
        req.input.length,
      );
      if (!vectors) {
        throw new ModelError("protocol", this.id, "Gemini sent an unusable embeddings reply");
      }
      return {
        embeddings: vectors,
        dimensions: vectors[0]!.length,
        provenance: this.provenance(model),
      };
    } finally {
      scope.dispose();
    }
  }
}
