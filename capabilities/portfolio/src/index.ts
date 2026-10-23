// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Portfolio capability (Phase 68): a READ-ONLY view of crypto balances. Public addresses and
// read-only exchange keys only. Every request is a GET made through service-kit's ReadOnlyClient
// (it has no method that sends a body); there is no code anywhere in this package that creates an
// instruction to move or exchange funds. A test scans src/ for that and fails if it changes.
import { createHash } from "node:crypto";
import { defineCapability, type CapabilityContext, type HealthResult } from "@phoenix/sdk";
import { ServiceError, nextDelay, realSleep, startPolling, type Sleep } from "@phoenix/service-kit";
import { collect } from "./collect";
import { EXCHANGES, exchangeSecretNames, type Credentials, type ExchangeSpec } from "./exchanges";
import { NETWORKS, networkById, type NetworkSpec } from "./networks";
import { DEFAULT_PRICE_URL, PRICE_SOURCE_NAME, fetchQuotes, type Quote } from "./prices";
import { coinId, priceHoldings, totals, type Snapshot } from "./snapshot";

export * from "./amount";
export * from "./coinbase-jwt";
export * from "./collect";
export * from "./exchanges";
export * from "./networks";
export * from "./prices";
export * from "./snapshot";

export const DEFAULT_POLL_MS = 300_000;
export const MIN_POLL_MS = 60_000;
export const MAX_ADDRESSES_PER_NETWORK = 10;

const URL_PATTERN = "^(https://[^\\s]+|http://(127\\.0\\.0\\.1|localhost)(:[0-9]+)?(/[^\\s]*)?)$";

export const NOTE =
  "Display only. Prices are third-party estimates (CoinGecko public API) that Phoenix does not verify; amounts are rounded half-up to 8 decimals and values to cents. Phoenix never places or moves anything.";

export interface PortfolioCapabilityOptions {
  /** Epoch ms clock; tests pin it (also used to sign exchange requests). */
  now?: () => number;
  sleep?: Sleep;
  /**
   * Replacement origins for exchanges, by exchange id. Code only, deliberately NOT a config
   * setting: signed requests carry the exchange key, which may only go to the exchange's own host.
   * Tests pass a loopback mock here.
   */
  exchangeUrls?: Readonly<Record<string, string>>;
}

interface Settings {
  networks: Map<NetworkSpec, string[]>;
  exchanges: ExchangeSpec[];
  endpoints: Record<string, string>;
  priceUrl: string;
  pollMs: number;
}

function settings(ctx: CapabilityContext): Settings {
  const { networks, exchanges, endpoints, price_url, poll_ms } = ctx.config;
  const chosen = new Map<NetworkSpec, string[]>();
  if (typeof networks === "object" && networks !== null) {
    for (const [id, list] of Object.entries(networks)) {
      const spec = networkById(id);
      if (!spec || !Array.isArray(list)) continue;
      const valid = list.filter((a): a is string => typeof a === "string" && spec.address.test(a));
      if (valid.length) chosen.set(spec, [...new Set(valid)].slice(0, MAX_ADDRESSES_PER_NETWORK));
    }
  }
  const wanted = new Set(Array.isArray(exchanges) ? exchanges : []);
  const urls: Record<string, string> = {};
  if (typeof endpoints === "object" && endpoints !== null) {
    for (const [id, url] of Object.entries(endpoints)) if (typeof url === "string") urls[id] = url;
  }
  return {
    networks: chosen,
    exchanges: EXCHANGES.filter((e) => wanted.has(e.id)),
    endpoints: urls,
    priceUrl: typeof price_url === "string" ? price_url : DEFAULT_PRICE_URL,
    pollMs: typeof poll_ms === "number" ? Math.max(poll_ms, MIN_POLL_MS) : DEFAULT_POLL_MS,
  };
}

async function credentialsFor(
  ctx: CapabilityContext,
  spec: ExchangeSpec,
): Promise<Credentials | undefined> {
  const key = await ctx.secret(spec.secrets.key);
  const secret = await ctx.secret(spec.secrets.secret);
  if (!key || !secret) return undefined;
  if (!spec.secrets.passphrase) return { key, secret };
  const passphrase = await ctx.secret(spec.secrets.passphrase);
  return passphrase ? { key, secret, passphrase } : undefined;
}

