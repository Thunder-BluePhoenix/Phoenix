// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phoenix model layer (Phase 27): provider-agnostic generate / stream / embed, a deterministic
// router and the external-AI gate. Optional for Core: nothing in Core imports this package, and
// with `enabled: false` AiService makes no network call at all.
export * from "./types";
export * from "./errors";
export * from "./gate";
export * from "./router";
export * from "./registry";
export * from "./service";
export {
  AnthropicProvider,
  ANTHROPIC_ID,
  ANTHROPIC_VERSION,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_ANTHROPIC_URL,
  assertSafeAnthropicUrl,
  type AnthropicOptions,
} from "./anthropic";
export {
  OllamaProvider,
  OLLAMA_ID,
  DEFAULT_OLLAMA_URL,
  DEFAULT_OLLAMA_CHAT_MODEL,
  DEFAULT_OLLAMA_EMBED_MODEL,
  assertLoopbackOllamaUrl,
  type OllamaOptions,
} from "./ollama";
export type { FetchLike } from "./http";
