// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// XRP Ledger issued currencies (XRPSCAN trustlines2) and TON jettons (TON Center v3) from the
// owner's watch list, against the local fake indexers. Simulated: no real service was contacted.
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EXCHANGES,
  NETWORKS,
  createPortfolioCapability,
  decimalUnits,
  networkById,
  tonJettons,
  xrplTokens,
  type Snapshot,
} from "../src";
import {
  ADDRESSES,
  defaultState,
  startMockPortfolio,
  type MockPortfolio,
  type MockState,
} from "../testing/mock-portfolio";

// Addresses from the XRPSCAN / TON documentation examples; their checksums are verified by the
// code under test, so a typo here fails the first test.
const ISSUER_A = "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B";
const ISSUER_B = "rwpTh9DDa52XkM9nTKp2QrJuCGV5d1mQVP";
const TON_OWNER = "EQ" + "A".repeat(46);
const MASTER_FRIENDLY = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";
const MASTER_RAW = "0:" + Buffer.from(MASTER_FRIENDLY, "base64").subarray(2, 34).toString("hex");
const OTHER_RAW = "0:" + "ab".repeat(32);

class Clock {
  now = Date.parse("2026-11-09T09:00:00Z");
  readonly sleeps: number[] = [];
  readonly sleep = (ms: number, signal: AbortSignal): Promise<void> => {
    this.sleeps.push(ms);
    const wait = Promise.withResolvers<void>();
    signal.addEventListener("abort", () => wait.resolve(), { once: true });
    return wait.promise;
  };
  first(): Promise<void> {
    return vi.waitFor(() => expect(this.sleeps.length).toBeGreaterThan(0));
  }
}

let h: Harness | undefined;
let mock: MockPortfolio | undefined;
const paced: number[] = [];

afterEach(async () => {
  paced.length = 0;
  await h?.close();
  await mock?.close();
  h = mock = undefined;
});

async function ready(setup: {
  state: (s: MockState) => void;
  networks: Record<string, string[]>;
  tokens: Record<string, unknown>;
}) {
  const state = defaultState();
  setup.state(state);
  mock = await startMockPortfolio(state);
  const clock = new Clock();
  const m = mock;
  h = createHarness({
    modules: [
      createPortfolioCapability({
        now: () => clock.now,
        sleep: clock.sleep,
        pace: async (ms) => void paced.push(ms),
        exchangeUrls: Object.fromEntries(EXCHANGES.map((e) => [e.id, m.endpoint(e.id)])),
      }),
    ],
  });
  h.manager.configure("portfolio", {
    price_url: m.url,
    endpoints: Object.fromEntries(NETWORKS.map((n) => [n.id, m.endpoint(n.id)])),
    networks: setup.networks,
    tokens: setup.tokens,
  });
  await h.enable("portfolio");
  await clock.first();
}

const snapshot = async (): Promise<Snapshot> => {
  const op = await h!.run("portfolio", "snapshot");
  expect(op.status).toBe("succeeded");
  return op.result as Snapshot;
};

const line = (issuer: string, currency: string, balance: unknown) => ({
  account: issuer,
  currency,
  balance,
  limit: "1000000",
  limit_peer: "0",
  no_ripple: true,
});

async function xrpTokens(body: unknown, status = 200, decimals = 6) {
  await ready({
    state: (s) => {
      s.tokenAccounts.xrp = { [ADDRESSES.xrp]: { status, body } };
    },
    networks: { xrp: [ADDRESSES.xrp] },
    tokens: { xrp: [{ contract: `USD:${ISSUER_A}`, symbol: "USDX", decimals }] },
  });
  return snapshot();
}

async function tonTokens(body: unknown, status = 200, decimals = 6) {
  await ready({
    state: (s) => {
      s.tokenAccounts.ton = { [TON_OWNER]: { status, body } };
    },
    networks: { ton: [TON_OWNER] },
    tokens: { ton: [{ contract: MASTER_FRIENDLY, symbol: "JUSDT", decimals }] },
  });
  return snapshot();
}