function emptySnapshot(): Snapshot {
  return {
    updated_at: null,
    holdings: [],
    sources: [],
    unpriced: 0,
    price_source: PRICE_SOURCE_NAME,
    note: NOTE,
  };
}

/** Changes whenever a figure on screen would: the event is sent only then. */
function fingerprint(s: Snapshot): string {
  const shown = JSON.stringify([s.total_usd, s.holdings, s.sources, s.unpriced]);
  return createHash("sha256").update(shown).digest("hex");
}

/** A fresh capability instance (its own cache); Phoenix Core uses one per runtime. */
export function createPortfolioCapability(options: PortfolioCapabilityOptions = {}) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;
  const exchangeUrls = options.exchangeUrls ?? {};

  let snapshot: Snapshot = emptySnapshot();
  let polled = false;
  let inflight: Promise<void> | null = null;
  let shown = "";
  let failure: ServiceError | undefined;
  let failures = 0;

  async function cycle(ctx: CapabilityContext): Promise<void> {
    const cfg = settings(ctx);
    const gathered = await collect({
      networks: cfg.networks,
      exchanges: cfg.exchanges,
      endpoints: cfg.endpoints,
      exchangeUrls,
      credentials: (spec) => credentialsFor(ctx, spec),
      now,
      signal: ctx.signal,
    });
    let sources = gathered.sources;
    let quotes = new Map<string, Quote>();
    const ids = gathered.holdings.flatMap((h) => coinId(h.asset) ?? []);
    let priceFailure: ServiceError | undefined;
    try {
      quotes = await fetchQuotes(cfg.priceUrl, ids, ctx.signal);
    } catch (err) {
      priceFailure = err instanceof ServiceError ? err : undefined;
      sources = [
        ...sources,
        {
          id: "prices",
          name: "Price service",
          kind: "network",
          ok: false,
          error: priceFailure?.message ?? "Prices could not be read",
        },
      ];
    }
    const { holdings, unpriced } = priceHoldings(gathered.holdings, quotes);
    snapshot = {
      updated_at: new Date(now()).toISOString(),
      ...totals(holdings),
      holdings,
      sources,
      unpriced,
      price_source: PRICE_SOURCE_NAME,
      note: NOTE,
    };
    failure = gathered.failure ?? priceFailure;
    polled = true;
    const next = fingerprint(snapshot);
    if (next !== shown) {
      shown = next;
      // Ephemeral and carrying no amounts: it only tells the open window to ask again.
      void ctx.emit(
        {
          event_type: "portfolio.snapshot.updated",
          severity: "info",
          correlation_id: "portfolio-snapshot",
          subject: "Portfolio updated",
          data_classification: "sensitive",
          payload: {
            holdings: holdings.length,
            sources_failed: sources.filter((s) => !s.ok).length,
          },
        },
        { ephemeral: true },
      );
    }
  }

  function refresh(ctx: CapabilityContext): Promise<void> {
    return (inflight ??= cycle(ctx)
      .catch((err: unknown) => {
        failure =
          err instanceof ServiceError
            ? err
            : new ServiceError("Portfolio", "http", "Unexpected error while reading the portfolio");
      })
      .finally(() => (inflight = null)));
  }

  return defineCapability({
    manifest: {
      id: "portfolio",
      name: "Portfolio",
      version: "0.1.0",
      description:
        "Read-only crypto portfolio: balances of public addresses on 16 networks and of 6 exchanges (read-only API keys), with 7-day sparklines and 24-hour change. Display only. It can only read: nothing in it can place, move or exchange funds. Prices are third-party estimates that Phoenix does not verify.",
      license: "GPL-3.0-or-later",
      homepage: "https://github.com/Thunder-BluePhoenix/Phoenix",
      events: ["portfolio.snapshot.*"],
      permissions: ["network", "external_api"],
      data_categories: [
        "public wallet addresses",
        "balances and holdings",
        "exchange account balances (read-only keys)",
      ],
      healthcheck: { interval_ms: 60_000 },
      secrets: exchangeSecretNames().map((name) => ({
        name,
        description:
          name === "coinbase_key"
            ? "Coinbase API key NAME of a view-only key, in the form organizations/{org}/apiKeys/{key}. Create the key with the ECDSA signature algorithm (not Ed25519) and the View permission only."
            : name === "coinbase_secret"
              ? "Coinbase API key private key (ECDSA, P-256, PEM) of that view-only key, pasted on ONE line with the line breaks written as \\n, as the CDP portal shows it. Phoenix signs a fresh short-lived token for each read and never sends the key itself."
              : name.endsWith("_passphrase")
                ? "API key passphrase of the read-only key (OKX and KuCoin require one)."
                : name.endsWith("_secret")
                  ? "API secret of a READ-ONLY key: create the key with the read permission only and every other permission off."
                  : "API key of a READ-ONLY key: create the key with the read permission only and every other permission off.",
      })),
      commands: [
        {
          name: "snapshot",
          description:
            "Balances, values in USD, 24-hour change and 7-day sparklines of everything configured. Read-only (GET only); reads the cached result of the last check.",
          side_effect: "read",
          permissions: ["network", "external_api"],
          timeout_ms: 60_000,
          input_schema: { type: "object", additionalProperties: false, properties: {} },
        },
      ],
      config_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          networks: {
            type: "object",
            additionalProperties: false,
            description:
              "Public addresses to watch, by network id. Addresses are public data, not secrets.",
            properties: Object.fromEntries(
              NETWORKS.map((n) => [
                n.id,
                {
                  type: "array",
                  maxItems: MAX_ADDRESSES_PER_NETWORK,
                  uniqueItems: true,
                  items: { type: "string", pattern: n.address.source },
                  description: `${n.name} (${n.asset}) addresses`,
                },
              ]),
            ),
          },
          exchanges: {
            type: "array",
            uniqueItems: true,
            items: { enum: EXCHANGES.map((e) => e.id) },
            description:
              "Exchanges to read. Each needs its read-only key (and secret, and passphrase where required) stored as secrets.",
          },
          endpoints: {
            type: "object",
            additionalProperties: false,
            description:
              "Replacement origins for a network's public indexer (for a self-hosted indexer). Those requests carry no credential. Exchanges cannot be redirected here: their signed requests, and the keys with them, only ever go to the exchange's own host.",
            properties: Object.fromEntries(
              NETWORKS.map((n) => [n.id, { type: "string", pattern: URL_PATTERN }]),
            ),
          },
          price_url: {
            type: "string",
            pattern: URL_PATTERN,
            description: `Origin of a CoinGecko-compatible price service (default ${DEFAULT_PRICE_URL}).`,
          },
          poll_ms: {
            type: "integer",
            minimum: MIN_POLL_MS,
            maximum: 3_600_000,
            description: `Milliseconds between checks while Phoenix is open (default ${DEFAULT_POLL_MS}).`,
          },
        },
      },
    },
    init(ctx) {
      snapshot = emptySnapshot();
      polled = false;
      shown = "";
      failure = undefined;
      failures = 0;
      startPolling(
        ctx,
        async () => {
          await refresh(ctx);
          failures = failure ? failures + 1 : 0;
          return nextDelay(settings(ctx).pollMs, failures, failure);
        },
        sleep,
      );
    },
    commands: {
      async snapshot(_input, ctx) {
        if (!polled) await refresh(ctx);
        return snapshot;
      },
    },
    health(ctx): HealthResult {
      const cfg = settings(ctx);
      if (cfg.networks.size === 0 && cfg.exchanges.length === 0) {
        return { status: "degraded", message: "No addresses or exchanges configured" };
      }
      if (!polled) return { status: "healthy", message: "Reading balances…" };
      const broken = snapshot.sources.filter((s) => !s.ok).map((s) => s.name);
      if (broken.length)
        return { status: "degraded", message: `Cannot read: ${broken.join(", ")}` };
      return {
        status: "healthy",
        message: `Watching ${cfg.networks.size} networks and ${cfg.exchanges.length} exchanges`,
      };
    },
  });
}
