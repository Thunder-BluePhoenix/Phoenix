// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Amounts and the rounding rule. Everything shown is display-only.
//
// ROUNDING RULE (also in the README): half away from zero, with a one-ulp nudge so values such as
// 1.005 that binary floating point stores just below the half round the way a person expects.
//   - an amount of a coin is rounded to 8 decimals;
//   - a price is kept to 8 significant digits;
//   - a holding's value is amount x price, rounded to cents;
//   - the total is the sum of the ROUNDED holding values, so the rows always add up to it;
//   - percentages are rounded to 2 decimals.

export function roundHalfUp(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  const magnitude = Math.abs(value);
  const nudged = magnitude + Number.EPSILON * Math.max(1, magnitude);
  return Math.sign(value) * (Math.round(nudged * factor) / factor);
}

/** A plain non-negative decimal string ("12", "0.5") as a number; anything else is undefined. */
export function decimalString(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d{1,30}(\.\d{1,30})?$/.test(value)) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * An integer count of the smallest unit (a decimal string, to keep 18-digit values exact) as whole
 * coins, rounded to 8 decimals. Undefined when it is not a non-negative integer string.
 */
export function scaledUnits(value: unknown, decimals: number): number | undefined {
  const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== "string" || !/^\d{1,40}$/.test(text)) return undefined;
  const unit = 10n ** BigInt(Math.max(decimals - 8, 0));
  const raw = BigInt(text);
  // Half-up in integer arithmetic at 8 decimals, then one division.
  const eighth = decimals > 8 ? (raw + unit / 2n) / unit : raw * 10n ** BigInt(8 - decimals);
  return Number(eighth) / 1e8;
}

/** 8 significant digits, for prices. */
export function significant(value: number): number {
  return Number.isFinite(value) ? Number(value.toPrecision(8)) : 0;
}
