// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Local adapter: Ollama's HTTP API on this machine. Prompts never leave the device, so this is
// the only provider sensitive data may use. Loopback hosts only: pointing Phoenix at a remote
// "Ollama" would be a cloud provider in disguise and would bypass the external-AI gate.
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { ModelError } from "./errors";
import {
  createScope,
  count,
  isRecord,
  parseJsonObject,
  readCappedText,
  readLines,
  send,
  str,
  MAX_BODY_BYTES,
  type CallScope,
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

export const OLLAMA_ID = "ollama";
export const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
export const DEFAULT_OLLAMA_CHAT_MODEL = "llama3.2";
export const DEFAULT_OLLAMA_EMBED_MODEL = "nomic-embed-text";

const LOOPBACK_HOSTS: Record<string, true> = { "127.0.0.1": true, localhost: true, "[::1]": true };

/** Parses and validates the Ollama base URL. Throws unless it is plain http on a loopback host. */
export function assertLoopbackOllamaUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Ollama URL must be a URL");
  }
  if (url.protocol !== "http:" || LOOPBACK_HOSTS[url.hostname] !== true) {
    throw new ModelError(
      "config",
      OLLAMA_ID,
      "Ollama must run on this device (http://127.0.0.1); remote hosts are refused",
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new ModelError("config", OLLAMA_ID, "Ollama URL must not contain credentials");
  }
  return url.origin;
}

export interface OllamaOptions {
  baseUrl?: string;
  chatModel?: string;
  embedModel?: string;
  fetch?: FetchLike;
  /** Total time allowed for a non-streaming call (a cold model load can take a while). */
  generateTimeoutMs?: number;
  /** Longest silence allowed inside a stream. */
  streamIdleMs?: number;
  /** Total time allowed for a whole stream. */
  streamTotalMs?: number;
  healthTimeoutMs?: number;
}

/** Words in a model name that mean "this is an embedding model". */
const EMBED_NAME = /embed|bert|bge-|minilm/i;

/** Model names Ollama uses for models served by a remote host (`gpt-oss:120b-cloud`, `x:cloud`). */
const REMOTE_NAME = /(^|[:\-])cloud$/i;

function isRemoteEntry(name: string, entry: Record<string, unknown>): boolean {
  return (
    REMOTE_NAME.test(name) ||
    str(entry.remote_host) !== undefined ||
    str(entry.remote_model) !== undefined
  );
}

function remoteModelError(model: string): ModelError {
  return new ModelError(
    "config",
    OLLAMA_ID,
    `Model ${model.slice(0, 80)} runs on a remote service, not on this device; refused`,
  );
}

export class OllamaProvider implements ModelProvider {
  readonly id = OLLAMA_ID;
  readonly label = "Ollama (this device)";
  readonly locality = "local" as const;
  readonly capabilities = { generate: true, stream: true, embed: true };
  readonly costTier = 0 as const;
  readonly typicalLatencyMs = 2_000;

  private readonly verifiedLocal: Record<string, true | undefined> = {};
  private readonly baseUrl: string;
  private readonly chatModel: string;
  private readonly embedModel: string;
  private readonly fetchFn: FetchLike;
  private readonly generateTimeoutMs: number;
  private readonly streamIdleMs: number;
  private readonly streamTotalMs: number;
  private readonly healthTimeoutMs: number;

  constructor(options: OllamaOptions = {}) {
    this.baseUrl = assertLoopbackOllamaUrl(options.baseUrl ?? DEFAULT_OLLAMA_URL);
    this.chatModel = options.chatModel ?? DEFAULT_OLLAMA_CHAT_MODEL;
    this.embedModel = options.embedModel ?? DEFAULT_OLLAMA_EMBED_MODEL;
    this.fetchFn = options.fetch ?? ((url, init) => fetch(url, init));
    this.generateTimeoutMs = options.generateTimeoutMs ?? 120_000;
    this.streamIdleMs = options.streamIdleMs ?? 60_000;
    this.streamTotalMs = options.streamTotalMs ?? 300_000;
    this.healthTimeoutMs = options.healthTimeoutMs ?? 2_000;
  }

