// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Stripe capability (Phase 67): recent payments as stripe.payment.* events and a balance/payments
// summary, nothing else. READ-ONLY BY CONSTRUCTION: the manifest declares no command that writes,
// and the client is a `ReadOnlyClient` (GET only). Use a restricted API key with read access only.
import { defineCapability, type CapabilityContext, type HealthResult } from "@phoenix/sdk";
import {
  nextDelay,
  realSleep,
  safeBaseUrl,
  ServiceError,
  startPolling,
  type ServiceItem,
  type ServiceStatus,
  type Sleep,
} from "@phoenix/service-kit";
import { createStripeClient, getBalance, listCharges, SERVICE, STRIPE_API } from "./client";
import { chargeTracker, diffCharges } from "./events";
import { formatMoney, type Balance, type Charge, type Money } from "./parse";

export * from "./client";
export * from "./events";
export * from "./parse";

export const DEFAULT_POLL_MS = 60_000;
export const MIN_POLL_MS = 15_000;
export const CHARGES_PER_POLL = 25;
const MAX_STATUS_ITEMS = 10;
/** Pattern for a URL value in config: https, or http to loopback; no credentials/query/fragment. */
const URL_PATTERN =
  "^(https://[^\\s@?#]+|http://(127\\.0\\.0\\.1|localhost)(:[0-9]+)?(/[^\\s@?#]*)?)$";

export interface StripeCapabilityOptions {
  /** Epoch ms clock; tests pin it. */
  now?: () => number;
  /** Waits between polls; resolves early when `signal` aborts. Tests control time with it. */
  sleep?: Sleep;
}

interface Settings {
  baseUrl: string | undefined;
  pollMs: number;
}

function settings(ctx: CapabilityContext): Settings {
  const { base_url, poll_ms } = ctx.config;
  return {
    baseUrl: typeof base_url === "string" ? safeBaseUrl(base_url) : STRIPE_API,
    pollMs: typeof poll_ms === "number" ? Math.max(poll_ms, MIN_POLL_MS) : DEFAULT_POLL_MS,
  };
}

/** Totals of one currency over the charges Phoenix looked at. */
export interface CurrencyTotal {
  currency: string;
  count: number;
  /** Smallest unit. */
  amount: number;
  display: string;
}

export interface PaymentSummary {
  /** How many of the latest charges were counted (Stripe returns newest first). */
  charges_counted: number;
  succeeded: { count: number; totals: CurrencyTotal[] };
  failed: { count: number; totals: CurrencyTotal[] };
  pending: { count: number };
}

export interface MoneyView extends Money {
  display: string;
}

export interface StripeStatus extends ServiceStatus {
  summary?: PaymentSummary;
  balance?: { available: MoneyView[]; pending: MoneyView[] };
}

