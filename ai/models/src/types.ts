// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** Where a provider runs. `cloud` means prompts leave this device. */
export type Locality = "local" | "cloud";

/** Data class of a request. Decides whether a cloud provider may ever see it. */
export type PrivacyClass = "public" | "internal" | "sensitive";
export const PRIVACY_CLASSES: readonly PrivacyClass[] = ["public", "internal", "sensitive"];

export function isPrivacyClass(value: unknown): value is PrivacyClass {
  return value === "public" || value === "internal" || value === "sensitive";
}

/** 0 = free (runs on this device); higher = more expensive per call. */
export type CostTier = 0 | 1 | 2 | 3;

export type TaskKind = "generate" | "stream" | "embed";

export interface ProviderCapabilities {
  generate: boolean;
  stream: boolean;
  embed: boolean;
}

/** What a call cost, computed ONLY from prices the user entered (Phoenix hard-codes none). */
export interface Cost {
  amount: number;
  currency: "USD";
  basis: "user-configured prices";
}

/** User-supplied price of a model in USD per one million tokens. */
export interface Price {
  input_per_mtok: number;
  output_per_mtok: number;
}

/** Whether a provider needs an API key: never (on-device), may take one, or cannot work without. */
export type KeyPolicy = "none" | "optional" | "required";

/** Who answered, so any output can be labelled "processed by X". */
export interface Provenance {
  /** Provider id, e.g. "ollama". */
  provider: string;
  model: string;
  locality: Locality;
  /** Human-readable label, e.g. "Ollama · llama3.2 · on this device". */
  processedBy: string;
  /** The provider's display label (attached by AiService). */
  label?: string;
  /** Token counts the provider reported. Attached by AiService to generate results. */
  usage?: Usage;
  /** null = no cost can be given (local, no price entered, or no token counts). */
  cost?: Cost | null;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface RequestBase {
  /** Data class of everything in this request. Required: there is no default. */
  privacy: PrivacyClass;
  /** Why the call is made (shown in logs and the UI), e.g. "summarise meeting". */
  purpose: string;
  /** Provider-specific model name. When omitted the provider's default is used. */
  model?: string;
}

export interface GenerateRequest extends RequestBase {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface EmbedRequest extends RequestBase {
  input: string[];
}

export interface CallOptions {
  /** Aborting stops the call, and for streams stops reading the body. */
  signal?: AbortSignal;
  /** Timeout for one call. For streams it is the idle time allowed between chunks. */
  timeoutMs?: number;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface GenerateResult {
  text: string;
  provenance: Provenance;
  usage?: Usage;
  finishReason?: string;
}

export type StreamChunk =
  | { kind: "text"; text: string; provenance: Provenance }
  | { kind: "done"; provenance: Provenance; usage?: Usage; finishReason?: string };

export interface EmbedResult {
  embeddings: number[][];
  dimensions: number;
  provenance: Provenance;
}

export interface ModelInfo {
  id: string;
  kind: "chat" | "embed" | "unknown";
  sizeBytes?: number;
  /** True when the provider forwards this model's prompts to a remote host. */
  remote?: boolean;
}

export interface ProviderHealth {
  available: boolean;
  /** Short human-readable status. Never contains credentials. */
  detail: string;
  version?: string;
  latencyMs?: number;
}

export interface ModelProvider {
  readonly id: string;
  /** Shown to users. */
  readonly label: string;
  readonly locality: Locality;
  /**
   * True only for an adapter Phoenix itself vets as processing on this device (the built-in
   * Ollama adapter, which also refuses models that forward to a remote host). A loopback address
   * proves nothing about where a server sends the text, so it never sets this.
   */
  readonly trustedLocal?: boolean;
  readonly capabilities: ProviderCapabilities;
  readonly costTier: CostTier;
  /** Typical end-to-end latency, used only to order candidates. */
  readonly typicalLatencyMs: number;
  /** Whether an API key is needed. Absent = not applicable. */
  readonly keyPolicy?: KeyPolicy;
  /** Model used when a request names none. Absent = the server's first listed chat model. */
  readonly defaultModel?: string;
  /**
   * True = never chosen as an automatic fallback: only when the user routes a purpose to it or
   * prefers it. Providers the user added or that take a key are explicit-only.
   */
  readonly explicitOnly?: boolean;
  models(): Promise<ModelInfo[]>;
  generate(req: GenerateRequest, opts?: CallOptions): Promise<GenerateResult>;
  stream(req: GenerateRequest, opts?: CallOptions): AsyncIterable<StreamChunk>;
  embed(req: EmbedRequest, opts?: CallOptions): Promise<EmbedResult>;
  /** Never throws. Must not send a request that carries user data. */
  health(): Promise<ProviderHealth>;
}

/** "Ollama · llama3.2 · on this device" / "Anthropic · claude-… · cloud". */
export function processedByLabel(label: string, model: string, locality: Locality): string {
  return `${label} · ${model} · ${locality === "local" ? "on this device" : "cloud"}`;
}
