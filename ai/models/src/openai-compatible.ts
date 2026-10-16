// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// ONE adapter for every server that speaks the OpenAI "chat completions" wire format: OpenAI,
// DeepSeek, Qwen (DashScope compatible mode), Moonshot, LM Studio, Ollama's /v1, and any server a
// user adds. Chat, streaming (SSE), embeddings and the model list are the documented
// `/chat/completions`, `/embeddings` and `/models` endpoints under the base URL.
//
// Locality is DERIVED from the base URL (loopback => this device, anything else => cloud) and can
// not be claimed by configuration. The API key is sent as `Authorization: Bearer` only over https
// (or to loopback), never to a URL with credentials, never across a redirect (see KeyedProvider and
// `send`), and never appears in an error, a health result or a log. Server error text is not put
// in any message either: an error body can echo request fields.
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
import { assertModelId, KeyedProvider, usageOf, type KeyedProviderConfig } from "./keyed-provider";
import type {
  CallOptions,
  EmbedRequest,
  EmbedResult,
  GenerateRequest,
  GenerateResult,
  ModelInfo,
  ProviderCapabilities,
  StreamChunk,
  Usage,
} from "./types";

/** `max_completion_tokens` is OpenAI's current name; `max_tokens` is what compatible servers take. */
export type MaxTokensField = "max_tokens" | "max_completion_tokens";

export interface OpenAiCompatibleConfig extends KeyedProviderConfig {
  /** Used when a request names no model. Absent = the first chat model the server lists. */
  defaultModel?: string;
  /** Used by `embed` when a request names no model. Absent = the request must name one. */
  embedModel?: string;
  maxTokensField?: MaxTokensField;
}

const EMBED_NAME = /embed/i;
/** Model names a local server uses for models it forwards to a remote host (`gpt-oss:120b-cloud`). */
const REMOTE_NAME = /(^|[:\-])cloud$/i;
/** Most vectors read from one embeddings reply. */
const MAX_VECTORS = 2048;

export class OpenAiCompatibleProvider extends KeyedProvider {
  readonly capabilities: ProviderCapabilities;
  readonly costTier: 0 | 2;
  readonly typicalLatencyMs: number;
  readonly defaultModel: string | undefined;
  private readonly embedModel: string | undefined;
  private readonly maxTokensField: MaxTokensField;

  constructor(config: OpenAiCompatibleConfig) {
    super(config);
    this.defaultModel = config.defaultModel;
    this.embedModel = config.embedModel;
    this.maxTokensField = config.maxTokensField ?? "max_tokens";
    const local = this.locality === "local";
    // Only a server on this device is offered as an embedder: the router refuses cloud embeddings
    // (memory text stays on the device), and the disclosure text relies on that. `embed()` itself
    // works against any server that has /embeddings.
    this.capabilities = { generate: true, stream: true, embed: local };
    this.costTier = local ? 0 : 2;
    this.typicalLatencyMs = local ? 3_000 : 2_500;
  }

  protected modelsPath(): string {
    return "/models";
  }

  protected authHeaders(key: string | undefined): Record<string, string> {
    return key === undefined ? {} : { authorization: `Bearer ${key}` };
  }

  protected parseModels(body: Record<string, unknown>): ModelInfo[] {
    if (!Array.isArray(body.data)) {
      throw new ModelError("protocol", this.id, `${this.label} sent an unexpected model list`);
    }
    const out: ModelInfo[] = [];
    for (const entry of body.data as unknown[]) {
      const id = isRecord(entry) ? str(entry.id) : undefined;
      if (id === undefined || id.length === 0 || id.length > 200) continue;
      out.push({
        id,
        kind: EMBED_NAME.test(id) ? "embed" : "chat",
        remote: this.locality === "local" && REMOTE_NAME.test(id),
      });
    }
    return out;
  }

  /**
   * A server on this device can still forward a model to a remote service (Ollama's `name:cloud`
   * models). Such a model is refused here for the same reason OllamaProvider refuses it: this
   * provider is labelled "on this device" and passes the gate as local.
   */
  private checkModel(model: string): string {
    assertModelId(model, this.id);
    if (this.locality === "local" && REMOTE_NAME.test(model)) {
      throw new ModelError(
        "config",
        this.id,
        `Model ${model.slice(0, 80)} runs on a remote service, not on this device; refused`,
      );
    }
    return model;
  }

