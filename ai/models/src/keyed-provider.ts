// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Shared base of the adapters that talk to an HTTP API with a user-supplied API key (the
// OpenAI-compatible adapter and Gemini). It owns everything that must be identical for them:
//  - the key is read for every request through `getKey` and used only to fill one header; it is
//    never stored in a field, logged, or put in an error, a health result or a model list;
//  - the base URL is validated once: https (or loopback http), no credentials in it;
//  - redirects are errors (see `send`), so the key cannot follow a redirect to another host;
//  - error messages are written here, never taken from the server's reply.
import { ModelError } from "./errors";
import {
  createScope,
  MAX_BODY_BYTES,
  parseJsonObject,
  readCappedText,
  send,
  type CallScope,
  type FetchLike,
} from "./http";
import {
  processedByLabel,
  type CallOptions,
  type CostTier,
  type EmbedRequest,
  type EmbedResult,
  type GenerateRequest,
  type GenerateResult,
  type KeyPolicy,
  type ModelInfo,
  type ModelProvider,
  type Provenance,
  type ProviderCapabilities,
  type ProviderHealth,
  type StreamChunk,
  type Usage,
} from "./types";
import { assertSafeBaseUrl, localityOfUrl } from "./url";

/** Longest model id accepted from a caller or a server. */
export const MAX_MODEL_CHARS = 200;
/**
 * Model ids reach request bodies (OpenAI-compatible: "org/model", "name:tag" are normal) or a URL
 * path (Gemini: no "/" or ":" so an id can never reach another endpoint with the key attached).
 */
const MODEL_ID: Record<ModelIdUse, RegExp> = {
  body: /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/,
  path: /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
};
const NO_MODEL_LIST: Record<number, true> = { 404: true, 405: true, 501: true };
/** Most models read from one list reply. */
const MAX_MODELS = 1000;

export interface KeyedProviderConfig {
  id: string;
  label: string;
  baseUrl: string;
  /** Returns the API key, or undefined when none is set. Called for every request. */
  getKey: () => Promise<string | undefined>;
  fetch?: FetchLike;
  generateTimeoutMs?: number;
  streamIdleMs?: number;
  streamTotalMs?: number;
  healthTimeoutMs?: number;
}

export type ModelIdUse = "body" | "path";

export function isModelId(model: string, use: ModelIdUse = "body"): boolean {
  return model.length > 0 && model.length <= MAX_MODEL_CHARS && MODEL_ID[use].test(model);
}

export function assertModelId(model: string, providerId: string, use: ModelIdUse = "body"): string {
  if (!isModelId(model, use))
    throw new ModelError("invalid", providerId, "The model name is not valid");
  return model;
}

export function usageOf(input: number | undefined, output: number | undefined): Usage | undefined {
  return input === undefined && output === undefined
    ? undefined
    : { inputTokens: input, outputTokens: output };
}

export abstract class KeyedProvider implements ModelProvider {
  readonly id: string;
  readonly label: string;
  readonly locality: ModelProvider["locality"];
  readonly keyPolicy: KeyPolicy;
  /**
   * Never an automatic fallback: used only when the user routes work to it or prefers it. A key
   * that is set or a server that is added must not make it start receiving requests by itself.
   */
  readonly explicitOnly = true;
  abstract readonly capabilities: ProviderCapabilities;
  abstract readonly costTier: CostTier;
  abstract readonly typicalLatencyMs: number;
  abstract readonly defaultModel: string | undefined;

  protected readonly baseUrl: string;
  protected readonly fetchFn: FetchLike;
  protected readonly generateTimeoutMs: number;
  protected readonly streamIdleMs: number;
  protected readonly streamTotalMs: number;
  protected readonly healthTimeoutMs: number;
  private readonly getKey: () => Promise<string | undefined>;

  constructor(config: KeyedProviderConfig) {
    this.id = config.id;
    this.label = config.label;
    this.baseUrl = assertSafeBaseUrl(config.baseUrl, config.id, config.label);
    this.locality = localityOfUrl(this.baseUrl);
    // A key is mandatory for a service on the internet; this device's own server may not want one.
    this.keyPolicy = this.locality === "cloud" ? "required" : "optional";
    this.getKey = config.getKey;
    this.fetchFn = config.fetch ?? ((url, init) => fetch(url, init));
    this.generateTimeoutMs = config.generateTimeoutMs ?? 60_000;
    this.streamIdleMs = config.streamIdleMs ?? 30_000;
    this.streamTotalMs = config.streamTotalMs ?? 300_000;
    this.healthTimeoutMs = config.healthTimeoutMs ?? 5_000;
  }

  /** The URL a request is sent to (always under the validated base URL). */
  protected url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  /** The URL used by `health` and `models`. */
  protected abstract modelsPath(limit?: number): string;
  /** Request headers for a key (or none). The only place a key is put on the wire. */
  protected abstract authHeaders(key: string | undefined): Record<string, string>;
  protected abstract parseModels(body: Record<string, unknown>): ModelInfo[];

