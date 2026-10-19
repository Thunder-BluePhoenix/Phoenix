// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Prices, 24-hour change and the 7-day sparkline for every asset held, from ONE public GET call
// to CoinGecko's `coins/markets` endpoint (no key). These are third-party estimates, shown as
// such: Phoenix does not verify them. An asset missing from SYMBOLS has no price and is counted as
// "unpriced" rather than guessed.
import { expectArray, num, parseList, str } from "@phoenix/service-kit";
import { readJson } from "./client";
import { significant } from "./amount";

export const DEFAULT_PRICE_URL = "https://api.coingecko.com";
export const PRICE_SOURCE_NAME = "CoinGecko public API (coins/markets)";
const SERVICE = "Price service";
/** Points kept per sparkline (the service sends ~168 hourly points for 7 days). */
export const SPARKLINE_POINTS = 42;

/** Ticker → CoinGecko coin id. Static, small, reviewed by hand. */
export const SYMBOLS: Readonly<Record<string, string>> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  LTC: "litecoin",
  DOGE: "dogecoin",
  POL: "polygon-ecosystem-token",
  XDAI: "xdai",
  ETC: "ethereum-classic",
  XRP: "ripple",
  XLM: "stellar",
  ALGO: "algorand",
  TON: "the-open-network",
  TRX: "tron",
  ATOM: "cosmos",
  USDT: "tether",
  USDC: "usd-coin",
  DAI: "dai",
  BNB: "binancecoin",
  SOL: "solana",
  ADA: "cardano",
  AVAX: "avalanche-2",
  DOT: "polkadot",
  LINK: "chainlink",
  SHIB: "shiba-inu",
  BCH: "bitcoin-cash",
  XMR: "monero",
  FIL: "filecoin",
  NEAR: "near",
  APT: "aptos",
  ARB: "arbitrum",
  OP: "optimism",
  KCS: "kucoin-shares",
  OKB: "okb",
  GT: "gate-token",
};

export interface Quote {
  price_usd: number;
  change_24h_pct?: number;
  sparkline?: number[];
}

/** `n` points picked evenly from `values`, always keeping the first and the last. */
export function downsample(values: readonly number[], n: number): number[] {
  if (values.length <= n) return [...values];
  return Array.from(
    { length: n },
    (_, i) => values[Math.round((i * (values.length - 1)) / (n - 1))]!,
  );
}

function parseMarkets(body: unknown): Map<string, Quote> {
  const out = new Map<string, Quote>();
  const rows = parseList(
    expectArray(body),
    (row) => {
      const id = str(row.id, 80);
      const price = num(row.current_price);
      if (!id || price === undefined || price < 0) return undefined;
      const change = num(row.price_change_percentage_24h);
      const spark = row.sparkline_in_7d;
      const series =
        typeof spark === "object" &&
        spark !== null &&
        Array.isArray((spark as { price?: unknown }).price)
          ? ((spark as { price: unknown[] }).price.filter(
              (p): p is number => typeof p === "number" && Number.isFinite(p),
            ) as number[])
          : [];
      return {
        id,
        quote: {
          price_usd: significant(price),
          ...(change !== undefined ? { change_24h_pct: change } : {}),
          ...(series.length >= 2
            ? { sparkline: downsample(series, SPARKLINE_POINTS).map(significant) }
            : {}),
        } satisfies Quote,
      };
    },
    250,
  );
  for (const r of rows) out.set(r.id, r.quote);
  return out;
}

/** Quotes by CoinGecko id for the coins asked about; ids the service does not know are absent. */
export async function fetchQuotes(
  baseUrl: string,
  coinIds: readonly string[],
  signal?: AbortSignal,
): Promise<Map<string, Quote>> {
  if (coinIds.length === 0) return new Map();
  const ids = encodeURIComponent([...new Set(coinIds)].sort().join(","));
  return readJson(
    {
      service: SERVICE,
      baseUrl,
      path: `/api/v3/coins/markets?vs_currency=usd&ids=${ids}&per_page=250&sparkline=true&price_change_percentage=24h`,
      ...(signal ? { signal } : {}),
    },
    parseMarkets,
  );
}
