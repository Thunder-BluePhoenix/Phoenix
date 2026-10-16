// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { AnthropicProvider } from "./anthropic";
import { GEMINI_ID, GeminiProvider } from "./gemini";
import type { FetchLike } from "./http";
import { OllamaProvider } from "./ollama";
import { OPENAI_COMPATIBLE_PRESETS, OpenAiCompatibleProvider } from "./openai-compatible";
import type { ModelProvider } from "./types";

/** A server the user added: any OpenAI-compatible endpoint. Locality is derived from `base_url`. */
export interface Endpoint {
  /** `^[a-z][a-z0-9-]{1,23}$`; also the id in routing and in the key's SecretStore ref. */
  id: string;
  /** Shown to the user, 1-40 characters. */
  label: string;
  base_url: string;
  /** Takes that preset's default model and token-limit field name. */
  preset?: string;
}

/** Ids a user-added endpoint may not take. */
export const RESERVED_PROVIDER_IDS: readonly string[] = [
  "ollama",
  "anthropic",
  GEMINI_ID,
  ...OPENAI_COMPATIBLE_PRESETS.map((p) => p.id),
];

/** Most endpoints a user may add. */
export const MAX_ENDPOINTS = 8;

/** In-memory set of providers, keyed by id. */
export class ProviderRegistry {
  private readonly byId: Record<string, ModelProvider> = {};

  register(provider: ModelProvider): void {
    if (Object.hasOwn(this.byId, provider.id)) {
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        `Provider ${provider.id} is already registered`,
      );
    }
    this.byId[provider.id] = provider;
  }

  get(id: string): ModelProvider | undefined {
    // Own keys only: "__proto__" or "constructor" must not resolve to an Object.prototype member.
    return Object.hasOwn(this.byId, id) ? this.byId[id] : undefined;
  }

  /** Removes a provider. Used when the user deletes or replaces an endpoint they added. */
  unregister(id: string): void {
    delete this.byId[id];
  }

  /** Providers in id order, so plans do not depend on registration order. */
  list(): ModelProvider[] {
    return Object.values(this.byId).sort((a, b) => a.id.localeCompare(b.id));
  }
}

export interface DefaultProviderOptions {
  /** Ollama base URL. Must be loopback. Defaults to http://127.0.0.1:11434. */
  ollamaUrl?: string;
  /** Returns the Anthropic API key (from the OS secret store), or undefined if none is set. */
  anthropicKey?: () => Promise<string | undefined>;
  /** Anthropic base URL; for tests only. */
  anthropicUrl?: string;
  /**
   * Returns the API key of any other keyed provider (OpenAI, Gemini, user endpoints...) by id, from
   * the OS secret store. A provider with no key set must resolve to undefined.
   */
  keyFor?: (providerId: string) => Promise<string | undefined>;
  fetch?: FetchLike;
}

const NO_KEY = () => Promise.resolve(undefined);

/** Builds the provider for a user-added endpoint. Throws a ModelError for an unsafe URL. */
export function createEndpointProvider(
  endpoint: Endpoint,
  options: Pick<DefaultProviderOptions, "keyFor" | "fetch"> = {},
): OpenAiCompatibleProvider {
  const preset = OPENAI_COMPATIBLE_PRESETS.find((p) => p.id === endpoint.preset);
  return new OpenAiCompatibleProvider({
    id: endpoint.id,
    label: endpoint.label,
    baseUrl: endpoint.base_url,
    defaultModel: preset?.defaultModel,
    maxTokensField: preset?.maxTokensField,
    getKey: () => (options.keyFor ?? NO_KEY)(endpoint.id),
    fetch: options.fetch,
  });
}

/**
 * Ollama (local), Anthropic, Gemini and the OpenAI-compatible presets. Cloud providers are always
 * registered so the UI can show them, but AiService only ever reaches one when the user chose it
 * AND the grant and the opt-in allow it.
 */
export function createDefaultProviders(options: DefaultProviderOptions = {}): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(new OllamaProvider({ baseUrl: options.ollamaUrl, fetch: options.fetch }));
  registry.register(
    new AnthropicProvider({
      baseUrl: options.anthropicUrl,
      getKey: options.anthropicKey ?? (() => Promise.resolve(undefined)),
      fetch: options.fetch,
    }),
  );
  registry.register(
    new GeminiProvider({
      getKey: () => (options.keyFor ?? NO_KEY)(GEMINI_ID),
      fetch: options.fetch,
    }),
  );
  for (const preset of OPENAI_COMPATIBLE_PRESETS) {
    registry.register(
      new OpenAiCompatibleProvider({
        id: preset.id,
        label: preset.label,
        baseUrl: preset.baseUrl,
        defaultModel: preset.defaultModel,
        maxTokensField: preset.maxTokensField,
        getKey: () => (options.keyFor ?? NO_KEY)(preset.id),
        fetch: options.fetch,
      }),
    );
  }
  return registry;
}
