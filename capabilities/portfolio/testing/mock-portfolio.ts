// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// One local server standing in for every public indexer, exchange and the price service. Response
// bodies are written from each service's public documentation (field names only); nothing was
// recorded from a live service. Every request is recorded so tests can prove only GET was used and
// where credentials went. Exchange routes recompute the signature from the documented recipe and
// answer 401 when it does not match, so a wrong signing layout fails a test.
import { createHash, createHmac } from "node:crypto";
import { startMockService, type MockHandler, type MockService } from "@phoenix/service-kit/testing";

/** Fake credentials, built at runtime (no credential-shaped literal in the tree). */
export const FAKE_KEY = ["fake", "read", "only", "key"].join("-");
export const FAKE_SECRET = ["fake", "read", "only", "secret"].join("-");
export const FAKE_PASSPHRASE = ["fake", "pass", "phrase"].join("-");

export const ADDRESSES = {
  btc: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
  eth: "0x" + "ab".repeat(20),
  xrp: "r" + "9".repeat(25),
  trx: "T" + "9".repeat(33),
};

export interface MockPortfolio extends MockService {
  /** The origin to give as a config endpoint for `id`: all ids share one server. */
  endpoint(id: string): string;
  state: MockState;
  /** The query string of the last price request. */
  marketsQuery(): string;
}

export interface MockState {
  /** CoinGecko-style rows by id; undefined fields are omitted. */
  markets: {
    id: string;
    current_price: number;
    price_change_percentage_24h?: number;
    points?: number[];
  }[];
  /** Network id → address → raw response (status + body). */
  accounts: Record<string, Record<string, { status?: number; body: unknown }>>;
  /** Exchange id → balance rows in that exchange's own shape. */
  exchangeBodies: Record<string, unknown>;
  /** Status to answer every exchange call with (default 200 after a valid signature). */
  exchangeStatus: number;
}

const hex = (algo: string, secret: string, text: string) =>
  createHmac(algo, secret).update(text).digest("hex");
const b64 = (secret: string, text: string) =>
  createHmac("sha256", secret).update(text).digest("base64");

function ramp(n: number, from: number, to: number): number[] {
  return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
}

export function defaultState(): MockState {
  return {
    markets: [
      {
        id: "bitcoin",
        current_price: 60_000,
        price_change_percentage_24h: 2,
        points: ramp(168, 58_000, 60_000),
      },
      {
        id: "ethereum",
        current_price: 3_000,
        price_change_percentage_24h: -1,
        points: ramp(168, 3_100, 3_000),
      },
      {
        id: "ripple",
        current_price: 0.5,
        price_change_percentage_24h: 0,
        points: ramp(168, 0.5, 0.5),
      },
      { id: "tether", current_price: 1, price_change_percentage_24h: 0, points: ramp(168, 1, 1) },
    ],
    accounts: {},
    exchangeBodies: {},
    exchangeStatus: 200,
  };
}

export async function startMockPortfolio(
  initial: MockState = defaultState(),
): Promise<MockPortfolio> {
  const state = initial;
  let lastMarketsQuery = "";
  const handler: MockHandler = (req) => {
    if (req.method !== "GET") return { status: 405, body: { error: "GET only" } };
    const url = new URL(req.path, "http://mock");
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.pathname === "/api/v3/coins/markets") {
      lastMarketsQuery = url.search;
      return {
        body: state.markets.map((m) => ({
          id: m.id,
          current_price: m.current_price,
          ...(m.price_change_percentage_24h !== undefined
            ? { price_change_percentage_24h: m.price_change_percentage_24h }
            : {}),
          sparkline_in_7d: { price: m.points ?? [] },
        })),
      };
    }
    const id = parts[1] ?? "";
    const rest = url.pathname.slice(`/x/${id}`.length) + url.search;
    if (parts[0] !== "x") return undefined;
    const exchange = exchangeReply(id, rest, req.headers, state);
    if (exchange) return exchange;
    const accounts = state.accounts[id];
    if (!accounts) return undefined;
    // The address is a path segment (or the `address` query value); the other segments are fixed.
    const candidates = [
      ...rest.split("?")[0]!.split("/").filter(Boolean),
      url.searchParams.get("address") ?? "",
    ];
    const known = candidates
      .map((c) => decodeURIComponent(c))
      .find((c) => Object.hasOwn(accounts, c));
    const entry = known === undefined ? undefined : accounts[known];
    if (!entry) return { status: 404, body: { error: "not found" } };
    return { status: entry.status ?? 200, body: entry.body };
  };
  const server = await startMockService(handler);
  return {
    ...server,
    endpoint: (id) => `${server.url}/x/${id}`,
    state,
    marketsQuery: () => lastMarketsQuery,
  };
}

type Headers = Record<string, string | string[] | undefined>;
const header = (h: Headers, name: string) => {
  const v = h[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};

function exchangeReply(id: string, rest: string, h: Headers, state: MockState) {
  const body = state.exchangeBodies[id];
  const deny = { status: 401, body: { error: "bad signature" } };
  if (id === "binance") {
    const [path, query = ""] = rest.split("?");
    const signed = query.replace(/&signature=[0-9a-f]+$/, "");
    const given = /signature=([0-9a-f]+)$/.exec(query)?.[1];
    const ok =
      path === "/api/v3/account" &&
      header(h, "x-mbx-apikey") === FAKE_KEY &&
      given === hex("sha256", FAKE_SECRET, signed);
    return ok ? { status: state.exchangeStatus, body } : deny;
  }
  if (id === "bybit") {
    const query = rest.split("?")[1] ?? "";
    const stamp = header(h, "x-bapi-timestamp") ?? "";
    const window = header(h, "x-bapi-recv-window") ?? "";
    const ok =
      header(h, "x-bapi-sign") ===
        hex("sha256", FAKE_SECRET, `${stamp}${FAKE_KEY}${window}${query}`) &&
      header(h, "x-bapi-api-key") === FAKE_KEY;
    return ok ? { status: state.exchangeStatus, body } : deny;
  }
  if (id === "okx") {
    const stamp = header(h, "ok-access-timestamp") ?? "";
    const ok =
      header(h, "ok-access-sign") === b64(FAKE_SECRET, `${stamp}GET${rest}`) &&
      header(h, "ok-access-passphrase") === FAKE_PASSPHRASE &&
      header(h, "ok-access-key") === FAKE_KEY;
    return ok ? { status: state.exchangeStatus, body } : deny;
  }
  if (id === "kucoin") {
    const stamp = header(h, "kc-api-timestamp") ?? "";
    const ok =
      header(h, "kc-api-sign") === b64(FAKE_SECRET, `${stamp}GET${rest}`) &&
      header(h, "kc-api-passphrase") === b64(FAKE_SECRET, FAKE_PASSPHRASE) &&
      header(h, "kc-api-key") === FAKE_KEY;
    return ok ? { status: state.exchangeStatus, body } : deny;
  }
  if (id === "gate") {
    const stamp = header(h, "timestamp") ?? "";
    const empty = createHash("sha512").update("").digest("hex");
    const ok =
      header(h, "sign") === hex("sha512", FAKE_SECRET, `GET\n${rest}\n\n${empty}\n${stamp}`) &&
      header(h, "key") === FAKE_KEY;
    return ok ? { status: state.exchangeStatus, body } : deny;
  }
  return undefined;
}
