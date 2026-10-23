// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EXCHANGES,
  NETWORKS,
  createPortfolioCapability,
  downsample,
  roundHalfUp,
  scaledUnits,
  shortAddress,
  type Snapshot,
} from "../src";
import {
  ADDRESSES,
  FAKE_KEY,
  FAKE_PASSPHRASE,
  FAKE_SECRET,
  defaultState,
  startMockPortfolio,
  type MockPortfolio,
  type MockState,
} from "../testing/mock-portfolio";

const T0 = Date.parse("2026-10-19T09:00:00Z");

/** The poller's waits: each ends only when the test says so. */
class Clock {
  now = T0;
  readonly sleeps: number[] = [];
  private pending: PromiseWithResolvers<void> | undefined;
  readonly sleep = (ms: number, signal: AbortSignal): Promise<void> => {
    this.sleeps.push(ms);
    const wait = Promise.withResolvers<void>();
    this.pending = wait;
    signal.addEventListener("abort", () => wait.resolve(), { once: true });
    return wait.promise;
  };
  async tick(): Promise<void> {
    const before = this.sleeps.length;
    this.pending?.resolve();
    await vi.waitFor(() => expect(this.sleeps.length).toBeGreaterThan(before));
  }
  first(): Promise<void> {
    return vi.waitFor(() => expect(this.sleeps.length).toBeGreaterThan(0));
  }
}

let h: Harness | undefined;
let mock: MockPortfolio | undefined;
let clock: Clock;

afterEach(async () => {
  await h?.close();
  await mock?.close();
  h = mock = undefined;
});

interface Setup {
  state?: (s: MockState) => void;
  config?: (m: MockPortfolio) => Record<string, unknown>;
  secrets?: Record<string, string>;
}

async function ready(setup: Setup = {}) {
  const state = defaultState();
  setup.state?.(state);
  mock = await startMockPortfolio(state);
  clock = new Clock();
  const m = mock;
  const exchangeUrls = Object.fromEntries(EXCHANGES.map((e) => [e.id, m.endpoint(e.id)]));
  h = createHarness({
    modules: [
      createPortfolioCapability({ now: () => clock.now, sleep: clock.sleep, exchangeUrls }),
    ],
  });
  const endpoints = Object.fromEntries(NETWORKS.map((n) => [n.id, m.endpoint(n.id)]));
  h.manager.configure("portfolio", {
    price_url: m.url,
    endpoints,
    ...setup.config?.(m),
  });
  for (const [name, value] of Object.entries(setup.secrets ?? {})) {
    await h.manager.setSecret("portfolio", name, value);
  }
  await h.enable("portfolio");
  await clock.first();
  return { h, mock: m };
}

const snapshot = async (): Promise<Snapshot> => {
  const op = await h!.run("portfolio", "snapshot");
  expect(op.status).toBe("succeeded");
  return op.result as Snapshot;
};

const eth = (wei: string) => ({ body: { coin_balance: wei } });
const btc = (funded: number, spent: number) => ({
  body: { chain_stats: { funded_txo_sum: funded, spent_txo_sum: spent } },
});

