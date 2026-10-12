// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { AIProviderConstraint } from "@phoenix/protocol";

/** Implementations must validate actual destination and model locality, not trust metadata alone.
 * In particular a local Ollama endpoint must refuse remote/cloud models before input transfer.
 * No SDK method automatically forwards confidential, internal or restricted data to cloud.
 */
export interface CapabilityModelProvider {
  readonly provider: AIProviderConstraint;
  generate(input: string, options?: { signal?: AbortSignal }): Promise<string>;
}

export interface CapabilityEmbeddingProvider {
  readonly provider: AIProviderConstraint;
  embed(input: string, options?: { signal?: AbortSignal }): Promise<readonly number[]>;
}
