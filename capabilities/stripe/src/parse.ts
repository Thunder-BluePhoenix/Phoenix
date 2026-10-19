// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Validation of Stripe REST responses. Only what Phoenix shows is kept: ids, status, amount,
// currency, time and the receipt link. Customer names, e-mail addresses, card details,
// descriptions and metadata are never read, so they cannot end up in an event, a log or the graph.
import { redact } from "@phoenix/logging";
import {
  epochMs,
  expectObject,
  httpsUrl,
  int,
  isObject,
  parseList,
  str,
  type Json,
} from "@phoenix/service-kit";

const CHARGE_ID = /^(?:ch|py)_[A-Za-z0-9]{1,100}$/;
const CURRENCY = /^[a-z]{3}$/;
const CODE = /^[a-z0-9_]{1,64}$/;

/** Most charges read per poll. */
export const MAX_CHARGES = 100;

export type ChargeStatus = "succeeded" | "pending" | "failed";

export interface Charge {
  id: string;
  status: ChargeStatus;
  /** Smallest currency unit (cents), as Stripe sends it. */
  amount: number;
  /** Lower-case ISO 4217. */
  currency: string;
  /** Epoch ms. */
  createdAt: number;
  refunded: boolean;
  livemode: boolean;
  /** Stripe's machine-readable failure code, e.g. "card_declined". */
  failureCode?: string | undefined;
  /** https link to the receipt, when Stripe gives one. */
  url?: string | undefined;
}

export interface Money {
  currency: string;
  amount: number;
}

export interface Balance {
  available: Money[];
  pending: Money[];
}

const ZERO_DECIMAL: Readonly<Record<string, true>> = {
  bif: true,
  clp: true,
  djf: true,
  gnf: true,
  jpy: true,
  kmf: true,
  krw: true,
  mga: true,
  pyg: true,
  rwf: true,
  ugx: true,
  vnd: true,
  vuv: true,
  xaf: true,
  xof: true,
  xpf: true,
};
const THREE_DECIMAL: Readonly<Record<string, true>> = {
  bhd: true,
  jod: true,
  kwd: true,
  omr: true,
  tnd: true,
};

/** "12.34 USD" from Stripe's minor units. Counts and amounts are all Phoenix shows. */
export function formatMoney(amount: number, currency: string): string {
  const code = currency.toLowerCase();
  const digits = Object.hasOwn(ZERO_DECIMAL, code) ? 0 : Object.hasOwn(THREE_DECIMAL, code) ? 3 : 2;
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  const text = digits === 0 ? String(abs) : (abs / 10 ** digits).toFixed(digits);
  return `${sign}${text} ${code.toUpperCase()}`;
}

function chargeStatus(raw: Json): ChargeStatus | undefined {
  const status = str(raw.status, 20);
  return status === "succeeded" || status === "pending" || status === "failed" ? status : undefined;
}

/**
 * A remote value that must stay exactly as sent (an id, a code, a link): kept only when a secret
 * scan would not redact anything in it, otherwise dropped, so it can never make Core refuse the
 * whole event.
 */
function plain(value: string | undefined): string | undefined {
  return value !== undefined && String(redact(value)) === value ? value : undefined;
}

export function parseCharge(raw: Json): Charge | undefined {
  const id = plain(str(raw.id, 120));
  const status = chargeStatus(raw);
  const amount = int(raw.amount);
  const currency = str(raw.currency, 10)?.toLowerCase();
  const createdAt = epochMs(raw.created);
  if (
    !id ||
    !CHARGE_ID.test(id) ||
    status === undefined ||
    amount === undefined ||
    currency === undefined ||
    !CURRENCY.test(currency) ||
    createdAt === undefined
  ) {
    return undefined;
  }
  const code = plain(str(raw.failure_code, 64));
  return {
    id,
    status,
    amount,
    currency,
    createdAt,
    refunded: raw.refunded === true,
    livemode: raw.livemode === true,
    failureCode: code !== undefined && CODE.test(code) ? code : undefined,
    url: plain(httpsUrl(raw.receipt_url)),
  };
}

/** GET /v1/charges: `{ object: "list", data: [...] }`. Broken entries are skipped. */
export function parseCharges(body: unknown): Charge[] {
  return parseList(expectObject(body).data, parseCharge, MAX_CHARGES);
}

function parseMoneyList(value: unknown): Money[] {
  return parseList(
    value,
    (raw) => {
      const amount = int(raw.amount);
      const currency = str(raw.currency, 10)?.toLowerCase();
      return amount !== undefined && currency !== undefined && CURRENCY.test(currency)
        ? { currency, amount }
        : undefined;
    },
    30,
  );
}

/** GET /v1/balance: `{ available: [{amount, currency}], pending: [...] }`. */
export function parseBalance(body: unknown): Balance {
  const raw = expectObject(body);
  if (!isObject(raw) || !Array.isArray(raw.available) || !Array.isArray(raw.pending)) {
    throw new TypeError("balance has no available/pending lists");
  }
  return { available: parseMoneyList(raw.available), pending: parseMoneyList(raw.pending) };
}