  protected provenance(model: string): Provenance {
    return {
      provider: this.id,
      model,
      locality: this.locality,
      processedBy: processedByLabel(this.label, model, this.locality),
    };
  }

  /**
   * Reads the key for one request. When a key is required and none is set the error names the
   * provider, never a secret.
   */
  protected async requireKey(): Promise<string | undefined> {
    let key: string | undefined;
    try {
      key = await this.getKey();
    } catch {
      if (this.keyPolicy === "required") {
        throw new ModelError("auth", this.id, `The API key for ${this.label} could not be read`);
      }
      return undefined;
    }
    if (key === undefined || key.trim() === "") {
      if (this.keyPolicy === "required") {
        throw new ModelError("auth", this.id, `No API key is set for ${this.label}`);
      }
      return undefined;
    }
    return key;
  }

  protected headers(key: string | undefined): Record<string, string> {
    return { "content-type": "application/json", ...this.authHeaders(key) };
  }

  /**
   * The model to use when nothing names one. A server on this device (LM Studio serves what is
   * loaded) may pick its first chat model. A cloud service never does: that could silently choose
   * an expensive model, so the user must choose one.
   */
  protected async firstChatModel(): Promise<string> {
    const found =
      this.locality === "local" ? (await this.models()).find((m) => m.kind === "chat") : undefined;
    if (!found) {
      throw new ModelError(
        "config",
        this.id,
        `Choose a model for ${this.label} in the model switcher`,
      );
    }
    return found.id;
  }

  /** Reads a JSON reply, with the generic error text for anything that is not a JSON object. */
  protected async readObject(res: Response, scope: CallScope): Promise<Record<string, unknown>> {
    const parsed = parseJsonObject(await readCappedText(res, this.id, scope, MAX_BODY_BYTES));
    if (!parsed)
      throw new ModelError("protocol", this.id, `${this.label} sent an unreadable reply`);
    return parsed;
  }

  async models(): Promise<ModelInfo[]> {
    const key = await this.requireKey();
    const scope = createScope(undefined, { totalMs: this.healthTimeoutMs });
    try {
      const res = await send(
        this.fetchFn,
        this.id,
        this.url(this.modelsPath()),
        {
          method: "GET",
          headers: this.headers(key),
          secrets: key === undefined ? [] : [key],
          errorDetail: false,
        },
        scope,
      );
      const body = await this.readObject(res, scope);
      return this.parseModels(body).slice(0, MAX_MODELS);
    } finally {
      scope.dispose();
    }
  }

  /**
   * Checks the key (if one is needed) and that the server answers, using the model-list endpoint:
   * it carries no user data. The detail text never includes the key or any part of it.
   */
  async health(): Promise<ProviderHealth> {
    let key: string | undefined;
    try {
      key = await this.requireKey();
    } catch (err) {
      return {
        available: false,
        detail: err instanceof ModelError ? err.message : `No API key is set for ${this.label}`,
      };
    }
    const started = Date.now();
    const scope = createScope(undefined, { totalMs: this.healthTimeoutMs });
    try {
      await send(
        this.fetchFn,
        this.id,
        this.url(this.modelsPath(1)),
        {
          method: "GET",
          headers: this.headers(key),
          secrets: key === undefined ? [] : [key],
          errorDetail: false,
        },
        scope,
      );
      return {
        available: true,
        detail: `${this.label} is reachable`,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      if (err instanceof ModelError && err.kind === "auth") {
        return { available: false, detail: `${this.label} rejected the API key` };
      }
      // A server that answers but has no model list (404/405/501) is still a working server.
      if (err instanceof ModelError && err.status !== undefined && NO_MODEL_LIST[err.status]) {
        return { available: true, detail: `${this.label} is reachable (it lists no models)` };
      }
      return { available: false, detail: `${this.label} is not reachable` };
    } finally {
      scope.dispose();
    }
  }

  abstract generate(req: GenerateRequest, opts?: CallOptions): Promise<GenerateResult>;
  abstract stream(req: GenerateRequest, opts?: CallOptions): AsyncIterable<StreamChunk>;
  abstract embed(req: EmbedRequest, opts?: CallOptions): Promise<EmbedResult>;
}

/** Reads `[[number]]` vectors of one common length; anything else is a protocol failure. */
export function readVectors(vectors: unknown[], expected: number): number[][] | undefined {
  if (vectors.length !== expected) return undefined;
  const out: number[][] = [];
  for (const v of vectors) {
    if (!Array.isArray(v) || v.length === 0 || (out[0] && v.length !== out[0].length)) {
      return undefined;
    }
    if (!v.every((n) => typeof n === "number" && Number.isFinite(n))) return undefined;
    out.push(v as number[]);
  }
  return out;
}
