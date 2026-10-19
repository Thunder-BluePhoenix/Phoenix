// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Reads balances: one GET per configured address on a network, one signed GET per exchange.
// A source that fails is reported and skipped; it never fails the others.
import { ServiceError } from "@phoenix/service-kit";
import { readJson } from "./client";
import { type Credentials, type ExchangeSpec } from "./exchanges";
import type { NetworkSpec } from "./networks";
import type { RawHolding, SourceStatus } from "./snapshot";

export interface Collected {
  holdings: RawHolding[];
  sources: SourceStatus[];
  /** The most telling failure of the cycle, for back-off. */
  failure?: ServiceError;
}

export interface CollectInput {
  /** Network spec → the addresses the user listed for it. */
  networks: ReadonlyMap<NetworkSpec, readonly string[]>;
  exchanges: readonly ExchangeSpec[];
  /** Replacement origins for credential-free public indexers, by network id (from config). */
  endpoints: Readonly<Record<string, string>>;
  /**
   * Replacement origins for exchanges, by exchange id. Signed requests (and the key with them) go
   * there, so this comes from code only, never from config.
   */
  exchangeUrls: Readonly<Record<string, string>>;
  credentials(exchange: ExchangeSpec): Promise<Credentials | undefined>;
  now(): number;
  signal: AbortSignal;
}

/** "bc1qxy…x4f9": enough to recognise an address, not all of it. */
export function shortAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function describeFailure(err: unknown): { message: string; error?: ServiceError } {
  if (err instanceof ServiceError) return { message: err.message, error: err };
  // A parser rejecting a body arrives here only through the client, which already wraps it; this
  // is the unexpected case. Nothing of the error is shown: it could carry remote text.
  return { message: "Unexpected error while reading this source" };
}

interface SourceRead {
  holdings: RawHolding[];
  status: SourceStatus;
  failure?: ServiceError;
}

async function networkHoldings(
  spec: NetworkSpec,
  addresses: readonly string[],
  endpoints: Readonly<Record<string, string>>,
  signal: AbortSignal,
): Promise<SourceRead> {
  const holdings: RawHolding[] = [];
  const status: SourceStatus = { id: spec.id, name: spec.name, kind: "network", ok: true };
  let failure: ServiceError | undefined;
  for (const address of addresses) {
    try {
      const coins = await readJson(
        {
          service: spec.name,
          baseUrl: endpoints[spec.id] ?? spec.baseUrl,
          path: spec.path(address),
          signal,
        },
        spec.parse,
      );
      if (coins > 0) {
        holdings.push({
          source: spec.id,
          kind: "network",
          label: `${spec.name} ${shortAddress(address)}`,
          asset: spec.asset,
          amount: coins,
        });
      }
    } catch (err) {
      if (err instanceof ServiceError && err.kind === "not_found" && spec.missingIsZero) continue;
      const described = describeFailure(err);
      status.ok = false;
      status.error = described.message;
      failure ??= described.error;
    }
  }
  return { holdings, status, ...(failure ? { failure } : {}) };
}

async function exchangeHoldings(spec: ExchangeSpec, input: CollectInput): Promise<SourceRead> {
  const status: SourceStatus = { id: spec.id, name: spec.name, kind: "exchange", ok: true };
  const credentials = await input.credentials(spec);
  if (!credentials) {
    status.ok = false;
    status.error = `Add the ${spec.name} read-only key and secret in Settings`;
    return { holdings: [], status };
  }
  try {
    const request = spec.sign(credentials, input.now());
    const balances = await readJson(
      {
        service: spec.name,
        baseUrl: input.exchangeUrls[spec.id] ?? spec.baseUrl,
        path: request.path,
        headers: request.headers,
        signal: input.signal,
      },
      spec.parse,
    );
    // One row per asset: spot and funding accounts may list the same asset twice.
    const byAsset = new Map<string, number>();
    for (const b of balances) byAsset.set(b.asset, (byAsset.get(b.asset) ?? 0) + b.amount);
    return {
      holdings: [...byAsset].map(([asset, amount]) => ({
        source: spec.id,
        kind: "exchange" as const,
        label: spec.name,
        asset,
        amount,
      })),
      status,
    };
  } catch (err) {
    const described = describeFailure(err);
    status.ok = false;
    status.error = described.message;
    return { holdings: [], status, ...(described.error ? { failure: described.error } : {}) };
  }
}

export async function collect(input: CollectInput): Promise<Collected> {
  const jobs: Promise<SourceRead>[] = [];
  for (const [spec, addresses] of input.networks) {
    jobs.push(networkHoldings(spec, addresses, input.endpoints, input.signal));
  }
  for (const spec of input.exchanges) jobs.push(exchangeHoldings(spec, input));
  const done = await Promise.all(jobs);
  const failure = done.find((d) => d.failure)?.failure;
  return {
    holdings: done.flatMap((d) => d.holdings),
    sources: done.map((d) => d.status),
    ...(failure ? { failure } : {}),
  };
}