describe("xrp: issued currencies from XRPSCAN trustlines2", () => {
  it("reads only the watched CURRENCY:ISSUER, as an exact amount, by GET", async () => {
    const s = await xrpTokens({
      account: ADDRESSES.xrp,
      lines: [
        line(ISSUER_A, "USD", "12.345678"),
        line(ISSUER_B, "USD", "999"), // same currency, other issuer: not watched
        line(ISSUER_A, "EUR", "5"), // same issuer, other currency: not watched
      ],
    });
    expect(s.holdings.filter((x) => x.token)).toEqual([
      expect.objectContaining({
        source: "xrp",
        asset: "USDX",
        amount: 12.345678,
        amount_exact: "12.345678",
        token: true,
      }),
    ]);
    expect(s.sources.find((x) => x.id === "xrp:tokens")).toMatchObject({ ok: true });
    expect(mock!.requests.every((r) => r.method === "GET")).toBe(true);
    expect(
      mock!.requests.some((r) => r.path.endsWith(`/api/v1/account/${ADDRESSES.xrp}/trustlines2`)),
    ).toBe(true);
  });

  it("keeps every digit of a balance a double could not hold", async () => {
    const s = await xrpTokens({
      lines: [line(ISSUER_A, "USD", "123456789012345678.123456")],
    });
    const row = s.holdings.find((x) => x.token);
    expect(row?.amount_exact).toBe("123456789012345678.123456");
  });

  it("a zero or absent line is no holding", async () => {
    const s = await xrpTokens({ lines: [line(ISSUER_A, "USD", "0")] });
    expect(s.holdings.filter((x) => x.token)).toEqual([]);
    expect(s.sources.find((x) => x.id === "xrp:tokens")).toMatchObject({ ok: true });
  });

  it("a 40-hex currency code matches case-insensitively", async () => {
    const hex = "0158415500000000C1F76FF6ECB0BAC600000000";
    await ready({
      state: (st) => {
        st.tokenAccounts.xrp = {
          [ADDRESSES.xrp]: { body: { lines: [line(ISSUER_A, hex.toLowerCase(), "3")] } },
        };
      },
      networks: { xrp: [ADDRESSES.xrp] },
      tokens: { xrp: [{ contract: `${hex}:${ISSUER_A}`, symbol: "HEXC", decimals: 0 }] },
    });
    const s = await snapshot();
    expect(s.holdings.find((x) => x.token)).toMatchObject({ asset: "HEXC", amount_exact: "3" });
  });

  const hostile: [string, unknown, number?][] = [
    ["a negative balance", { lines: [line(ISSUER_A, "USD", "-14.03")] }],
    ["an exponent balance", { lines: [line(ISSUER_A, "USD", "1e6")] }],
    ["a JSON number balance", { lines: [line(ISSUER_A, "USD", 12.5)] }],
    [
      "more fractional digits than the owner's decimals",
      { lines: [line(ISSUER_A, "USD", "1.1234567")] },
    ],
    ["an enormous balance", { lines: [line(ISSUER_A, "USD", "9".repeat(60))] }],
    ["the same line twice", { lines: [line(ISSUER_A, "USD", "1"), line(ISSUER_A, "USD", "2")] }],
    ["a next-page marker", { lines: [], marker: "abc" }],
    ["lines that are not a list", { lines: { USD: 1 } }],
    ["null", null],
    ["HTML", "<html><script>alert(1)</script>leaked-remote-text</html>"],
    ["a server error with a body", "<h1>leaked-remote-text</h1>", 500],
  ];

  it.each(hostile)("%s fails the token source with a fixed message", async (_n, body, status) => {
    const s = await xrpTokens(body, status);
    expect(s.holdings.filter((x) => x.token)).toEqual([]);
    const source = s.sources.find((x) => x.id === "xrp:tokens");
    expect(source).toMatchObject({ ok: false });
    expect(source?.error).toMatch(
      /^XRP Ledger tokens (answered HTTP 500|sent a response in an unexpected format)$/,
    );
    expect(JSON.stringify(s)).not.toMatch(/leaked-remote-text|script/);
  });

  it("a 404 (account never funded) is a zero balance, not a failure", async () => {
    await ready({
      state: () => {},
      networks: { xrp: [ADDRESSES.xrp] },
      tokens: { xrp: [{ contract: `USD:${ISSUER_A}`, symbol: "USDX", decimals: 6 }] },
    });
    const s = await snapshot();
    expect(s.sources.find((x) => x.id === "xrp:tokens")).toMatchObject({ ok: true });
  });

  it("validates the watch entry: issuer checksum, currency form, XRP itself", () => {
    const n = xrplTokens.normalise;
    expect(n(`USD:${ISSUER_A}`)).toBe(`USD:${ISSUER_A}`);
    expect(n(`USD:${ISSUER_A.slice(0, -1)}${ISSUER_A.endsWith("B") ? "C" : "B"}`)).toBeUndefined();
    expect(n(`XRP:${ISSUER_A}`)).toBeUndefined();
    expect(n(`xrp:${ISSUER_A}`)).toBeUndefined();
    expect(n(`US:${ISSUER_A}`)).toBeUndefined();
    expect(n(`USDT:${ISSUER_A}`)).toBeUndefined();
    expect(n(`US/:${ISSUER_A}`)).toBeUndefined();
    expect(n(`USD:${ISSUER_A}/../x`)).toBeUndefined();
    expect(n(ISSUER_A)).toBeUndefined();
    expect(n(`USD:r${"1".repeat(30)}`)).toBeUndefined();
  });

  it("config refuses a malformed identifier by schema", async () => {
    await xrpTokens({ lines: [] });
    await h!.manager.disable("portfolio");
    for (const contract of ["USD", `USD:${ISSUER_A}\n`, `USD:${ISSUER_A}/x`, `US:${ISSUER_A}`]) {
      expect(
        () =>
          h!.manager.configure("portfolio", {
            tokens: { xrp: [{ contract, symbol: "A", decimals: 6 }] },
          }),
        contract,
      ).toThrow();
    }
  });

  it("decimalUnits scales exactly and refuses anything not a plain decimal", () => {
    expect(decimalUnits("12.5", 6)).toBe(12_500_000n);
    expect(decimalUnits("0.000001", 6)).toBe(1n);
    expect(decimalUnits("7", 0)).toBe(7n);
    expect(decimalUnits("1.50", 1)).toBe(15n);
    expect(decimalUnits("1.5", 0)).toBeUndefined();
    expect(decimalUnits("-1", 6)).toBeUndefined();
    expect(decimalUnits("1e3", 6)).toBeUndefined();
    expect(decimalUnits("+1", 6)).toBeUndefined();
    expect(decimalUnits(".5", 6)).toBeUndefined();
    expect(decimalUnits("01", 6)).toBeUndefined();
    expect(decimalUnits(1, 6)).toBeUndefined();
  });
});