describe("balances, values and rounding", () => {
  it("prices a BTC and an ETH address, sums the rounded rows and weights the 24h change", async () => {
    await ready({
      state: (s) => {
        s.accounts.btc = { [ADDRESSES.btc]: btc(150_000_000, 50_000_000) }; // 1 BTC
        s.accounts.eth = { [ADDRESSES.eth]: eth("2500000000000000000") }; // 2.5 ETH
      },
      config: () => ({ networks: { btc: [ADDRESSES.btc], eth: [ADDRESSES.eth] } }),
    });
    const s = await snapshot();
    expect(s.holdings.map((x) => [x.asset, x.amount, x.value_usd])).toEqual([
      ["BTC", 1, 60_000],
      ["ETH", 2.5, 7_500],
    ]);
    expect(s.total_usd).toBe(67_500);
    // BTC +2% on 60 000 (was 58 823.53), ETH -1% on 7 500 (was 7 575.76): 67 500 / 66 399.29 - 1.
    expect(s.change_24h_pct).toBe(1.66);
    expect(s.sparkline).toHaveLength(42);
    expect(s.holdings[0]!.sparkline).toHaveLength(42);
    expect(s.price_source).toMatch(/CoinGecko/);
    expect(s.note).toMatch(/not verify/);
    expect(s.updated_at).toBe("2026-10-19T09:00:00.000Z");
    // Only the coins held are asked about, in one request.
    expect(mock!.marketsQuery()).toContain("ids=bitcoin%2Cethereum");
    expect(mock!.requests.filter((r) => r.path.includes("/coins/markets"))).toHaveLength(1);
  });

  it("an asset without a price mapping is listed, counted as unpriced and left out of the total", async () => {
    await ready({
      state: (s) => {
        s.accounts.xrp = { [ADDRESSES.xrp]: { body: { xrpBalance: "10" } } };
        s.accounts.etc = { ["0x" + "cd".repeat(20)]: eth("1000000000000000000") };
        s.markets = s.markets.filter((m) => m.id !== "ethereum-classic");
      },
      config: () => ({ networks: { xrp: [ADDRESSES.xrp], etc: ["0x" + "cd".repeat(20)] } }),
    });
    const s = await snapshot();
    expect(s.unpriced).toBe(1);
    expect(s.total_usd).toBe(5);
    expect(s.holdings.find((x) => x.asset === "ETC")).toMatchObject({ amount: 1 });
    expect(s.holdings.find((x) => x.asset === "ETC")?.value_usd).toBeUndefined();
  });

  it("a funded-then-emptied address is not a holding, and an unfunded XRP account (404) is zero not an error", async () => {
    await ready({
      state: (s) => {
        s.accounts.btc = { [ADDRESSES.btc]: btc(1000, 1000) };
        s.accounts.xrp = {};
        s.accounts.xrp[ADDRESSES.xrp] = { status: 404, body: {} };
      },
      config: () => ({ networks: { btc: [ADDRESSES.btc], xrp: [ADDRESSES.xrp] } }),
    });
    const s = await snapshot();
    expect(s.holdings).toEqual([]);
    expect(s.sources.every((x) => x.ok)).toBe(true);
    expect(s.total_usd).toBeUndefined();
  });

  it("rounds half away from zero the way a person expects, and keeps 18-digit amounts exact", () => {
    expect(roundHalfUp(1.005, 2)).toBe(1.01);
    expect(roundHalfUp(2.675, 2)).toBe(2.68);
    expect(roundHalfUp(-1.005, 2)).toBe(-1.01);
    expect(roundHalfUp(0.000000005, 8)).toBe(0.00000001);
    expect(roundHalfUp(Number.NaN, 2)).toBe(0);
    expect(scaledUnits("123456789012345678", 18)).toBe(0.12345679);
    expect(scaledUnits("999999999999999999999", 18)).toBe(1000);
    expect(scaledUnits("1", 18)).toBe(0);
    expect(scaledUnits("-5", 18)).toBeUndefined();
    expect(scaledUnits("1e18", 18)).toBeUndefined();
    expect(scaledUnits(150, 8)).toBe(0.0000015);
  });

  it("downsample keeps the first and last point", () => {
    const out = downsample(
      Array.from({ length: 168 }, (_, i) => i),
      42,
    );
    expect(out).toHaveLength(42);
    expect(out[0]).toBe(0);
    expect(out.at(-1)).toBe(167);
    expect(downsample([1, 2, 3], 42)).toEqual([1, 2, 3]);
  });

  it("shortens an address for display", () => {
    expect(shortAddress(ADDRESSES.btc)).toBe("bc1qar…5mdq");
    expect(shortAddress("abc")).toBe("abc");
  });
});

/** One valid address and a documented-shape body worth exactly 1.5 coins, per network. */
const ALL_NETWORKS: [string, string, unknown, string][] = [
  [
    "btc",
    ADDRESSES.btc,
    { chain_stats: { funded_txo_sum: 250_000_000, spent_txo_sum: 100_000_000 } },
    "BTC",
  ],
  ["ltc", "ltc1q" + "q".repeat(38), { balance: 150_000_000 }, "LTC"],
  ["doge", "D" + "9".repeat(33), { balance: 150_000_000 }, "DOGE"],
  ["eth", ADDRESSES.eth, { coin_balance: "1500000000000000000" }, "ETH"],
  ["optimism", ADDRESSES.eth, { coin_balance: "1500000000000000000" }, "ETH"],
  ["base", ADDRESSES.eth, { coin_balance: "1500000000000000000" }, "ETH"],
  ["arbitrum", ADDRESSES.eth, { coin_balance: "1500000000000000000" }, "ETH"],
  ["polygon", ADDRESSES.eth, { coin_balance: "1500000000000000000" }, "POL"],
  ["gnosis", ADDRESSES.eth, { coin_balance: "1500000000000000000" }, "XDAI"],
  ["etc", ADDRESSES.eth, { coin_balance: "1500000000000000000" }, "ETC"],
  ["xrp", ADDRESSES.xrp, { xrpBalance: "1.5" }, "XRP"],
  [
    "xlm",
    "G" + "A".repeat(55),
    {
      balances: [
        { asset_type: "credit_alphanum4", balance: "9" },
        { asset_type: "native", balance: "1.5000000" },
      ],
    },
    "XLM",
  ],
  ["algo", "A".repeat(58), { amount: 1_500_000 }, "ALGO"],
  ["ton", "EQ" + "A".repeat(46), { ok: true, result: "1500000000" }, "TON"],
  ["trx", ADDRESSES.trx, { data: [{ balance: 1_500_000 }] }, "TRX"],
  [
    "atom",
    "cosmos1" + "q".repeat(38),
    {
      balances: [
        { denom: "ibc/AB", amount: "7" },
        { denom: "uatom", amount: "1500000" },
      ],
    },
    "ATOM",
  ],
];

