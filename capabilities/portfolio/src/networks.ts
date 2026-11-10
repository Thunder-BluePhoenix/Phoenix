// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The 16 supported networks. Each is one public explorer/indexer GET endpoint that answers for a
// public address without a key. JSON-RPC style endpoints are not used here: they need a request body
// (the one exception, Solana's getBalance, has its own tiny client in solana.ts). Native coin, plus
// owner-listed tokens where `tokens` is set. Response shapes come from each service's public documentation and
// were NOT checked against the live services (see README).
import { expectObject, int, isObject, seg, str } from "@phoenix/service-kit";
import { decimalString, scaledUnits } from "./amount";
import {
  algorandAssets,
  cosmosDenoms,
  evmTokens,
  stellarTokens,
  tonJettons,
  trc20,
  xrplTokens,
  type TokenSupport,
} from "./tokens";

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
  /**
   * How owner-listed tokens are read on this network. Absent: not supported (see the README for why
   * each of those networks is missing).
   */
  tokens?: TokenSupport;
  /**
   * The service allows about one request per second to a keyless client, so the requests of this
   * network (native balance and tokens, every address) are issued one at a time with at least this
   * gap between them.
   */
  minIntervalMs?: number;
  /**
   * The documented request budget per hour for a keyless client, per host (docs/service-terms.md). The
   * poll delay is raised so one cycle never exceeds it (budget.ts). Absent: no limit is documented.
   */
  maxRequestsPerHour?: number;
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
    tokens: evmTokens,
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
    // https://www.blockcypher.com/dev/bitcoin/ (Rate Limits and Tokens): the free tier allows 3
    // requests per second and 100 per hour, counted per IP with or without a token.
    minIntervalMs: 400,
    maxRequestsPerHour: 100,
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
    tokens: xrplTokens,
    // https://docs.xrpscan.com/api-documentation/pricing.md: the free tier is 10,000 requests a day.
    // Licence CC BY-NC-SA 4.0 (introduction page): personal, non-commercial display only.
    maxRequestsPerHour: Math.floor(10_000 / 24),
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
    tokens: stellarTokens,
    // https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/rate-limiting: the
    // default per-IP limit is 3,600 requests an hour. The mainnet instance's own limit is not stated on
    // the pages read, so the default is assumed.
    maxRequestsPerHour: 3600,
  },
  {
    id: "algo",
    name: "Algorand",
    asset: "ALGO",
    baseUrl: "https://mainnet-api.algonode.cloud",
    address: /^[A-Z2-7]{58}$/,
    path: (a) => `/v2/accounts/${seg(a)}`,
    parse: (body) => amount(scaledUnits(expectObject(body).amount, 6)),
    tokens: algorandAssets,
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
    tokens: tonJettons,
    // https://docs.ton.org/api/rate-limit : without an API key, 1 request per second.
    minIntervalMs: 1100,
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
    tokens: trc20,
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
    tokens: cosmosDenoms,
  },
];

export const NETWORK_IDS: readonly string[] = NETWORKS.map((n) => n.id);

const BY_ID = new Map(NETWORKS.map((n) => [n.id, n]));

export function networkById(id: string): NetworkSpec | undefined {
  return BY_ID.get(id);
}
