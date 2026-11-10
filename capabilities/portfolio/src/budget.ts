// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Keeps one poll cycle inside the documented request budget of a keyless public indexer
// (docs/service-terms.md, read 2026-11-10; a reading of public pages, not legal advice). The budget is
// per host because the services count per IP: Litecoin and Dogecoin share BlockCypher's.
import type { NetworkSpec } from "./networks";

const HOUR_MS = 3_600_000;

/** Requests one cycle sends to each network: the native balance, plus the token read when listed. */
function perCycle(
  addresses: readonly string[],
  tokens: { watch: readonly unknown[] } | undefined,
  spec: NetworkSpec,
): number {
  return addresses.length * (spec.tokens && tokens && tokens.watch.length > 0 ? 2 : 1);
}

/**
 * The shortest delay between cycles that keeps every budgeted host at or under its documented requests
 * per hour. A network whose address was replaced through `endpoints` is the owner's own endpoint and
 * is not held to the public service's budget. Solana's public RPC allows 40 requests per 10 s for one
 * method, which the request spacing in solana.ts already keeps, so it adds nothing here.
 */
export function minCycleMs(
  networks: ReadonlyMap<NetworkSpec, readonly string[]>,
  tokens: ReadonlyMap<NetworkSpec, { watch: readonly unknown[] }>,
  endpoints: Readonly<Record<string, string>>,
): number {
  const perHost = new Map<string, { requests: number; perHour: number }>();
  for (const [spec, addresses] of networks) {
    if (!spec.maxRequestsPerHour || endpoints[spec.id] !== undefined) continue;
    const seen = perHost.get(spec.baseUrl);
    const requests = (seen?.requests ?? 0) + perCycle(addresses, tokens.get(spec), spec);
    perHost.set(spec.baseUrl, { requests, perHour: spec.maxRequestsPerHour });
  }
  let min = 0;
  for (const { requests, perHour } of perHost.values()) {
    min = Math.max(min, Math.ceil((requests * HOUR_MS) / perHour));
  }
  return min;
}