  private provenance(model: string): Provenance {
    return {
      provider: this.id,
      model,
      locality: this.locality,
      processedBy: processedByLabel(this.label, model, this.locality),
    };
  }

  private chatBody(req: GenerateRequest, stream: boolean): { model: string; body: string } {
    const model = req.model ?? this.chatModel;
    const options: Record<string, number> = {};
    if (req.maxTokens !== undefined) options.num_predict = req.maxTokens;
    if (req.temperature !== undefined) options.temperature = req.temperature;
    return { model, body: JSON.stringify({ model, messages: req.messages, stream, options }) };
  }

  /** `GET /api/tags`, validated. Entries keep only the fields this adapter uses. */
  private async fetchTags(scope: CallScope): Promise<ModelInfo[]> {
    const res = await send(
      this.fetchFn,
      this.id,
      `${this.baseUrl}/api/tags`,
      { method: "GET" },
      scope,
    );
    const body = parseJsonObject(await readCappedText(res, this.id, scope, MAX_BODY_BYTES));
    if (!body || !Array.isArray(body.models)) {
      throw new ModelError("protocol", this.id, "Ollama sent an unexpected model list");
    }
    const out: ModelInfo[] = [];
    for (const entry of body.models as unknown[]) {
      if (!isRecord(entry)) continue;
      const name = str(entry.name);
      if (name === undefined || name.length === 0 || name.length > 200) continue;
      out.push({
        id: name,
        kind: EMBED_NAME.test(name) ? "embed" : "chat",
        sizeBytes: count(entry.size),
        remote: isRemoteEntry(name, entry),
      });
    }
    return out;
  }

  /** Lists installed models. Entries with `remote: true` run on a remote service and are refused. */
  async models(): Promise<ModelInfo[]> {
    const scope = createScope(undefined, { totalMs: this.healthTimeoutMs });
    try {
      return await this.fetchTags(scope);
    } finally {
      scope.dispose();
    }
  }

  /**
   * Ollama can list "cloud" models (`name:cloud`, with `remote_host`) that forward prompts to
   * ollama.com. This provider is labelled "on this device" and is the only one sensitive data may
   * use, so such a model is refused: by name without any request, and for any other name by
   * checking once (and remembering) that the installed model has no remote host.
   */
  private async assertRunsHere(model: string, scope: CallScope): Promise<void> {
    if (REMOTE_NAME.test(model)) throw remoteModelError(model);
    if (this.verifiedLocal[model]) return;
    const entry = (await this.fetchTags(scope)).find(
      (m) => m.id === model || m.id === `${model}:latest`,
    );
    if (entry?.remote) throw remoteModelError(model);
    this.verifiedLocal[model] = true;
  }