describe("every one of the 16 networks", () => {
  it.each(ALL_NETWORKS)(
    "%s: reads a documented-shape answer as 1.5 %s coins via GET",
    async (id, address, body, asset) => {
      await ready({
        state: (s) => {
          s.accounts[id] = { [address]: { body } };
        },
        config: () => ({ networks: { [id]: [address] } }),
      });
      const s = await snapshot();
      expect(s.sources).toEqual([expect.objectContaining({ id, ok: true })]);
      expect(s.holdings).toMatchObject([{ source: id, asset, amount: 1.5 }]);
      expect(
        mock!.requests
          .filter((r) => r.path.startsWith(`/x/${id}/`))
          .every((r) => r.method === "GET"),
      ).toBe(true);
    },
  );

  it("covers exactly the 16 supported ids", () => {
    expect(ALL_NETWORKS.map((n) => n[0]).sort()).toEqual(NETWORKS.map((n) => n.id).sort());
  });

  it("an address that is a path-traversal or query injection never reaches the request (config refuses it)", async () => {
    await ready();
    await h!.manager.disable("portfolio");
    for (const evil of [
      "0x" + "a".repeat(40) + "/../../admin",
      "0x" + "a".repeat(40) + "?x=1",
      "0x" + "a".repeat(40) + "\n",
    ]) {
      expect(
        () => h!.manager.configure("portfolio", { networks: { eth: [evil] } }),
        evil,
      ).toThrow();
    }
  });
});

describe("failure is per source, and prices are optional", () => {
  it("one failing network is reported while the other still shows; no remote text leaks", async () => {
    await ready({
      state: (s) => {
        s.accounts.btc = {
          [ADDRESSES.btc]: { status: 500, body: "<script>alert(1)</script> leaked-secret-text" },
        };
        s.accounts.eth = { [ADDRESSES.eth]: eth("1000000000000000000") };
      },
      config: () => ({ networks: { btc: [ADDRESSES.btc], eth: [ADDRESSES.eth] } }),
    });
    const s = await snapshot();
    expect(s.holdings.map((x) => x.asset)).toEqual(["ETH"]);
    expect(s.sources.find((x) => x.id === "btc")).toMatchObject({
      ok: false,
      error: "Bitcoin answered HTTP 500",
    });
    expect(JSON.stringify(s)).not.toContain("leaked-secret-text");
    expect((await h!.manager.checkHealth("portfolio")).health).toMatchObject({
      status: "degraded",
      message: expect.stringContaining("Bitcoin"),
    });
  });

  it("a malformed body is an unexpected-format error, not a zero balance", async () => {
    await ready({
      state: (s) => {
        s.accounts.btc = { [ADDRESSES.btc]: { body: { chain_stats: { funded_txo_sum: "lots" } } } };
      },
      config: () => ({ networks: { btc: [ADDRESSES.btc] } }),
    });
    const s = await snapshot();
    expect(s.sources[0]).toMatchObject({ ok: false });
    expect(s.holdings).toEqual([]);
  });

  it("when the price service is down balances still show, unpriced, with the failure listed", async () => {
    await ready({
      state: (s) => {
        s.accounts.eth = { [ADDRESSES.eth]: eth("1000000000000000000") };
      },
      config: (m) => ({
        networks: { eth: [ADDRESSES.eth] },
        price_url: "http://127.0.0.1:1",
        endpoints: { eth: m.endpoint("eth") },
      }),
    });
    const s = await snapshot();
    expect(s.holdings).toMatchObject([{ asset: "ETH", amount: 1 }]);
    expect(s.holdings[0]!.value_usd).toBeUndefined();
    expect(s.unpriced).toBe(1);
    expect(s.total_usd).toBeUndefined();
    expect(s.sources.find((x) => x.id === "prices")).toMatchObject({ ok: false });
  });
});

