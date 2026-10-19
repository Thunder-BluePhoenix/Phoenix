// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The 16 supported networks. Each is one public explorer/indexer GET endpoint that answers for a
// public address without a key. JSON-RPC style endpoints are not used: they need a request body.
// Native coin only (no tokens). Response shapes come from each service's public documentation and
// were NOT checked against the live services (see README).
import { expectObject, int, isObject, seg, str } from "@phoenix/service-kit";
import { decimalString, scaledUnits } from "./amount";

export interface NetworkSpec {
  id: string;
  name: string;
  /** Ticker of the native coin, the key into the price table. */
  asset: string;
  /** Public indexer origin (plus any fixed path prefix). A config `endpoints` entry replaces it. */
  baseUrl: string;
  address: RegExp;
  /** Path and query for an address that already matched `address`. */
  path(address: string): string;
  /** Whole coins held, from the response body. Throws when the body is unusable. */
  parse(body: unknown): number;
  /** The service answers 404 for an account that was never funded: that is a zero balance. */
  missingIsZero?: boolean;
}

function unusable(): never {
  throw new TypeError("unexpected response");
}

function amount(value: number | undefined): number {
  return value ?? unusable();
}

function evm(id: string, name: string, asset: string, host: string): NetworkSpec {
  return {
    id,
    name,
    asset,
    baseUrl: `https://${host}`,
    missingIsZero: true,
    address: /^0x[0-9a-fA-F]{40}$/,
    path: (a) => `/api/v2/addresses/${seg(a)}`,
    parse(body) {
      const { coin_balance } = expectObject(body);
      // An address the chain has never seen has no balance field: zero.
      return coin_balance === null || coin_balance === undefined
        ? 0
        : amount(scaledUnits(coin_balance, 18));
    },
  };
}

function blockcypher(
  id: string,
  name: string,
  asset: string,
  chain: string,
  address: RegExp,
): NetworkSpec {
  return {
    id,
    name,
    asset,
    baseUrl: "https://api.blockcypher.com",
    missingIsZero: true,
    address,
    path: (a) => `/v1/${chain}/main/addrs/${seg(a)}/balance`,
    parse: (body) => amount(scaledUnits(expectObject(body).balance, 8)),
  };
}

const BASE58 = "[1-9A-HJ-NP-Za-km-z]";
const BECH32 = "[02-9ac-hj-np-z]";

export const NETWORKS: readonly NetworkSpec[] = [
  {
    id: "btc",
    name: "Bitcoin",
    asset: "BTC",
    baseUrl: "https://blockstream.info/api",
    address: new RegExp(`^(bc1${BECH32}{20,87}|[13]${BASE58}{25,34})$`),
    path: (a) => `/address/${seg(a)}`,
    parse(body) {
      const stats = expectObject(expectObject(body).chain_stats);
      const funded = int(stats.funded_txo_sum) ?? unusable();
      const spent = int(stats.spent_txo_sum) ?? unusable();
      return amount(scaledUnits(Math.max(funded - spent, 0), 8));
    },
  },
  blockcypher(
    "ltc",
    "Litecoin",
    "LTC",
    "ltc",
    new RegExp(`^(ltc1${BECH32}{20,87}|[LM3]${BASE58}{26,33})$`),
  ),
  blockcypher("doge", "Dogecoin", "DOGE", "doge", new RegExp(`^D${BASE58}{33}$`)),
  evm("eth", "Ethereum", "ETH", "eth.blockscout.com"),
  evm("optimism", "Optimism", "ETH", "optimism.blockscout.com"),
  evm("base", "Base", "ETH", "base.blockscout.com"),
  evm("arbitrum", "Arbitrum One", "ETH", "arbitrum.blockscout.com"),
  evm("polygon", "Polygon", "POL", "polygon.blockscout.com"),
  evm("gnosis", "Gnosis Chain", "XDAI", "gnosis.blockscout.com"),
  evm("etc", "Ethereum Classic", "ETC", "etc.blockscout.com"),
  {
    id: "xrp",
    name: "XRP Ledger",
    asset: "XRP",
    baseUrl: "https://api.xrpscan.com",
    address: new RegExp(`^r${BASE58}{24,34}$`),
    path: (a) => `/api/v1/account/${seg(a)}`,
    parse(body) {
      const o = expectObject(body);
      return amount(decimalString(o.xrpBalance ?? o.XRPBalance));
    },
    missingIsZero: true,
  },
  {
    id: "xlm",
    name: "Stellar",
    asset: "XLM",
    baseUrl: "https://horizon.stellar.org",
    address: /^G[A-Z2-7]{55}$/,
    path: (a) => `/accounts/${seg(a)}`,
    parse(body) {
      const { balances } = expectObject(body);
      if (!Array.isArray(balances)) return unusable();
      const native = balances.find((b) => isObject(b) && str(b.asset_type) === "native");
      return amount(isObject(native) ? decimalString(native.balance) : undefined);
    },
    missingIsZero: true,
  },
  {
    id: "algo",
    name: "Algorand",
    asset: "ALGO",
    baseUrl: "https://mainnet-api.algonode.cloud",
    address: /^[A-Z2-7]{58}$/,
    path: (a) => `/v2/accounts/${seg(a)}`,
    parse: (body) => amount(scaledUnits(expectObject(body).amount, 6)),
  },
  {
    id: "ton",
    name: "TON",
    asset: "TON",
    baseUrl: "https://toncenter.com",
    address: /^[EU]Q[A-Za-z0-9_-]{46}$/,
    path: (a) => `/api/v2/getAddressBalance?address=${encodeURIComponent(a)}`,
    parse(body) {
      const o = expectObject(body);
      if (o.ok !== true) return unusable();
      return amount(scaledUnits(o.result, 9));
    },
  },
  {
    id: "trx",
    name: "TRON",
    asset: "TRX",
    baseUrl: "https://api.trongrid.io",
    address: new RegExp(`^T${BASE58}{33}$`),
    path: (a) => `/v1/accounts/${seg(a)}`,
    parse(body) {
      const { data } = expectObject(body);
      if (!Array.isArray(data)) return unusable();
      // An account that was never activated is simply absent from `data`.
      const first: unknown = data[0];
      return first === undefined ? 0 : amount(scaledUnits(expectObject(first).balance ?? 0, 6));
    },
  },
  {
    id: "atom",
    name: "Cosmos Hub",
    asset: "ATOM",
    baseUrl: "https://cosmos-rest.publicnode.com",
    address: new RegExp(`^cosmos1${BECH32}{38}$`),
    path: (a) => `/cosmos/bank/v1beta1/balances/${seg(a)}`,
    parse(body) {
      const { balances } = expectObject(body);
      if (!Array.isArray(balances)) return unusable();
      const uatom = balances.find((b) => isObject(b) && str(b.denom) === "uatom");
      return isObject(uatom) ? amount(scaledUnits(uatom.amount, 6)) : 0;
    },
  },
];

export const NETWORK_IDS: readonly string[] = NETWORKS.map((n) => n.id);

const BY_ID = new Map(NETWORKS.map((n) => [n.id, n]));

export function networkById(id: string): NetworkSpec | undefined {
  return BY_ID.get(id);
}