function totals(charges: readonly Charge[]): CurrencyTotal[] {
  const by: Record<string, CurrencyTotal> = {};
  for (const c of charges) {
    const t = (by[c.currency] ??= { currency: c.currency, count: 0, amount: 0, display: "" });
    t.count++;
    t.amount += c.amount;
  }
  return Object.values(by)
    .map((t) => ({ ...t, display: formatMoney(t.amount, t.currency) }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

export function summarise(charges: readonly Charge[]): PaymentSummary {
  const of = (status: Charge["status"]) => charges.filter((c) => c.status === status);
  return {
    charges_counted: charges.length,
    succeeded: { count: of("succeeded").length, totals: totals(of("succeeded")) },
    failed: { count: of("failed").length, totals: totals(of("failed")) },
    pending: { count: of("pending").length },
  };
}

const view = (m: Money): MoneyView => ({ ...m, display: formatMoney(m.amount, m.currency) });

function balanceView(b: Balance): NonNullable<StripeStatus["balance"]> {
  return { available: b.available.map(view), pending: b.pending.map(view) };
}

function item(c: Charge): ServiceItem {
  return {
    id: c.id,
    title: formatMoney(c.amount, c.currency),
    state: c.refunded ? "refunded" : c.status,
    ...(c.failureCode ? { detail: c.failureCode } : {}),
    ...(c.url ? { url: c.url } : {}),
    at: new Date(c.createdAt).toISOString(),
  };
}

function asServiceError(err: unknown): ServiceError {
  return err instanceof ServiceError
    ? err
    : new ServiceError(SERVICE, "http", `Unexpected error while talking to ${SERVICE}`);
}

/** A fresh capability instance (its own watcher state); Phoenix Core uses one per runtime. */
export function createStripeCapability(options: StripeCapabilityOptions = {}) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;

  let tracker = chargeTracker(0);
  let polled = false;
  let hasSecret = false;
  let failure: ServiceError | undefined;
  let failures = 0;
  let lastCount = 0;

  async function cycle(ctx: CapabilityContext): Promise<number> {
    const s = settings(ctx);
    const secret = await ctx.secret("restricted_key");
    hasSecret = !!secret;
    failure = undefined;
    if (secret && s.baseUrl) {
      try {
        const client = createStripeClient({ baseUrl: s.baseUrl, secret, signal: ctx.signal });
        const charges = await listCharges(client, CHARGES_PER_POLL);
        lastCount = charges.length;
        for (const event of diffCharges(tracker, charges)) void ctx.emit(event);
      } catch (err) {
        failure = asServiceError(err);
      }
    }
    polled = true;
    failures = failure ? failures + 1 : 0;
    return nextDelay(s.pollMs, failures, failure);
  }

  return defineCapability({
    manifest: {
      id: "stripe",
      name: "Stripe",
      version: "0.1.0",
      description:
        "Recent Stripe payments (succeeded and failed) as events, plus a summary of payment counts, amounts and your balance. READ-ONLY by construction: it only sends GET requests, has no command that changes anything and cannot move money. Create a restricted API key with read-only access (Charges, Balance) in the Stripe dashboard and use that, never your secret key.",
      license: "GPL-3.0-or-later",
      homepage: "https://github.com/Thunder-BluePhoenix/Phoenix",
      events: ["stripe.payment.*"],
      permissions: ["network", "external_api"],
      data_categories: ["payment amounts, currencies and outcomes", "Stripe balance"],
      healthcheck: { interval_ms: 15_000 },
      secrets: [
        {
          name: "restricted_key",
          description:
            "A Stripe restricted API key with READ-ONLY access to Charges and Balance (Developers, API keys, Create restricted key). Do not use your secret key. Phoenix never sends it anywhere but the Stripe API and never logs it.",
        },
      ],
      commands: [
        {
          name: "status",
          description:
            "Counts and amounts of your latest Stripe payments (succeeded, failed, pending) and your balance. Read-only.",
          side_effect: "read",
          permissions: ["network", "external_api"],
          timeout_ms: 30_000,
        },
      ],
      config_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          base_url: {
            type: "string",
            pattern: URL_PATTERN,
            description: `API base URL (default ${STRIPE_API}). Plain http is only accepted for localhost.`,
          },
          poll_ms: {
            type: "integer",
            minimum: MIN_POLL_MS,
            maximum: 3_600_000,
            description: `Milliseconds between checks (default ${DEFAULT_POLL_MS})`,
          },
        },
      },
      state_rules: [
        {
          match: "stripe.payment.succeeded",
          effect: { state: "SUCCESS", explain: "Payment received: {subject}", ttlMs: 8_000 },
        },
        {
          match: "stripe.payment.failed",
          effect: { state: "WARNING", explain: "Payment failed: {subject}", ttlMs: 60_000 },
        },
      ],
    },
    init(ctx) {
      polled = false;
      failure = undefined;
      failures = 0;
      lastCount = 0;
      // History rule: anything created before this moment is background, not news.
      tracker = chargeTracker(now());
      startPolling(ctx, () => cycle(ctx), sleep);
    },
    commands: {
      async status(_input, ctx): Promise<StripeStatus> {
        const secret = await ctx.secret("restricted_key");
        if (!secret) {
          return {
            configured: false,
            items: [],
            note: "Add a restricted read-only Stripe key in Settings",
          };
        }
        const { baseUrl } = settings(ctx);
        if (!baseUrl)
          throw new ServiceError(SERVICE, "invalid", "base_url must be https or loopback");
        try {
          const client = createStripeClient({ baseUrl, secret, signal: ctx.signal });
          const [charges, balance] = await Promise.all([
            listCharges(client, CHARGES_PER_POLL),
            getBalance(client),
          ]);
          return {
            configured: true,
            items: charges.slice(0, MAX_STATUS_ITEMS).map(item),
            summary: summarise(charges),
            balance: balanceView(balance),
          };
        } catch (err) {
          throw asServiceError(err);
        }
      },
    },
    health(ctx): HealthResult {
      if (!settings(ctx).baseUrl) {
        return { status: "unhealthy", message: "base_url must be https or loopback" };
      }
      if (!polled) return { status: "healthy", message: "Reading Stripe…" };
      if (!hasSecret)
        return { status: "degraded", message: "Add a restricted read-only Stripe key in Settings" };
      if (
        failure?.kind === "auth" ||
        failure?.kind === "rate_limit" ||
        failure?.kind === "forbidden"
      ) {
        return { status: "degraded", message: failure.message };
      }
      if (failure) return { status: "unhealthy", message: failure.message };
      return { status: "healthy", message: `Watching ${lastCount} recent payments (read-only)` };
    },
  });
}
