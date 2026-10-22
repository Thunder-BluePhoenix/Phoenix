// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What an agent's tokens cost, computed ONLY from prices the user entered. Phoenix hard-codes no
// price for any provider or model: a model without a price has an UNKNOWN cost (null), never zero.
import type { Price } from "@phoenix/ai-models";

/** User prices keyed by the model id an agent reports. */
export type AgentPrices = Record<string, Price>;

/** The largest price the user may enter (USD per million tokens); the AI settings use the same cap. */
export const MAX_AGENT_PRICE = 1_000_000;
export const MAX_AGENT_PRICES = 50;
/** Same shape the agent hook accepts for a model id. */
export const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,99}$/;

const isPrice = (value: unknown): value is Price =>
  typeof value === "object" &&
  value !== null &&
  "input_per_mtok" in value &&
  "output_per_mtok" in value &&
  typeof value.input_per_mtok === "number" &&
  typeof value.output_per_mtok === "number" &&
  Number.isFinite(value.input_per_mtok) &&
  Number.isFinite(value.output_per_mtok) &&
  value.input_per_mtok >= 0 &&
  value.output_per_mtok >= 0 &&
  value.input_per_mtok <= MAX_AGENT_PRICE &&
  value.output_per_mtok <= MAX_AGENT_PRICE;

/** Prices from settings: anything malformed is dropped (a damaged entry is "no price", not zero). */
export function readPrices(raw: unknown): AgentPrices {
  const out: AgentPrices = Object.create(null) as AgentPrices;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  for (const [model, price] of Object.entries(raw).slice(0, MAX_AGENT_PRICES)) {
    if (MODEL_ID.test(model) && isPrice(price))
      out[model] = { input_per_mtok: price.input_per_mtok, output_per_mtok: price.output_per_mtok };
  }
  return out;
}

/**
 * The price of `model`: the user's own agent price first; otherwise the price in the AI settings
 * (keyed `<provider>:<model>`) when exactly one distinct price exists for that model id. Several
 * different prices for one model id are ambiguous, so the cost stays unknown.
 */
export function priceFor(
  model: string,
  own: AgentPrices,
  ai: Readonly<Record<string, Price>>,
): Price | undefined {
  if (model === "") return undefined;
  if (Object.hasOwn(own, model)) return own[model];
  const found: Price[] = [];
  for (const [key, price] of Object.entries(ai)) {
    const colon = key.indexOf(":");
    if (colon < 0 || key.slice(colon + 1) !== model) continue;
    if (
      !found.some(
        (p) =>
          p.input_per_mtok === price.input_per_mtok && p.output_per_mtok === price.output_per_mtok,
      )
    )
      found.push(price);
  }
  return found.length === 1 ? found[0] : undefined;
}

/**
 * Millionths of a dollar for these tokens. USD per million tokens times tokens is already micro
 * dollars. Null when the price is unknown or either token count is not known.
 */
export function costMicro(
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  price: Price | undefined,
): number | null {
  if (!price || inputTokens === undefined || outputTokens === undefined) return null;
  const micro = Math.round(
    inputTokens * price.input_per_mtok + outputTokens * price.output_per_mtok,
  );
  return Number.isSafeInteger(micro) && micro >= 0 ? micro : null;
}
