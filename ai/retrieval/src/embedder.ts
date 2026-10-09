// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Embeddings always go through the model router (AiService), so the same rules apply as for any
// other model call: AI off means no call, the privacy class decides which providers may see the
// text, and sensitive text never reaches a cloud provider for these purposes (neither purpose
// below is in SENSITIVE_CLOUD_PURPOSES, which is code, not a setting).
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import {
  AiDisabledError,
  AllProvidersFailedError,
  ModelError,
  NoProviderError,
  type AiService,
  type PrivacyClass,
} from "@phoenix/ai-models";
import { VectorError } from "./vectors";

/** Background indexing of stored memories. Never a "purpose the user asked for just now". */
export const PURPOSE_EMBED_MEMORY = "embed memory for retrieval";
/** The text of one retrieval query. */
export const PURPOSE_EMBED_QUERY = "embed a retrieval query";
export const PURPOSE_RERANK = "rerank retrieval candidates";

export interface Embedder {
  /**
   * Identity of the vector space, "<provider>/<model>" plus the text recipe. Vectors are only
   * ever compared with vectors of the same key.
   */
  readonly modelKey: string;
  embedDocuments(
    texts: readonly string[],
    privacy: PrivacyClass,
    signal?: AbortSignal,
  ): Promise<number[][]>;
  embedQuery(text: string, privacy: PrivacyClass, signal?: AbortSignal): Promise<number[]>;
}

/** The router answered with a different provider or model than the one the index is built with. */
export class EmbedderMismatchError extends PhoenixError {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      ErrorCode.INVALID_REQUEST,
      `The router used ${actual}, but the vector index is built with ${expected}; result discarded`,
    );
    this.name = "EmbedderMismatchError";
  }
}

export interface AiEmbedderOptions {
  /** Provider id the index is built with, for example "ollama". */
  provider: string;
  /** Provider-specific embedding model, for example "nomic-embed-text". */
  model: string;
  /** Prepended to stored text (nomic-embed-text wants `search_document: `). Part of the key. */
  documentPrefix?: string;
  /** Prepended to queries (nomic-embed-text wants `search_query: `). Part of the key. */
  queryPrefix?: string;
  timeoutMs?: number;
}

export class AiEmbedder implements Embedder {
  readonly modelKey: string;

  constructor(
    private readonly ai: AiService,
    private readonly options: AiEmbedderOptions,
  ) {
    const recipe = options.documentPrefix || options.queryPrefix ? "#prefixed" : "";
    this.modelKey = `${options.provider}/${options.model}${recipe}`;
  }

  embedDocuments(
    texts: readonly string[],
    privacy: PrivacyClass,
    signal?: AbortSignal,
  ): Promise<number[][]> {
    const prefix = this.options.documentPrefix ?? "";
    return this.run(
      texts.map((t) => prefix + t),
      privacy,
      PURPOSE_EMBED_MEMORY,
      signal,
    );
  }

  async embedQuery(text: string, privacy: PrivacyClass, signal?: AbortSignal): Promise<number[]> {
    const vectors = await this.run(
      [(this.options.queryPrefix ?? "") + text],
      privacy,
      PURPOSE_EMBED_QUERY,
      signal,
    );
    const first = vectors[0];
    if (!first) throw new EmbedderMismatchError(this.modelKey, "an empty answer");
    return first;
  }

  private async run(
    input: string[],
    privacy: PrivacyClass,
    purpose: string,
    signal?: AbortSignal,
  ): Promise<number[][]> {
    const outcome = await this.ai.run({
      kind: "embed",
      request: { input, privacy, purpose, model: this.options.model },
      preferred: this.options.provider,
      signal,
      timeoutMs: this.options.timeoutMs,
    });
    const p = outcome.provenance;
    const recipe = this.modelKey.slice(`${this.options.provider}/${this.options.model}`.length);
    const actual = `${p.provider}/${p.model}${recipe}`;
    if (actual !== this.modelKey) throw new EmbedderMismatchError(this.modelKey, actual);
    return outcome.result.embeddings;
  }
}

/** Why embedding did not happen. Safe to show to users. */
export type EmbeddingDegradedReason =
  "ai_disabled" | "no_provider" | "provider_unavailable" | "model_mismatch";

export const DEGRADED_TEXT: Record<EmbeddingDegradedReason, string> = {
  ai_disabled: "AI is turned off, so memories are not embedded; search is keyword-only.",
  no_provider:
    "No AI provider is allowed to embed this data (privacy rules), so it is searched by keywords only.",
  provider_unavailable:
    "The embedding provider did not answer, so search is keyword-only until it does.",
  model_mismatch:
    "The router answered with a different embedding model than the index uses, so the result was discarded and search is keyword-only.",
};

export interface EmbedFailure {
  reason: EmbeddingDegradedReason;
  message: string;
}

/**
 * Maps an embedding error to a degradation. Returns null for an error that is not a model or
 * vector problem (a bug), which the caller must rethrow rather than swallow.
 */
export function classifyEmbedFailure(err: unknown): EmbedFailure | null {
  if (err instanceof AiDisabledError) return { reason: "ai_disabled", message: err.message };
  if (err instanceof NoProviderError) {
    // A provider that is merely offline is transient; one the privacy rules refuse is not.
    const offline = err.attempts.some((a) => a.reason?.startsWith("unavailable") === true);
    return { reason: offline ? "provider_unavailable" : "no_provider", message: err.message };
  }
  if (err instanceof EmbedderMismatchError) {
    return { reason: "model_mismatch", message: err.message };
  }
  if (
    err instanceof AllProvidersFailedError ||
    err instanceof ModelError ||
    err instanceof VectorError
  ) {
    return { reason: "provider_unavailable", message: err.message };
  }
  return null;
}
