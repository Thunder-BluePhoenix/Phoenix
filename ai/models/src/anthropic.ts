// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Cloud adapter: the Anthropic Messages API. Prompts leave this device, so nothing here is
// reached except through AiService's gate (grant + per-class opt-in). The API key is supplied by
// the caller as a function and is used only to fill the `x-api-key` header: it is never stored in
// a field, logged, or put in an error or health result.
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { ModelError } from "./errors";
import {
  count,
  createScope,
  isRecord,
  MAX_BODY_BYTES,
  parseJsonObject,
  readCappedText,
  readLines,
  readSse,
  scrub,
  send,
  str,
  type FetchLike,
} from "./http";
import {
  processedByLabel,
  type CallOptions,
  type EmbedRequest,
  type EmbedResult,
  type GenerateRequest,
  type GenerateResult,
  type ModelInfo,
  type ModelProvider,
  type Provenance,
  type ProviderHealth,
  type StreamChunk,
  type Usage,
} from "./types";

export const ANTHROPIC_ID = "anthropic";
export const DEFAULT_ANTHROPIC_URL = "https://api.anthropic.com";
export const ANTHROPIC_VERSION = "2023-06-01";
/** Default model. Configurable; not verified against the live API in this repository. */
export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5";
/** The Messages API requires max_tokens; used when the request does not set one. */
export const DEFAULT_MAX_TOKENS = 1024;

const LOOPBACK_HOSTS: Record<string, true> = { "127.0.0.1": true, localhost: true, "[::1]": true };

/** The key is only ever sent over https (plain http is allowed to loopback for test servers). */
export function assertSafeAnthropicUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Anthropic URL must be a URL");
  }
  const loopbackHttp = url.protocol === "http:" && LOOPBACK_HOSTS[url.hostname] === true;
  if (url.protocol !== "https:" && !loopbackHttp) {
    throw new ModelError("config", ANTHROPIC_ID, "The Anthropic URL must use https");
  }
  if (url.username !== "" || url.password !== "") {
    throw new ModelError("config", ANTHROPIC_ID, "The Anthropic URL must not contain credentials");
  }
  return url.origin;
}

export interface AnthropicOptions {
  baseUrl?: string;
  model?: string;
  /** Returns the API key, or undefined when none is configured. Called for every request. */
  getKey: () => Promise<string | undefined>;
  fetch?: FetchLike;
  generateTimeoutMs?: number;
  streamIdleMs?: number;
  streamTotalMs?: number;
  healthTimeoutMs?: number;
}

export class AnthropicProvider implements ModelProvider {
  readonly id = ANTHROPIC_ID;
  readonly label = "Anthropic (cloud)";
  readonly locality = "cloud" as const;
  /** Anthropic has no embeddings API. */
  readonly capabilities = { generate: true, stream: true, embed: false };
  readonly costTier = 2 as const;
  readonly typicalLatencyMs = 2_500;

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly getKey: () => Promise<string | undefined>;
  private readonly fetchFn: FetchLike;
  private readonly generateTimeoutMs: number;
  private readonly streamIdleMs: number;
  private readonly streamTotalMs: number;
  private readonly healthTimeoutMs: number;

  constructor(options: AnthropicOptions) {
    this.baseUrl = assertSafeAnthropicUrl(options.baseUrl ?? DEFAULT_ANTHROPIC_URL);
    this.model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
    this.getKey = options.getKey;
    this.fetchFn = options.fetch ?? ((url, init) => fetch(url, init));
    this.generateTimeoutMs = options.generateTimeoutMs ?? 60_000;
    this.streamIdleMs = options.streamIdleMs ?? 30_000;
    this.streamTotalMs = options.streamTotalMs ?? 300_000;
    this.healthTimeoutMs = options.healthTimeoutMs ?? 5_000;
  }

  private provenance(model: string): Provenance {
    return {
      provider: this.id,
      model,
      locality: this.locality,
      processedBy: processedByLabel(this.label, model, this.locality),
    };
  }

  /** Reads the key for one request. A missing key is an auth error that names no secret. */
  private async requireKey(): Promise<string> {
    let key: string | undefined;
    try {
      key = await this.getKey();
    } catch {
      throw new ModelError("auth", this.id, "The Anthropic API key could not be read");
    }
    if (key === undefined || key.trim() === "") {
      throw new ModelError("auth", this.id, "No Anthropic API key is set");
    }
    return key;
  }

  private messagesBody(req: GenerateRequest, stream: boolean): { model: string; body: string } {
    const model = req.model ?? this.model;
    const system = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const messages = req.messages.filter((m) => m.role !== "system");
    if (messages.length === 0) {
      throw new ModelError("invalid", this.id, "A request needs at least one user message");
    }
    const payload: Record<string, unknown> = {
      model,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages,
      stream,
    };
    if (system !== "") payload.system = system;
    if (req.temperature !== undefined) payload.temperature = req.temperature;
    return { model, body: JSON.stringify(payload) };
  }

  private headers(key: string): Record<string, string> {
    return {
      "x-api-key": key,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    };
  }

  async models(): Promise<ModelInfo[]> {
    const key = await this.requireKey();
    const scope = createScope(undefined, { totalMs: this.healthTimeoutMs });
    try {
      const res = await send(
        this.fetchFn,
        this.id,
        `${this.baseUrl}/v1/models?limit=100`,
        { method: "GET", headers: this.headers(key), secrets: [key] },
        scope,
      );
      const body = parseJsonObject(await readCappedText(res, this.id, scope, MAX_BODY_BYTES));
      if (!body || !Array.isArray(body.data)) {
        throw new ModelError("protocol", this.id, "Anthropic sent an unexpected model list");
      }
      const out: ModelInfo[] = [];
      for (const entry of body.data as unknown[]) {
        const id = isRecord(entry) ? str(entry.id) : undefined;
        if (id !== undefined && id.length > 0 && id.length <= 200) out.push({ id, kind: "chat" });
      }
      return out;
    } finally {
      scope.dispose();
    }
  }