  async health(): Promise<ProviderHealth> {
    const started = Date.now();
    const scope = createScope(undefined, { totalMs: this.healthTimeoutMs });
    try {
      const res = await send(
        this.fetchFn,
        this.id,
        `${this.baseUrl}/api/version`,
        { method: "GET" },
        scope,
      );
      const body = parseJsonObject(await readCappedText(res, this.id, scope, 4096));
      const version = body ? str(body.version)?.slice(0, 40) : undefined;
      if (version === undefined) {
        return { available: false, detail: "Ollama answered with something unexpected" };
      }
      return {
        available: true,
        detail: `Ollama ${version} is running`,
        version,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      return {
        available: false,
        detail:
          err instanceof ModelError && err.kind === "timeout"
            ? "Ollama did not answer"
            : "Ollama is not running",
      };
    } finally {
      scope.dispose();
    }
  }

  async generate(req: GenerateRequest, opts: CallOptions = {}): Promise<GenerateResult> {
    const { model, body } = this.chatBody(req, false);
    const scope = createScope(opts.signal, { totalMs: opts.timeoutMs ?? this.generateTimeoutMs });
    try {
      await this.assertRunsHere(model, scope);
      const res = await send(
        this.fetchFn,
        this.id,
        `${this.baseUrl}/api/chat`,
        { method: "POST", headers: { "content-type": "application/json" }, body },
        scope,
      );
      const parsed = parseJsonObject(await readCappedText(res, this.id, scope, MAX_BODY_BYTES));
      if (!parsed) throw new ModelError("protocol", this.id, "Ollama sent an unreadable reply");
      if (str(parsed.error) !== undefined) {
        throw new ModelError("http", this.id, `Ollama error: ${str(parsed.error)}`);
      }
      const message = parsed.message;
      const text = isRecord(message) ? str(message.content) : undefined;
      if (text === undefined)
        throw new ModelError("protocol", this.id, "Ollama reply had no message");
      return {
        text,
        provenance: this.provenance(model),
        usage: usageOf(parsed),
        finishReason: str(parsed.done_reason),
      };
    } finally {
      scope.dispose();
    }
  }

  async *stream(req: GenerateRequest, opts: CallOptions = {}): AsyncGenerator<StreamChunk> {
    const { model, body } = this.chatBody(req, true);
    const scope = createScope(opts.signal, {
      totalMs: opts.timeoutMs ?? this.streamTotalMs,
      idleMs: this.streamIdleMs,
    });
    const provenance = this.provenance(model);
    try {
      await this.assertRunsHere(model, scope);
      const res = await send(
        this.fetchFn,
        this.id,
        `${this.baseUrl}/api/chat`,
        { method: "POST", headers: { "content-type": "application/json" }, body },
        scope,
      );
      let finished = false;
      for await (const line of readLines(res, this.id, scope)) {
        if (line.trim() === "") continue;
        // A line that is not JSON is skipped: one bad line should not lose the answer so far.
        const parsed = parseJsonObject(line);
        if (!parsed) continue;
        if (str(parsed.error) !== undefined) {
          throw new ModelError("http", this.id, `Ollama error: ${str(parsed.error)}`);
        }
        const message = parsed.message;
        const text = isRecord(message) ? str(message.content) : undefined;
        if (text !== undefined && text.length > 0) yield { kind: "text", text, provenance };
        if (parsed.done === true) {
          finished = true;
          yield {
            kind: "done",
            provenance,
            usage: usageOf(parsed),
            finishReason: str(parsed.done_reason),
          };
          break;
        }
      }
      if (!finished) {
        throw new ModelError("protocol", this.id, "Ollama stream ended before it finished", {
          retryable: false,
        });
      }
    } finally {
      scope.dispose();
    }
  }

  async embed(req: EmbedRequest, opts: CallOptions = {}): Promise<EmbedResult> {
    if (req.input.length === 0 || req.input.some((s) => s.length === 0)) {
      throw new ModelError("invalid", this.id, "Embedding input must be non-empty strings");
    }
    const model = req.model ?? this.embedModel;
    const scope = createScope(opts.signal, { totalMs: opts.timeoutMs ?? this.generateTimeoutMs });
    try {
      await this.assertRunsHere(model, scope);
      const res = await send(
        this.fetchFn,
        this.id,
        `${this.baseUrl}/api/embed`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model, input: req.input }),
        },
        scope,
      );
      const parsed = parseJsonObject(await readCappedText(res, this.id, scope, MAX_BODY_BYTES));
      const embeddings = parsed ? readEmbeddings(parsed.embeddings) : undefined;
      if (!embeddings || embeddings.length !== req.input.length) {
        throw new ModelError("protocol", this.id, "Ollama sent malformed embeddings");
      }
      return {
        embeddings,
        dimensions: embeddings[0]?.length ?? 0,
        provenance: this.provenance(model),
      };
    } finally {
      scope.dispose();
    }
  }
}

function usageOf(body: Record<string, unknown>): Usage | undefined {
  const inputTokens = count(body.prompt_eval_count);
  const outputTokens = count(body.eval_count);
  return inputTokens === undefined && outputTokens === undefined
    ? undefined
    : { inputTokens, outputTokens };
}

/** Accepts only a non-empty array of equal-length arrays of finite numbers. */
function readEmbeddings(value: unknown): number[][] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const out: number[][] = [];
  let width = -1;
  for (const row of value as unknown[]) {
    if (!Array.isArray(row) || row.length === 0) return undefined;
    if (width >= 0 && row.length !== width) return undefined;
    width = row.length;
    const numbers: number[] = [];
    for (const n of row as unknown[]) {
      if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
      numbers.push(n);
    }
    out.push(numbers);
  }
  return out;
}