  private async chatModel(req: GenerateRequest): Promise<string> {
    return this.checkModel(req.model ?? this.defaultModel ?? (await this.firstChatModel()));
  }

  private chatBody(req: GenerateRequest, model: string, stream: boolean): string {
    if (req.messages.length === 0) {
      throw new ModelError("invalid", this.id, "A request needs at least one message");
    }
    const payload: Record<string, unknown> = { model, messages: req.messages, stream };
    if (req.maxTokens !== undefined) payload[this.maxTokensField] = req.maxTokens;
    if (req.temperature !== undefined) payload.temperature = req.temperature;
    if (stream) payload.stream_options = { include_usage: true };
    return JSON.stringify(payload);
  }

  private usage(raw: unknown): Usage | undefined {
    return isRecord(raw)
      ? usageOf(count(raw.prompt_tokens), count(raw.completion_tokens))
      : undefined;
  }

  async generate(req: GenerateRequest, opts: CallOptions = {}): Promise<GenerateResult> {
    const key = await this.requireKey();
    const model = await this.chatModel(req);
    const body = this.chatBody(req, model, false);
    const scope = createScope(opts.signal, { totalMs: opts.timeoutMs ?? this.generateTimeoutMs });
    try {
      const res = await send(
        this.fetchFn,
        this.id,
        this.url("/chat/completions"),
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
      const choice = Array.isArray(parsed.choices) ? (parsed.choices as unknown[])[0] : undefined;
      const message = isRecord(choice) && isRecord(choice.message) ? choice.message : undefined;
      // `content` is null when a model answered with a tool call or was filtered: no text.
      const text = message ? str(message.content) : undefined;
      if (text === undefined) {
        throw new ModelError("protocol", this.id, `${this.label} sent a reply with no text`);
      }
      return {
        text,
        provenance: this.provenance(str(parsed.model) ?? model),
        usage: this.usage(parsed.usage),
        finishReason: isRecord(choice) ? str(choice.finish_reason) : undefined,
      };
    } finally {
      scope.dispose();
    }
  }

  async *stream(req: GenerateRequest, opts: CallOptions = {}): AsyncGenerator<StreamChunk> {
    const key = await this.requireKey();
    const model = await this.chatModel(req);
    const body = this.chatBody(req, model, true);
    const scope = createScope(opts.signal, {
      totalMs: opts.timeoutMs ?? this.streamTotalMs,
      idleMs: this.streamIdleMs,
    });
    let provenance = this.provenance(model);
    let usage: Usage | undefined;
    let finishReason: string | undefined;
    let finished = false;
    try {
      const res = await send(
        this.fetchFn,
        this.id,
        this.url("/chat/completions"),
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
        if (event.data.trim() === "[DONE]") {
          finished = true;
          break;
        }
        // A data payload that is not JSON is skipped, like a malformed NDJSON line.
        const data = parseJsonObject(event.data);
        if (!data) continue;
        if (data.error !== undefined) {
          throw new ModelError("http", this.id, `${this.label} reported an error while answering`);
        }
        const served = str(data.model);
        if (served !== undefined && served !== provenance.model) {
          provenance = this.provenance(served);
        }
        const chunkUsage = this.usage(data.usage);
        if (chunkUsage) usage = chunkUsage;
        const choice = Array.isArray(data.choices) ? (data.choices as unknown[])[0] : undefined;
        if (!isRecord(choice)) continue;
        const delta = isRecord(choice.delta) ? choice.delta : undefined;
        const text = delta ? str(delta.content) : undefined;
        if (text !== undefined && text.length > 0) yield { kind: "text", text, provenance };
        const reason = str(choice.finish_reason);
        if (reason !== undefined) {
          finishReason = reason;
          // The usage chunk may follow the finish chunk; keep reading until [DONE] or the end.
          finished = true;
        }
      }
      if (!finished) {
        throw new ModelError("protocol", this.id, `${this.label} stream ended before it finished`);
      }
      yield { kind: "done", provenance, usage, finishReason };
    } finally {
      scope.dispose();
    }
  }

  async embed(req: EmbedRequest, opts: CallOptions = {}): Promise<EmbedResult> {
    if (req.input.length === 0 || req.input.some((s) => s.length === 0)) {
      throw new ModelError("invalid", this.id, "Embedding input must be non-empty strings");
    }
    const model = req.model ?? this.embedModel;
    if (model === undefined) {
      throw new ModelError("invalid", this.id, `Choose an embedding model for ${this.label}`);
    }
    this.checkModel(model);
    const key = await this.requireKey();
    const scope = createScope(opts.signal, { totalMs: opts.timeoutMs ?? this.generateTimeoutMs });
    try {
      const res = await send(
        this.fetchFn,
        this.id,
        this.url("/embeddings"),
        {
          method: "POST",
          headers: this.headers(key),
          body: JSON.stringify({ model, input: req.input }),
          secrets: key === undefined ? [] : [key],
          errorDetail: false,
        },
        scope,
      );
      const parsed = await this.readObject(res, scope);
      const data = Array.isArray(parsed.data) ? (parsed.data as unknown[]) : undefined;
      if (!data || data.length !== req.input.length || data.length > MAX_VECTORS) {
        throw new ModelError(
          "protocol",
          this.id,
          `${this.label} sent an unexpected embeddings reply`,
        );
      }
      // Entries carry an `index`; sort by it so the vectors line up with the inputs.
      const ordered = data
        .map((e, position) => ({ e, index: isRecord(e) ? (count(e.index) ?? position) : position }))
        .sort((a, b) => a.index - b.index);
      const embeddings: number[][] = [];
      for (const { e } of ordered) {
        const vector = isRecord(e) ? e.embedding : undefined;
        if (
          !Array.isArray(vector) ||
          vector.length === 0 ||
          (embeddings[0] !== undefined && vector.length !== embeddings[0].length) ||
          !vector.every((n) => typeof n === "number" && Number.isFinite(n))
        ) {
          throw new ModelError("protocol", this.id, `${this.label} sent an unusable embedding`);
        }
        embeddings.push(vector as number[]);
      }
      return {
        embeddings,
        dimensions: embeddings[0]!.length,
        provenance: this.provenance(str(parsed.model) ?? model),
      };
    } finally {
      scope.dispose();
    }
  }
}

/** A built-in way to reach a well-known OpenAI-compatible server. Base URLs come from each vendor's public docs. */
export interface OpenAiCompatiblePreset {
  id: string;
  label: string;
  baseUrl: string;
  /** From the vendor's own quick-start; the user can pick any other model in the switcher. */
  defaultModel?: string;
  /** OpenAI's chat endpoint names the limit `max_completion_tokens`; compatible servers take `max_tokens`. */
  maxTokensField?: MaxTokensField;
  /** Where the URL (and model) were read. */
  docs: string;
}

/**
 * The presets. Each URL was read from the vendor's public documentation (cited per entry):
 * a preset whose URL could not be confirmed is not shipped. Prices are NOT here: Phoenix has no
 * built-in prices, the user enters them.
 */
export const OPENAI_COMPATIBLE_PRESETS: readonly OpenAiCompatiblePreset[] = [
  {
    id: "openai",
    label: "OpenAI (cloud)",
    // https://developers.openai.com/api/reference/overview ("curl https://api.openai.com/v1/...").
    baseUrl: "https://api.openai.com/v1",
    maxTokensField: "max_completion_tokens",
    docs: "https://developers.openai.com/api/reference/overview",
  },
  {
    id: "deepseek",
    label: "DeepSeek (cloud)",
    // https://api-docs.deepseek.com/ : "base_url (OpenAI) https://api.deepseek.com".
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-flash",
    docs: "https://api-docs.deepseek.com/",
  },
  {
    id: "qwen",
    label: "Qwen (cloud, Alibaba Model Studio, Singapore)",
    // https://www.alibabacloud.com/help/en/model-studio/base-url : DashScope domain, Singapore,
    // OpenAI-compatible. API keys are bound to a region: for Beijing, US or a workspace domain
    // add a custom endpoint with the URL listed on that page.
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    docs: "https://www.alibabacloud.com/help/en/model-studio/base-url",
  },
  {
    id: "moonshot",
    label: "Moonshot Kimi (cloud)",
    // https://platform.kimi.ai/docs/overview : base_url="https://api.moonshot.ai/v1".
    baseUrl: "https://api.moonshot.ai/v1",
    defaultModel: "kimi-k3",
    docs: "https://platform.kimi.ai/docs/overview",
  },
  {
    id: "lmstudio",
    label: "LM Studio (this device)",
    // https://lmstudio.ai/docs/developer/openai-compat : base_url "http://localhost:1234/v1".
    baseUrl: "http://localhost:1234/v1",
    docs: "https://lmstudio.ai/docs/developer/openai-compat",
  },
];
