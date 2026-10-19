// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

export interface PortfolioHolding {
  source: string;
  kind: "network" | "exchange";
  label: string;
  asset: string;
  amount: number;
  price_usd?: number;
  value_usd?: number;
  change_24h_pct?: number;
  sparkline?: number[];
}

export interface PortfolioSource {
  id: string;
  name: string;
  kind: "network" | "exchange";
  ok: boolean;
  error?: string;
}

/** What the portfolio capability's `snapshot` command reports, after `readSnapshot`. */
export interface PortfolioSnapshot {
  updated_at: string | null;
  total_usd?: number;
  change_24h_pct?: number;
  sparkline?: number[];
  holdings: PortfolioHolding[];
  sources: PortfolioSource[];
  unpriced: number;
  price_source: string;
  note: string;
}

const NO_VALUE = "\u2014";
const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const AMOUNT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 8,
});
const SMALLEST_AMOUNT = 1e-8;

/** "$1,234.50"; a missing or non-finite value reads "—". */
export function formatUsd(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? NO_VALUE : USD.format(value);
}

/** "+1.23%", "-0.50%", "0.00%" (a change that rounds to nothing carries no sign). */
export function formatPct(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return NO_VALUE;
  const fixed = value.toFixed(2);
  if (Number(fixed) === 0) return "0.00%";
  return `${value > 0 ? "+" : ""}${fixed}%`;
}

/** Up to 8 decimals without trailing zeros: "0.5", "1,234.12345678". */
export function formatAmount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return NO_VALUE;
  if (value > 0 && value < SMALLEST_AMOUNT) return `<${AMOUNT.format(SMALLEST_AMOUNT)}`;
  return AMOUNT.format(value);
}

/** The sign a change is announced with, so colour is never the only cue. */
export function changeDirection(value: number | undefined): "up" | "down" | "flat" {
  if (value === undefined || !Number.isFinite(value) || Number(value.toFixed(2)) === 0)
    return "flat";
  return value > 0 ? "up" : "down";
}

/**
 * An SVG path `d` for a line through `values`, scaled into width × height (y grows downward, so
 * the highest value is at the top). Non-finite points are dropped; fewer than two left → undefined.
 * A constant series is a flat line in the middle.
 */
export function sparklinePath(
  values: readonly number[],
  width: number,
  height: number,
): string | undefined {
  if (!(width > 0 && height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return undefined;
  }
  const points = values.filter((v) => Number.isFinite(v));
  if (points.length < 2) return undefined;
  const min = Math.min(...points);
  const span = Math.max(...points) - min;
  const step = width / (points.length - 1);
  return points
    .map((v, i) => {
      const y = span === 0 ? height / 2 : height - ((v - min) / span) * height;
      return `${i === 0 ? "M" : "L"}${(i * step).toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const kind = (v: unknown): "network" | "exchange" => (v === "exchange" ? "exchange" : "network");
const series = (v: unknown): number[] | undefined =>
  Array.isArray(v) ? v.filter((n): n is number => typeof n === "number") : undefined;
const records = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
    : [];

/** A `snapshot` result checked field by field: wrong types are dropped, lists default to empty. */
export function readSnapshot(raw: unknown): PortfolioSnapshot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  return {
    updated_at: typeof r.updated_at === "string" ? r.updated_at : null,
    total_usd: num(r.total_usd),
    change_24h_pct: num(r.change_24h_pct),
    sparkline: series(r.sparkline),
    holdings: records(r.holdings).map((h) => ({
      source: str(h.source),
      kind: kind(h.kind),
      label: str(h.label),
      asset: str(h.asset),
      amount: num(h.amount) ?? 0,
      price_usd: num(h.price_usd),
      value_usd: num(h.value_usd),
      change_24h_pct: num(h.change_24h_pct),
      sparkline: series(h.sparkline),
    })),
    sources: records(r.sources).map((s) => ({
      id: str(s.id),
      name: str(s.name),
      kind: kind(s.kind),
      ok: s.ok === true,
      error: typeof s.error === "string" ? s.error : undefined,
    })),
    unpriced: num(r.unpriced) ?? 0,
    price_source: str(r.price_source),
    note: str(r.note),
  };
}
