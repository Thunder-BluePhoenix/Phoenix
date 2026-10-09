// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { ContextEngine } from "@phoenix/ai-context";
import type { Viewer } from "@phoenix/ai-memory";

export interface LookupItem {
  text: string;
  source: string;
  observedAt: string;
}

export interface LookupRequest {
  query: string;
  limit: number;
  signal: AbortSignal;
}

/** Context lookup for `lookup` steps. Items are untrusted data like any tool output. */
export type ContextLookup = (request: LookupRequest) => Promise<LookupItem[]>;

export const LOOKUP_TOKEN_BUDGET = 1500;

/**
 * Lookup over the context engine, as the given viewer. The viewer is the workflow's own grant
 * (supplied by the runtime), never the device owner by default: a workflow reads what it was
 * given access to and nothing else.
 */
export function lookupFromContext(engine: ContextEngine, viewer: Viewer): ContextLookup {
  return async ({ query, limit }) =>
    engine
      .assemble({ question: query, viewer, limit, tokenBudget: LOOKUP_TOKEN_BUDGET })
      .items.map((i) => ({ text: i.text, source: i.source, observedAt: i.observedAt }));
}
