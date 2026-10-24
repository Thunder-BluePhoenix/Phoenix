// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Pure: balances + quotes → the snapshot the UI shows. Rounding rule: see amount.ts.
import { roundHalfUp } from "./amount";
import { SPARKLINE_POINTS, SYMBOLS, type Quote } from "./prices";

export interface Holding {
  source: string;
  kind: "network" | "exchange";
  label: string;
  asset: string;
  amount: number;
  /** Token holdings only: the exact amount as decimal text (a number cannot hold every digit). */
  amount_exact?: string;
  /** Set for a token from the owner's watch list. Tokens are never priced: a symbol is not an identity. */
  token?: true;
  price_usd?: number;
  value_usd?: number;
  change_24h_pct?: number;
  sparkline?: number[];
}

export interface SourceStatus {
  id: string;
  name: string;
  kind: "network" | "exchange";
  ok: boolean;
  error?: string;
}

export interface Snapshot {
  updated_at: string | null;
  total_usd?: number;
  change_24h_pct?: number;
  sparkline?: number[];
  holdings: Holding[];
  sources: SourceStatus[];
  unpriced: number;
  price_source: string;
  note: string;
}

export interface RawHolding {
  source: string;
  kind: "network" | "exchange";
  label: string;
  asset: string;
  amount: number;
  amount_exact?: string;
  token?: true;
}

/** The CoinGecko id of an asset, or undefined when Phoenix has no price mapping for it. */
export function coinId(asset: string): string | undefined {
  return Object.hasOwn(SYMBOLS, asset) ? SYMBOLS[asset] : undefined;
}

export function priceHoldings(
  raw: readonly RawHolding[],
  quotes: ReadonlyMap<string, Quote>,
): { holdings: Holding[]; unpriced: number } {
  let unpriced = 0;
  const holdings = raw.map((h): Holding => {
    const id = h.token ? undefined : coinId(h.asset);
    const quote = id ? quotes.get(id) : undefined;
    if (!quote) {
      unpriced++;
      return { ...h, amount: roundHalfUp(h.amount, 8) };
    }
    const amount = roundHalfUp(h.amount, 8);
    return {
      ...h,
      amount,
      price_usd: quote.price_usd,
      value_usd: roundHalfUp(amount * quote.price_usd, 2),
      ...(quote.change_24h_pct !== undefined
        ? { change_24h_pct: roundHalfUp(quote.change_24h_pct, 2) }
        : {}),
      ...(quote.sparkline ? { sparkline: quote.sparkline } : {}),
    };
  });
  holdings.sort(
    (a, b) => (b.value_usd ?? -1) - (a.value_usd ?? -1) || a.label.localeCompare(b.label),
  );
  return { holdings, unpriced };
}

/**
 * Total = sum of the rounded holding values (so the rows add up). 24h change is the value-weighted
 * change over the holdings that have a 24h figure. The aggregate sparkline adds
 * amount x price per point and exists only when EVERY priced holding has a full-length series.
 */
export function totals(
  holdings: readonly Holding[],
): Pick<Snapshot, "total_usd" | "change_24h_pct" | "sparkline"> {
  const priced = holdings.filter((h) => h.value_usd !== undefined);
  if (priced.length === 0) return {};
  const total = roundHalfUp(
    priced.reduce((sum, h) => sum + (h.value_usd ?? 0), 0),
    2,
  );
  let now = 0;
  let before = 0;
  for (const h of priced) {
    if (h.change_24h_pct === undefined || h.value_usd === undefined) continue;
    const factor = 1 + h.change_24h_pct / 100;
    if (factor <= 0) continue;
    now += h.value_usd;
    before += h.value_usd / factor;
  }
  const change = before > 0 ? roundHalfUp((now / before - 1) * 100, 2) : undefined;
  const complete = priced.every((h) => h.sparkline?.length === SPARKLINE_POINTS);
  const sparkline = complete
    ? Array.from({ length: SPARKLINE_POINTS }, (_, i) =>
        roundHalfUp(
          priced.reduce((sum, h) => sum + h.amount * (h.sparkline?.[i] ?? 0), 0),
          2,
        ),
      )
    : undefined;
  return {
    total_usd: total,
    ...(change !== undefined ? { change_24h_pct: change } : {}),
    ...(sparkline ? { sparkline } : {}),
  };
}
