// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The five supported exchanges. Each is listed ONLY because its documented balance endpoint is a
// GET that a read-only API key can call. The key and secret come from named secrets; requests are
// signed with HMAC from node:crypto. Spot/funding balances only. Shapes and signing recipes follow
// each exchange's public documentation and were NOT checked against the live services (README).
import { createHmac, createHash } from "node:crypto";
import { expectArray, expectObject, isObject, str } from "@phoenix/service-kit";
import { decimalString } from "./amount";

export interface ExchangeBalance {
  asset: string;
  amount: number;
}

export interface Credentials {
  key: string;
  secret: string;
  passphrase?: string;
}

export interface SignedRequest {
  /** Path and query, starting with "/". */
  path: string;
  headers: Record<string, string>;
}

export interface ExchangeSpec {
  id: string;
  name: string;
  /** Origin only: the signature covers the path, so a base URL with a path prefix would break it. */
  baseUrl: string;
  /** Secret names (manifest `secrets`) the exchange needs, key, secret, optional passphrase. */
  secrets: { key: string; secret: string; passphrase?: string };
  sign(credentials: Credentials, nowMs: number): SignedRequest;
  /** Balances with a non-zero amount. Throws when the body is unusable. */
  parse(body: unknown): ExchangeBalance[];
}

const RECV_WINDOW = "5000";
/** SHA-512 of the empty string: the "body hash" of a request without a body (Gate). */
const EMPTY_SHA512 = createHash("sha512").update("").digest("hex");

const hmacHex = (algo: "sha256" | "sha512", secret: string, text: string) =>
  createHmac(algo, secret).update(text).digest("hex");
const hmacBase64 = (secret: string, text: string) =>
  createHmac("sha256", secret).update(text).digest("base64");

function unusable(): never {
  throw new TypeError("unexpected response");
}

function balance(asset: unknown, ...parts: unknown[]): ExchangeBalance | undefined {
  const name = str(asset, 20)?.toUpperCase();
  if (!name) return undefined;
  let amount = 0;
  for (const part of parts) {
    const n = decimalString(part);
    if (n === undefined) return undefined;
    amount += n;
  }
  return amount > 0 ? { asset: name, amount } : undefined;
}

function collect(
  entries: unknown[],
  one: (entry: Record<string, unknown>) => ExchangeBalance | undefined,
) {
  return entries.flatMap((e) => {
    if (!isObject(e)) return [];
    const b = one(e);
    return b ? [b] : [];
  });
}

export const EXCHANGES: readonly ExchangeSpec[] = [
  {
    id: "binance",
    name: "Binance",
    baseUrl: "https://api.binance.com",
    secrets: { key: "binance_key", secret: "binance_secret" },
    sign(c, nowMs) {
      const query = `omitZeroBalances=true&recvWindow=${RECV_WINDOW}&timestamp=${nowMs}`;
      const signature = hmacHex("sha256", c.secret, query);
      return {
        path: `/api/v3/account?${query}&signature=${signature}`,
        headers: { "X-MBX-APIKEY": c.key },
      };
    },
    parse(body) {
      const { balances } = expectObject(body);
      return collect(expectArray(balances), (b) => balance(b.asset, b.free, b.locked));
    },
  },
  {
    id: "bybit",
    name: "Bybit",
    baseUrl: "https://api.bybit.com",
    secrets: { key: "bybit_key", secret: "bybit_secret" },
    sign(c, nowMs) {
      const query = "accountType=UNIFIED";
      const stamp = String(nowMs);
      const signature = hmacHex("sha256", c.secret, `${stamp}${c.key}${RECV_WINDOW}${query}`);
      return {
        path: `/v5/account/wallet-balance?${query}`,
        headers: {
          "X-BAPI-API-KEY": c.key,
          "X-BAPI-TIMESTAMP": stamp,
          "X-BAPI-RECV-WINDOW": RECV_WINDOW,
          "X-BAPI-SIGN": signature,
        },
      };
    },
    parse(body) {
      const o = expectObject(body);
      if (o.retCode !== 0) unusable();
      const { list } = expectObject(o.result);
      return expectArray(list).flatMap((account) =>
        isObject(account)
          ? collect(expectArray(account.coin), (b) => balance(b.coin, b.walletBalance))
          : [],
      );
    },
  },
  {
    id: "okx",
    name: "OKX",
    baseUrl: "https://www.okx.com",
    secrets: { key: "okx_key", secret: "okx_secret", passphrase: "okx_passphrase" },
    sign(c, nowMs) {
      const path = "/api/v5/account/balance";
      const stamp = new Date(nowMs).toISOString();
      return {
        path,
        headers: {
          "OK-ACCESS-KEY": c.key,
          "OK-ACCESS-SIGN": hmacBase64(c.secret, `${stamp}GET${path}`),
          "OK-ACCESS-TIMESTAMP": stamp,
          "OK-ACCESS-PASSPHRASE": c.passphrase ?? "",
        },
      };
    },
    parse(body) {
      const o = expectObject(body);
      if (o.code !== "0") unusable();
      return expectArray(o.data).flatMap((account) =>
        isObject(account)
          ? collect(expectArray(account.details), (b) => balance(b.ccy, b.cashBal))
          : [],
      );
    },
  },
  {
    id: "kucoin",
    name: "KuCoin",
    baseUrl: "https://api.kucoin.com",
    secrets: { key: "kucoin_key", secret: "kucoin_secret", passphrase: "kucoin_passphrase" },
    sign(c, nowMs) {
      const path = "/api/v1/accounts";
      const stamp = String(nowMs);
      return {
        path,
        headers: {
          "KC-API-KEY": c.key,
          "KC-API-SIGN": hmacBase64(c.secret, `${stamp}GET${path}`),
          "KC-API-TIMESTAMP": stamp,
          // Version 2 keys send the passphrase signed with the secret, not in the clear.
          "KC-API-PASSPHRASE": hmacBase64(c.secret, c.passphrase ?? ""),
          "KC-API-KEY-VERSION": "2",
        },
      };
    },
    parse(body) {
      const o = expectObject(body);
      if (o.code !== "200000") unusable();
      return collect(expectArray(o.data), (b) => balance(b.currency, b.balance));
    },
  },
  {
    id: "gate",
    name: "Gate",
    baseUrl: "https://api.gateio.ws",
    secrets: { key: "gate_key", secret: "gate_secret" },
    sign(c, nowMs) {
      const path = "/api/v4/spot/accounts";
      const stamp = String(Math.floor(nowMs / 1000));
      const payload = `GET\n${path}\n\n${EMPTY_SHA512}\n${stamp}`;
      return {
        path,
        headers: { KEY: c.key, Timestamp: stamp, SIGN: hmacHex("sha512", c.secret, payload) },
      };
    },
    parse(body) {
      return collect(expectArray(body), (b) => balance(b.currency, b.available, b.locked));
    },
  },
];

export const EXCHANGE_IDS: readonly string[] = EXCHANGES.map((e) => e.id);

const BY_ID = new Map(EXCHANGES.map((e) => [e.id, e]));

export function exchangeById(id: string): ExchangeSpec | undefined {
  return BY_ID.get(id);
}

/** Every secret name the capability declares, for the manifest. */
export function exchangeSecretNames(): string[] {
  return EXCHANGES.flatMap((e) => Object.values(e.secrets));
}