describe("ton: jettons from TON Center v3 jetton/wallets", () => {
  const row = (jetton: string, balance: unknown) => ({
    address: "0:" + "cd".repeat(32),
    balance,
    jetton,
    owner: "0:" + "00".repeat(32),
  });

  it("reads a watched master given in friendly form, matched against the raw answer", async () => {
    const s = await tonTokens({
      jetton_wallets: [
        row(MASTER_RAW.toUpperCase().replace("0:", "0:"), "2500000"),
        row(OTHER_RAW, "999"),
      ],
      address_book: {},
      metadata: {},
    });
    expect(s.holdings.filter((x) => x.token)).toEqual([
      expect.objectContaining({
        source: "ton",
        asset: "JUSDT",
        amount: 2.5,
        amount_exact: "2.5",
        token: true,
      }),
    ]);
    expect(s.sources.find((x) => x.id === "ton:tokens")).toMatchObject({ ok: true });
  });

  it("asks one GET with the owner, no zero balances, and spaces requests", async () => {
    await tonTokens({ jetton_wallets: [] });
    expect(mock!.requests.every((r) => r.method === "GET")).toBe(true);
    const req = mock!.requests.find((r) => r.path.includes("/api/v3/jetton/wallets"));
    const url = new URL(req!.path, "http://mock");
    expect(url.searchParams.get("owner_address")).toBe(TON_OWNER);
    expect(url.searchParams.get("exclude_zero_balance")).toBe("true");
    expect(url.searchParams.get("limit")).toBe("1000");
    // native balance + tokens share one 1 request/second gate: it was asked to wait.
    expect(paced.length).toBeGreaterThan(0);
    expect(paced.every((ms) => ms > 0 && ms <= 1100)).toBe(true);
    expect(networkById("ton")?.minIntervalMs).toBe(1100);
  });

  it("keeps every digit of a 2^64 + 1 balance", async () => {
    const s = await tonTokens(
      { jetton_wallets: [row(MASTER_RAW, "18446744073709551617")] },
      200,
      9,
    );
    expect(s.holdings.find((x) => x.token)?.amount_exact).toBe("18446744073.709551617");
  });

  const hostile: [string, unknown, number?][] = [
    ["a negative balance", { jetton_wallets: [row(MASTER_RAW, "-1")] }],
    ["a fractional balance", { jetton_wallets: [row(MASTER_RAW, "1.5")] }],
    ["a JSON number balance", { jetton_wallets: [row(MASTER_RAW, 5)] }],
    ["a balance past 2^256", { jetton_wallets: [row(MASTER_RAW, (2n ** 256n).toString())] }],
    ["the same master twice", { jetton_wallets: [row(MASTER_RAW, "1"), row(MASTER_RAW, "2")] }],
    [
      "a full page (more could follow)",
      { jetton_wallets: Array.from({ length: 1000 }, () => row(OTHER_RAW, "1")) },
    ],
    ["wallets that are not a list", { jetton_wallets: "x" }],
    ["null", null],
    ["HTML", "<html><script>alert(1)</script>leaked-remote-text</html>"],
    ["rate limited with a body", { ok: false, result: "leaked-remote-text", code: 429 }, 429],
    ["a server error with a body", "<h1>leaked-remote-text</h1>", 500],
  ];

  it.each(hostile)("%s fails the token source with a fixed message", async (_n, body, status) => {
    const s = await tonTokens(body, status);
    expect(s.holdings.filter((x) => x.token)).toEqual([]);
    const source = s.sources.find((x) => x.id === "ton:tokens");
    expect(source).toMatchObject({ ok: false });
    expect(source?.error).toMatch(
      /^TON tokens (answered HTTP 500|rate limit reached|sent a response in an unexpected format)$/,
    );
    expect(JSON.stringify(s)).not.toMatch(/leaked-remote-text|script/);
  });

  it("validates the watch entry: raw or friendly mainnet form with a good CRC", () => {
    const n = tonJettons.normalise;
    expect(n(MASTER_FRIENDLY)).toBe(MASTER_RAW);
    expect(n(MASTER_RAW.toUpperCase().replace("0:", "0:"))).toBe(MASTER_RAW);
    expect(n(OTHER_RAW)).toBe(OTHER_RAW);
    expect(n("-1:" + "00".repeat(32))).toBe("-1:" + "00".repeat(32));
    // one character changed: the CRC no longer matches
    const bad = MASTER_FRIENDLY[10] === "A" ? "B" : "A";
    expect(n(MASTER_FRIENDLY.slice(0, 10) + bad + MASTER_FRIENDLY.slice(11))).toBeUndefined();
    expect(n("0:" + "ab".repeat(31))).toBeUndefined();
    expect(n("1:" + "ab".repeat(32))).toBeUndefined();
    expect(n(MASTER_FRIENDLY + "/x")).toBeUndefined();
    expect(n("")).toBeUndefined();
  });
});

describe("disclosure", () => {
  it("both new readers use hosts already disclosed (no new host) and the manifest names them", () => {
    expect(networkById("xrp")?.baseUrl).toBe("https://api.xrpscan.com");
    expect(networkById("ton")?.baseUrl).toBe("https://toncenter.com");
    const { manifest } = createPortfolioCapability();
    const text = JSON.stringify(manifest.data_categories);
    expect(text).toContain("XRP Ledger issued currencies");
    expect(text).toContain("TON jettons");
  });
});