  /**
   * Checks that a key exists and the API accepts it, using the model-list endpoint (it carries no
   * user data). The detail text never includes the key or any part of it.
   */
  async health(): Promise<ProviderHealth> {
    let key: string;
    try {
      key = await this.requireKey();
    } catch {
      return { available: false, detail: "No Anthropic API key is set" };
    }
    const started = Date.now();
    const scope = createScope(undefined, { totalMs: this.healthTimeoutMs });
    try {
      await send(
        this.fetchFn,
        this.id,
        `${this.baseUrl}/v1/models?limit=1`,
        { method: "GET", headers: this.headers(key), secrets: [key] },
        scope,
      );
      return {
        available: true,
        detail: "Anthropic API reachable",
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      if (err instanceof ModelError && err.kind === "auth") {
        return { available: false, detail: "Anthropic rejected the API key" };
      }
      return { available: false, detail: "Anthropic API is not reachable" };
    } finally {
      scope.dispose();
    }
  }

  async generate(req: GenerateRequest, opts: CallOptions = {}): Promise<GenerateResult> {
    const { model, body } = this.messagesBody(req, false);
    const key = await this.requireKey();
    const scope = createScope(opts.signal, { totalMs: opts.timeoutMs ?? this.generateTimeoutMs });
    try {
      const res = await send(
        this.fetchFn,
        this.id,
        `${this.baseUrl}/v1/messages`,
        { method: "POST", headers: this.headers(key), body, secrets: [key] },
        scope,
      );
      const parsed = parseJsonObject(await readCappedText(res, this.id, scope, MAX_BODY_BYTES));
      if (!parsed || !Array.isArray(parsed.content)) {
        throw new ModelError("protocol", this.id, "Anthropic sent an unreadable reply");
      }
      let text = "";
      for (const block of parsed.content as unknown[]) {
        if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
          text += block.text;
        }
      }
      const usage = isRecord(parsed.usage) ? parsed.usage : undefined;
      return {
        text,
        provenance: this.provenance(str(parsed.model) ?? model),
        usage: usage
          ? { inputTokens: count(usage.input_tokens), outputTokens: count(usage.output_tokens) }
          : undefined,
        finishReason: str(parsed.stop_reason),
      };
    } finally {
      scope.dispose();
    }
  }

  async *stream(req: GenerateRequest, opts: CallOptions = {}): AsyncGenerator<StreamChunk> {
    const { model, body } = this.messagesBody(req, true);
    const key = await this.requireKey();
    const scope = createScope(opts.signal, {
      totalMs: opts.timeoutMs ?? this.streamTotalMs,
      idleMs: this.streamIdleMs,
    });
    let provenance = this.provenance(model);
    const usage: Usage = {};
    let finishReason: string | undefined;
    try {
      const res = await send(
        this.fetchFn,
        this.id,
        `${this.baseUrl}/v1/messages`,
        { method: "POST", headers: this.headers(key), body, secrets: [key] },
        scope,
      );
      let stopped = false;
      for await (const event of readSse(readLines(res, this.id, scope))) {
        // A data payload that is not JSON is skipped, like a malformed NDJSON line.
        const data = parseJsonObject(event.data);
        if (!data) continue;
        const type = str(data.type) ?? event.event;
        if (type === "message_start") {
          const message = isRecord(data.message) ? data.message : undefined;
          const served = message ? str(message.model) : undefined;
          if (served !== undefined) provenance = this.provenance(served);
          const u = message && isRecord(message.usage) ? message.usage : undefined;
          if (u) usage.inputTokens = count(u.input_tokens);
        } else if (type === "content_block_delta") {
          const delta = isRecord(data.delta) ? data.delta : undefined;
          const text = delta && delta.type === "text_delta" ? str(delta.text) : undefined;
          if (text !== undefined && text.length > 0) yield { kind: "text", text, provenance };
        } else if (type === "message_delta") {
          const delta = isRecord(data.delta) ? data.delta : undefined;
          finishReason = (delta ? str(delta.stop_reason) : undefined) ?? finishReason;
          const u = isRecord(data.usage) ? data.usage : undefined;
          if (u) usage.outputTokens = count(u.output_tokens);
        } else if (type === "message_stop") {
          stopped = true;
          yield { kind: "done", provenance, usage, finishReason };
          break;
        } else if (type === "error") {
          const err = isRecord(data.error) ? data.error : undefined;
          const kind = err ? str(err.type) : undefined;
          const message = err ? str(err.message) : undefined;
          throw new ModelError(
            "http",
            this.id,
            `Anthropic stream error${kind ? ` (${scrub(kind, [key])})` : ""}${message ? `: ${scrub(message, [key])}` : ""}`,
            { retryable: kind === "overloaded_error" },
          );
        }
        // `ping` and unknown event types are ignored, as the API documents they may be added.
      }
      if (!stopped) {
        throw new ModelError("protocol", this.id, "Anthropic stream ended before it finished");
      }
    } finally {
      scope.dispose();
    }
  }

  // Anthropic offers no embeddings API; the router never plans embed calls here.
  embed(_req: EmbedRequest, _opts?: CallOptions): Promise<EmbedResult> {
    return Promise.reject(
      new ModelError("unsupported", this.id, "Anthropic does not provide embeddings"),
    );
  }
}