describe("exchanges (read-only keys, signed GET)", () => {
  const SECRETS: Record<string, string> = {
    binance_key: FAKE_KEY,
    binance_secret: FAKE_SECRET,
    bybit_key: FAKE_KEY,
    bybit_secret: FAKE_SECRET,
    okx_key: FAKE_KEY,
    okx_secret: FAKE_SECRET,
    okx_passphrase: FAKE_PASSPHRASE,
    kucoin_key: FAKE_KEY,
    kucoin_secret: FAKE_SECRET,
    kucoin_passphrase: FAKE_PASSPHRASE,
    gate_key: FAKE_KEY,
    gate_secret: FAKE_SECRET,
  };

  const bodies = (s: MockState) => {
    s.exchangeBodies.binance = {
      balances: [
        { asset: "BTC", free: "0.5", locked: "0.25" },
        { asset: "ZZZ", free: "0", locked: "0" },
      ],
    };
    s.exchangeBodies.bybit = {
      retCode: 0,
      result: { list: [{ coin: [{ coin: "ETH", walletBalance: "2" }] }] },
    };
    s.exchangeBodies.okx = { code: "0", data: [{ details: [{ ccy: "USDT", cashBal: "100" }] }] };
    s.exchangeBodies.kucoin = {
      code: "200000",
      data: [
        { currency: "XRP", balance: "10" },
        { currency: "XRP", balance: "5" },
      ],
    };
    s.exchangeBodies.gate = [{ currency: "USDT", available: "20", locked: "5" }];
  };

  it("signs each exchange exactly as documented and reads every balance (all five)", async () => {
    await ready({
      state: bodies,
      config: () => ({ exchanges: ["binance", "bybit", "okx", "kucoin", "gate"] }),
      secrets: SECRETS,
    });
    const s = await snapshot();
    expect(s.sources.map((x) => [x.id, x.ok])).toEqual([
      ["binance", true],
      ["bybit", true],
      ["okx", true],
      ["kucoin", true],
      ["gate", true],
    ]);
    const byLabel = Object.fromEntries(s.holdings.map((x) => [`${x.label}:${x.asset}`, x.amount]));
    expect(byLabel).toEqual({
      "Binance:BTC": 0.75,
      "Bybit:ETH": 2,
      "OKX:USDT": 100,
      "KuCoin:XRP": 15,
      "Gate:USDT": 25,
    });
    expect(s.total_usd).toBe(45_000 + 6_000 + 100 + 7.5 + 25);
  });

  it("a wrong signature layout is refused by the mock (so the signing tests mean something)", async () => {
    await ready({
      state: bodies,
      config: () => ({ exchanges: ["binance"] }),
      secrets: { binance_key: FAKE_KEY, binance_secret: "another-secret" },
    });
    const s = await snapshot();
    expect(s.sources[0]).toMatchObject({
      ok: false,
      error: expect.stringMatching(/rejected the credential/),
    });
    expect(s.holdings).toEqual([]);
  });

  it("without stored keys it says what to add and sends nothing to the exchange", async () => {
    await ready({
      state: bodies,
      config: () => ({ exchanges: ["okx"] }),
      secrets: { okx_key: FAKE_KEY, okx_secret: FAKE_SECRET },
    });
    const s = await snapshot();
    expect(s.sources[0]).toMatchObject({ ok: false, error: expect.stringContaining("OKX") });
    expect(mock!.requests.filter((r) => r.path.startsWith("/x/okx"))).toEqual([]);
  });

  it("sends keys only to the configured exchange, never to the price service or a network indexer", async () => {
    await ready({
      state: (s) => {
        bodies(s);
        s.accounts.eth = { [ADDRESSES.eth]: eth("1000000000000000000") };
      },
      config: () => ({ exchanges: ["gate"], networks: { eth: [ADDRESSES.eth] } }),
      secrets: SECRETS,
    });
    await snapshot();
    for (const r of mock!.requests) {
      const carries = JSON.stringify(r.headers).includes(FAKE_KEY) || r.path.includes(FAKE_KEY);
      expect(carries, r.path).toBe(r.path.startsWith("/x/gate"));
    }
    expect(JSON.stringify(await snapshot())).not.toContain(FAKE_SECRET);
  });

  it("the secrets are named per exchange, and no key is ever returned or stored in config", async () => {
    await ready({ secrets: SECRETS });
    const view = h!.manager.get("portfolio");
    expect(view.secrets.map((x) => x.name).sort()).toEqual(
      [...Object.keys(SECRETS), "coinbase_key", "coinbase_secret"].sort(),
    );
    expect(JSON.stringify(view)).not.toContain(FAKE_SECRET);
    expect(() =>
      h!.manager.configure("portfolio", { exchanges: ["binance"], binance_secret: FAKE_SECRET }),
    ).toThrow();
    expect(() => h!.manager.configure("portfolio", { exchanges: ["kraken"] })).toThrow();
  });
});

