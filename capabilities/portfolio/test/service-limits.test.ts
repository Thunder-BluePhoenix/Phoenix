// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The Portfolio poll defaults must stay inside the documented limits of the public indexers
// (docs/service-terms.md, read 2026-11-10; not legal advice).
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_POLL_MS,
  MIN_POLL_MS,
  NETWORKS,
  SOLANA_MIN_INTERVAL_MS,
  MAX_ADDRESSES_PER_NETWORK,
  minCycleMs,
  networkById,
  type NetworkSpec,
} from "../src";

function spec(id: string): NetworkSpec {
  const found = networkById(id);
  if (!found) throw new Error(`no network ${id}`);
  return found;
}

const HOUR = 3_600_000;

describe("documented indexer budgets", () => {
  it("records the documented per-hour budgets", () => {
    expect(spec("ltc").maxRequestsPerHour).toBe(100);
    expect(spec("doge").maxRequestsPerHour).toBe(100);
    expect(spec("xrp")?.maxRequestsPerHour).toBe(416);
    expect(spec("xlm").maxRequestsPerHour).toBe(3600);
  });

  it("spaces BlockCypher calls under its 3 requests per second", () => {
    expect(spec("ltc").minIntervalMs).toBeGreaterThanOrEqual(1000 / 3);
  });

  it("keeps TON Center at its documented one request per second without a key", () => {
    expect(spec("ton").minIntervalMs).toBeGreaterThanOrEqual(1000);
  });

  it("spaces Solana calls under 40 requests per 10 s", () => {
    expect(10_000 / SOLANA_MIN_INTERVAL_MS).toBeLessThanOrEqual(40);
  });

  it("never lets a default cycle exceed any budget at the maximum address count", () => {
    const addresses = Array.from({ length: MAX_ADDRESSES_PER_NETWORK }, (_, i) => `a${i}`);
    for (const network of NETWORKS) {
      if (!network.maxRequestsPerHour) continue;
      const nets = new Map([[network, addresses]]);
      const cycle = Math.max(DEFAULT_POLL_MS, minCycleMs(nets, new Map(), {}));
      expect((addresses.length * HOUR) / cycle).toBeLessThanOrEqual(network.maxRequestsPerHour);
    }
  });

  it("raises the delay for ten Litecoin addresses above the 300 s default (100 per hour)", () => {
    const addresses = Array.from({ length: 10 }, (_, i) => `a${i}`);
    expect(minCycleMs(new Map([[spec("ltc"), addresses]]), new Map(), {})).toBe(360_000);
  });

  it("counts Litecoin and Dogecoin together because BlockCypher counts per IP", () => {
    const nets = new Map([
      [spec("ltc"), ["a", "b"]],
      [spec("doge"), ["c", "d"]],
    ]);
    expect(minCycleMs(nets, new Map(), {})).toBe(144_000);
  });

  it("counts token reads as a second request per address", () => {
    const tokens = new Map([[spec("xlm"), { watch: [{}] }]]);
    expect(minCycleMs(new Map([[spec("xlm"), ["a"]]]), tokens, {})).toBe(2_000);
  });

  it("does not hold a user-supplied endpoint to the public service's budget", () => {
    const nets = new Map([[spec("ltc"), ["a", "b", "c"]]]);
    expect(minCycleMs(nets, new Map(), { ltc: "http://127.0.0.1:1" })).toBe(0);
  });

  it("keeps the default and the floor sane", () => {
    expect(DEFAULT_POLL_MS).toBeGreaterThanOrEqual(MIN_POLL_MS);
    expect(MIN_POLL_MS).toBeGreaterThanOrEqual(60_000);
  });
});

describe("the poll delay a running capability sleeps", () => {
  it("is raised above the 300 s default when ten Litecoin addresses would exceed BlockCypher's 100 per hour", async () => {
    const { createHarness } = await import("@phoenix/sdk-testing");
    const { createPortfolioCapability } = await import("../src");
    const seen: number[] = [];
    const calls: string[] = [];
    const real = globalThis.fetch;
    // BlockCypher is never contacted: every request goes to this stub.
    globalThis.fetch = (async (input: unknown) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ balance: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const h = createHarness({
      modules: [
        createPortfolioCapability({
          sleep: (ms) => {
            seen.push(ms);
            return new Promise(() => {});
          },
          pace: async () => {},
          solanaFetch: async () => new Response("{}"),
        }),
      ],
    });
    try {
      const addresses = Array.from(
        { length: 10 },
        (_, i) => `ltc1q${"q".repeat(37)}${"pzry9x8gf2"[i]}`,
      );
      h.manager.configure("portfolio", {
        networks: { ltc: addresses },
        price_url: "http://127.0.0.1:1",
      });
      await h.enable("portfolio");
      await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
      expect(calls.some((u) => u.startsWith("https://api.blockcypher.com/"))).toBe(true);
      expect(seen[0]).toBe(360_000);
    } finally {
      globalThis.fetch = real;
      await h.close();
    }
  });
});
