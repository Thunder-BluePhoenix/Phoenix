// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { AnthropicProvider } from "./anthropic";
import type { FetchLike } from "./http";
import { OllamaProvider } from "./ollama";
import type { ModelProvider } from "./types";

/** In-memory set of providers, keyed by id. */
export class ProviderRegistry {
  private readonly byId: Record<string, ModelProvider> = {};

  register(provider: ModelProvider): void {
    if (this.byId[provider.id] !== undefined) {
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        `Provider ${provider.id} is already registered`,
      );
    }
    this.byId[provider.id] = provider;
  }

  get(id: string): ModelProvider | undefined {
    return this.byId[id];
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
  fetch?: FetchLike;
}

/**
 * Ollama (local) and Anthropic (cloud). The cloud provider is always registered so the UI can
 * show it, but AiService only ever reaches it when the grant and the opt-in allow it.
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
  return registry;
}