describe("only GET is ever sent", () => {
  it("every request in a full cycle (16 networks, 6 exchanges, prices) is a GET", async () => {
    await ready({
      state: (s) => {
        s.exchangeBodies.binance = { balances: [] };
      },
      config: () => ({
        networks: {
          btc: [ADDRESSES.btc],
          eth: [ADDRESSES.eth],
          xrp: [ADDRESSES.xrp],
          trx: [ADDRESSES.trx],
        },
        exchanges: ["binance"],
      }),
      secrets: { binance_key: FAKE_KEY, binance_secret: FAKE_SECRET },
    });
    await snapshot();
    expect(mock!.requests.length).toBeGreaterThan(3);
    expect(mock!.requests.every((r) => r.method === "GET" && r.body === "")).toBe(true);
  });

  it("the command list has one read-only command and Kraken (POST-only private API) is not offered", () => {
    const cap = createPortfolioCapability();
    expect(cap.manifest.commands.map((c) => [c.name, c.side_effect])).toEqual([
      ["snapshot", "read"],
    ]);
    expect(NETWORKS).toHaveLength(16);
    expect(EXCHANGES.map((e) => e.id)).toEqual([
      "binance",
      "bybit",
      "okx",
      "kucoin",
      "gate",
      "coinbase",
    ]);
  });
});

describe("configuration", () => {
  it("rejects an address of the wrong shape for its network and refuses plain http to a non-loopback host", async () => {
    await ready();
    await h!.manager.disable("portfolio");
    const bad: Record<string, unknown>[] = [
      { networks: { btc: [ADDRESSES.eth] } },
      { networks: { eth: ["0x123"] } },
      { networks: { eth: ["../etc/passwd"] } },
      { networks: { dogecoin: [ADDRESSES.btc] } },
      { networks: { btc: [ADDRESSES.btc, ADDRESSES.btc] } },
      { price_url: "http://evil.example.com" },
      // Exchanges cannot be redirected through config at all (the key would follow).
      { endpoints: { binance: mock!.endpoint("binance") } },
      { endpoints: { binance: "https://attacker.example" } },
      { poll_ms: 59_999 },
    ];
    for (const config of bad)
      expect(() => h!.manager.configure("portfolio", config), JSON.stringify(config)).toThrow();
    expect(() =>
      h!.manager.configure("portfolio", { networks: { btc: [ADDRESSES.btc] }, poll_ms: 60_000 }),
    ).not.toThrow();
  });

  it("health says what is missing until something is configured", async () => {
    await ready({ config: () => ({ networks: {}, endpoints: {} }) });
    expect((await h!.manager.checkHealth("portfolio")).health).toMatchObject({
      status: "degraded",
      message: "No addresses or exchanges configured",
    });
  });
});

describe("polling and events", () => {
  it("emits one ephemeral snapshot.updated per change with no amounts in it", async () => {
    await ready({
      state: (s) => {
        s.accounts.eth = { [ADDRESSES.eth]: eth("1000000000000000000") };
      },
      config: () => ({ networks: { eth: [ADDRESSES.eth] } }),
    });
    await h!.drain();
    const updates = () => h!.events.filter((e) => e.event_type === "portfolio.snapshot.updated");
    expect(updates()).toHaveLength(1);
    await clock.tick(); // nothing changed: no second event
    await h!.drain();
    expect(updates()).toHaveLength(1);
    mock!.state.accounts.eth![ADDRESSES.eth] = eth("2000000000000000000");
    await clock.tick();
    await h!.drain();
    expect(updates()).toHaveLength(2);
    expect(JSON.stringify(updates()[1]!.payload)).toBe('{"holdings":1,"sources_failed":0}');
    expect(
      h!.db
        .prepare("select count(*) as n from events where event_type = 'portfolio.snapshot.updated'")
        .get(),
    ).toEqual({ n: 0 });
  });

  it("waits at least the poll interval, and longer after failures", async () => {
    await ready({
      state: (s) => {
        s.accounts.btc = { [ADDRESSES.btc]: { status: 500, body: {} } };
      },
      config: () => ({ networks: { btc: [ADDRESSES.btc] }, poll_ms: 60_000 }),
    });
    expect(clock.sleeps[0]).toBe(120_000);
    await clock.tick();
    expect(clock.sleeps[1]).toBe(240_000);
  });
});
