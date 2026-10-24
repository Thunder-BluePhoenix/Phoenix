// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Token balances from the owner's watch list, against the local fake indexers. Simulated: no real
// indexer, contract or wallet was contacted.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EXCHANGES,
  MAX_TOKENS_PER_NETWORK,
  NETWORKS,
  createPortfolioCapability,
  decimalText,
  evmTokens,
  readWatchList,
  roundedAmount,
  trc20,
  unitsOf,
  type Snapshot,
} from "../src";
import {
  ADDRESSES,
  defaultState,
  startMockPortfolio,
  type MockPortfolio,
  type MockState,
} from "../testing/mock-portfolio";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** A TRON address with a correct checksum, built from a one-byte filler. */
function tronAddress(fill: number): string {
  const body = Buffer.concat([Buffer.from([0x41]), Buffer.alloc(20, fill)]);
  const sha = (b: Buffer) => createHash("sha256").update(b).digest();
  const full = Buffer.concat([body, sha(sha(body)).subarray(0, 4)]);
  let n = BigInt("0x" + full.toString("hex"));
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  return out;
}

const T_CONTRACT = tronAddress(7);
const T_OTHER = tronAddress(9);
const EVM_TOKEN = "0x" + "c0".repeat(20);
const EVM_OTHER = "0x" + "d1".repeat(20);
const ISSUER = "G" + "A".repeat(55);
const T0 = Date.parse("2026-10-19T09:00:00Z");

class Clock {
  now = T0;
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

afterEach(async () => {
  await h?.close();
  await mock?.close();
  h = mock = undefined;
});

interface Setup {
  state?: (s: MockState) => void;
  networks: Record<string, string[]>;
  tokens: Record<string, unknown>;
}

async function ready(setup: Setup) {
  const state = defaultState();
  setup.state?.(state);
  mock = await startMockPortfolio(state);
  const clock = new Clock();
  const m = mock;
  h = createHarness({
    modules: [
      createPortfolioCapability({
        now: () => clock.now,
        sleep: clock.sleep,
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

const tokenRow = (address: string, value: string, decimals = "18", type = "ERC-20") => ({
  token: { address_hash: address, decimals, type, symbol: "EVIL<script>", name: "x" },
  value,
});

const ethWatch = (decimals = 18) => ({
  eth: [{ contract: EVM_TOKEN, symbol: "USDX", decimals }],
});

/** Runs one Ethereum token read with `body` as the token-balances answer. */
async function ethTokens(body: unknown, status = 200, decimals = 18) {
  await ready({
    state: (s) => {
      s.tokenAccounts.eth = { [ADDRESSES.eth]: { status, body } };
    },
    networks: { eth: [ADDRESSES.eth] },
    tokens: ethWatch(decimals),
  });
  return snapshot();
}

describe("token balances: valid answers on each supported network", () => {
  it("eth: reads an ERC-20 from the watch list, with the owner's symbol, exact and rounded", async () => {
    const s = await ethTokens([
      tokenRow(EVM_TOKEN.toUpperCase().replace("0X", "0x"), "1500000000000000000"),
      tokenRow(EVM_OTHER, "999"),
    ]);
    expect(s.holdings).toEqual([
      expect.objectContaining({
        source: "eth",
        asset: "USDX",
        amount: 1.5,
        amount_exact: "1.5",
        token: true,
      }),
    ]);
    expect(s.sources.find((x) => x.id === "eth:tokens")).toMatchObject({ ok: true });
    expect(mock!.requests.every((r) => r.method === "GET")).toBe(true);
    expect(mock!.requests.some((r) => r.path.endsWith(`/${ADDRESSES.eth}/token-balances`))).toBe(
      true,
    );
  });

  it("trx: reads a TRC-20 from the account answer, a checksummed contract only", async () => {
    await ready({
      state: (s) => {
        s.accounts.trx = {
          [ADDRESSES.trx]: {
            body: {
              data: [
                { balance: 1_000_000, trc20: [{ [T_OTHER]: "5" }, { [T_CONTRACT]: "2500000" }] },
              ],
            },
          },
        };
      },
      networks: { trx: [ADDRESSES.trx] },
      tokens: { trx: [{ contract: T_CONTRACT, symbol: "USDT", decimals: 6 }] },
    });
    const s = await snapshot();
    expect(s.holdings.find((x) => x.token)).toMatchObject({
      asset: "USDT",
      amount: 2.5,
      amount_exact: "2.5",
    });
    expect(s.sources.find((x) => x.id === "trx:tokens")).toMatchObject({ ok: true });
  });

  it("xlm: reads a credit asset by CODE:ISSUER with 7 decimals", async () => {
    await ready({
      state: (s) => {
        s.accounts.xlm = {
          ["G" + "B".repeat(55)]: {
            body: {
              balances: [
                { asset_type: "native", balance: "9.0000000" },
                {
                  asset_type: "credit_alphanum4",
                  asset_code: "USDC",
                  asset_issuer: ISSUER,
                  balance: "12.3456789",
                },
              ],
            },
          },
        };
      },
      networks: { xlm: ["G" + "B".repeat(55)] },
      tokens: { xlm: [{ contract: `USDC:${ISSUER}`, symbol: "USDC" }] },
    });
    const s = await snapshot();
    expect(s.holdings.find((x) => x.token)).toMatchObject({
      asset: "USDC",
      amount: 12.3456789,
      amount_exact: "12.3456789",
    });
  });

  it("algo: reads an asset id; atom: reads an ibc denomination", async () => {
    const algoAddress = "A".repeat(58);
    const atomAddress = "cosmos1" + "q".repeat(38);
    await ready({
      state: (s) => {
        s.accounts.algo = {
          [algoAddress]: {
            body: { amount: 1, assets: [{ "asset-id": 31566704, amount: 2_000_000 }] },
          },
        };
        s.accounts.atom = {
          [atomAddress]: {
            body: {
              balances: [{ denom: "ibc/ABCDEF0123", amount: "4200000" }],
              pagination: { next_key: null, total: "1" },
            },
          },
        };
      },
      networks: { algo: [algoAddress], atom: [atomAddress] },
      tokens: {
        algo: [{ contract: "31566704", symbol: "USDCa", decimals: 6 }],
        atom: [{ contract: "ibc/ABCDEF0123", symbol: "OSMO", decimals: 6 }],
      },
    });
    const s = await snapshot();
    const held = s.holdings.filter((x) => x.token).map((x) => [x.asset, x.amount]);
    expect(held).toHaveLength(2);
    expect(held).toEqual(
      expect.arrayContaining([
        ["OSMO", 4.2],
        ["USDCa", 2],
      ]),
    );
  });

  it("a token is never priced, even when its symbol matches a priced coin", async () => {
    await ready({
      state: (s) => {
        s.tokenAccounts.eth = {
          [ADDRESSES.eth]: { body: [tokenRow(EVM_TOKEN, "1000000000000000000")] },
        };
      },
      networks: { eth: [ADDRESSES.eth] },
      tokens: { eth: [{ contract: EVM_TOKEN, symbol: "ETH", decimals: 18 }] },
    });
    const s = await snapshot();
    const held = s.holdings.find((x) => x.token)!;
    expect(held.value_usd).toBeUndefined();
    expect(held.price_usd).toBeUndefined();
    expect(s.unpriced).toBe(1);
    expect(s.total_usd).toBeUndefined();
  });

  it("an address with no token, or never seen (404), is zero and not an error", async () => {
    let s = await ethTokens([]);
    expect(s.holdings).toEqual([]);
    expect(s.sources.every((x) => x.ok)).toBe(true);
    await h!.close();
    await mock!.close();
    h = mock = undefined;
    s = await ethTokens({}, 404);
    expect(s.holdings).toEqual([]);
    expect(s.sources.every((x) => x.ok)).toBe(true);
  });

  it("reads no tokens for an address that is not listed, or with no watch list", async () => {
    await ready({
      state: (s) => {
        s.accounts.eth = { [ADDRESSES.eth]: { body: { coin_balance: "0" } } };
      },
      networks: { eth: [ADDRESSES.eth] },
      tokens: {},
    });
    await snapshot();
    expect(mock!.requests.some((r) => r.path.includes("token-balances"))).toBe(false);
  });
});

describe("BigInt precision", () => {
  it("keeps all 18 decimals of a large balance in the exact text", async () => {
    const s = await ethTokens([tokenRow(EVM_TOKEN, "123456789012345678901234567")]);
    expect(s.holdings[0]).toMatchObject({
      amount_exact: "123456789.012345678901234567",
      amount: 123456789.01234572,
    });
  });

  it("converts without float error", () => {
    expect(decimalText(1n, 18)).toBe("0.000000000000000001");
    expect(decimalText(10n ** 18n, 18)).toBe("1");
    expect(decimalText(5n, 0)).toBe("5");
    expect(decimalText(0n, 6)).toBe("0");
    expect(decimalText(1234500n, 6)).toBe("1.2345");
    expect(roundedAmount(123456789012345678n, 18)).toBe(0.12345679);
    expect(roundedAmount(5n, 9)).toBe(0.00000001);
    expect(roundedAmount(4n, 9)).toBe(0);
    expect(roundedAmount(3n, 0)).toBe(3);
    // 2^64 + 1 is not representable as a double; the integer path still rounds correctly.
    expect(decimalText(18446744073709551617n, 0)).toBe("18446744073709551617");
  });

  it("unitsOf accepts only plain integers below 2^256", () => {
    expect(unitsOf("0")).toBe(0n);
    expect(
      unitsOf("115792089237316195423570985008687907853269984665640564039457584007913129639935"),
    ).toBe(2n ** 256n - 1n);
    for (const bad of [
      "115792089237316195423570985008687907853269984665640564039457584007913129639936",
      "-1",
      "01",
      "1.5",
      "1e18",
      " 1",
      "",
      "0x10",
      "9".repeat(79),
      1,
      1.5,
      null,
    ]) {
      expect(unitsOf(bad), String(bad)).toBeUndefined();
    }
  });
});

describe("hostile answers fail the token source with a fixed message and show nothing", () => {
  const cases: [string, unknown, number?][] = [
    ["a huge number", [tokenRow(EVM_TOKEN, "9".repeat(80))]],
    ["a value beyond 2^256", [tokenRow(EVM_TOKEN, (2n ** 256n).toString())]],
    ["a negative value", [tokenRow(EVM_TOKEN, "-5")]],
    ["a fractional value", [tokenRow(EVM_TOKEN, "1.5")]],
    ["an exponent value", [tokenRow(EVM_TOKEN, "1e18")]],
    ["a JSON number value", [{ ...tokenRow(EVM_TOKEN, "1"), value: 1e21 }]],
    ["a hex value", [tokenRow(EVM_TOKEN, "0xff")]],
    ["different decimals than the owner's", [tokenRow(EVM_TOKEN, "1", "6")]],
    ["absurd decimals", [tokenRow(EVM_TOKEN, "1", "255")]],
    ["negative decimals", [tokenRow(EVM_TOKEN, "1", "-1")]],
    ["the same contract twice", [tokenRow(EVM_TOKEN, "1"), tokenRow(EVM_TOKEN, "2")]],
    ["an object where a list belongs", { items: [] }],
    ["null", null],
    ["HTML", "<html><body>Attention <script>alert(1)</script></body></html>"],
    ["a server error with a body", "<h1>leaked-remote-text</h1>", 500],
  ];

  it.each(cases)("%s", async (_name, body, status) => {
    const s = await ethTokens(body, status);
    expect(s.holdings.filter((x) => x.token)).toEqual([]);
    const source = s.sources.find((x) => x.id === "eth:tokens");
    expect(source).toMatchObject({ ok: false });
    expect(source?.error).toMatch(
      /^Ethereum tokens (answered HTTP 500|sent a response in an unexpected format)$/,
    );
    expect(JSON.stringify(s)).not.toMatch(/leaked-remote-text|script|EVIL/);
  });

  it("an oversized answer is refused, not parsed", async () => {
    const s = await ethTokens("[" + `"${"x".repeat(100)}",`.repeat(25_000) + '"y"]');
    expect(s.sources.find((x) => x.id === "eth:tokens")).toMatchObject({
      ok: false,
      error: "Ethereum tokens response is too large",
    });
  });

  it("an NFT row for a watched contract is not counted as a balance", async () => {
    const s = await ethTokens([tokenRow(EVM_TOKEN, "1", "18", "ERC-721")]);
    expect(s.holdings.filter((x) => x.token)).toEqual([]);
  });

  it("a response cannot add a token: unlisted rows, symbols and names are ignored", async () => {
    const s = await ethTokens([
      tokenRow(EVM_OTHER, "5"),
      tokenRow(EVM_TOKEN, "2000000000000000000"),
    ]);
    expect(s.holdings.filter((x) => x.token)).toHaveLength(1);
    expect(JSON.stringify(s)).not.toContain("EVIL");
  });

  it("a native-coin failure and a token failure are separate sources", async () => {
    await ready({
      state: (s) => {
        s.accounts.eth = { [ADDRESSES.eth]: { body: { coin_balance: "1000000000000000000" } } };
        s.tokenAccounts.eth = { [ADDRESSES.eth]: { body: "<html>" } };
      },
      networks: { eth: [ADDRESSES.eth] },
      tokens: ethWatch(),
    });
    const s = await snapshot();
    expect(s.sources.find((x) => x.id === "eth")).toMatchObject({ ok: true });
    expect(s.sources.find((x) => x.id === "eth:tokens")).toMatchObject({ ok: false });
    expect(s.holdings.map((x) => x.asset)).toEqual(["ETH"]);
  });

  it("an Algorand amount beyond 2^53, a negative one and a float are refused", async () => {
    const algoAddress = "A".repeat(58);
    for (const amount of [2 ** 60, -1, 1.5, "7"]) {
      await ready({
        state: (s) => {
          s.accounts.algo = {
            [algoAddress]: { body: { amount: 1, assets: [{ "asset-id": 5, amount }] } },
          };
        },
        networks: { algo: [algoAddress] },
        tokens: { algo: [{ contract: "5", symbol: "TKN", decimals: 2 }] },
      });
      const s = await snapshot();
      expect(
        s.sources.find((x) => x.id === "algo:tokens"),
        String(amount),
      ).toMatchObject({ ok: false });
      expect(s.holdings.filter((x) => x.token)).toEqual([]);
      await h!.close();
      await mock!.close();
      h = mock = undefined;
    }
  });

  it("a Cosmos answer with a next page fails rather than showing a partial list", async () => {
    const atomAddress = "cosmos1" + "q".repeat(38);
    await ready({
      state: (s) => {
        s.accounts.atom = {
          [atomAddress]: { body: { balances: [], pagination: { next_key: "AAAA", total: "9" } } },
        };
      },
      networks: { atom: [atomAddress] },
      tokens: { atom: [{ contract: "ibc/ABCDEF0123", symbol: "OSMO", decimals: 6 }] },
    });
    const s = await snapshot();
    expect(s.sources.find((x) => x.id === "atom:tokens")).toMatchObject({ ok: false });
  });

  it("a Stellar balance with the wrong number of decimals is refused", async () => {
    const address = "G" + "B".repeat(55);
    await ready({
      state: (s) => {
        s.accounts.xlm = {
          [address]: {
            body: {
              balances: [
                {
                  asset_type: "credit_alphanum4",
                  asset_code: "USDC",
                  asset_issuer: ISSUER,
                  balance: "1.5",
                },
              ],
            },
          },
        };
      },
      networks: { xlm: [address] },
      tokens: { xlm: [{ contract: `USDC:${ISSUER}`, symbol: "USDC" }] },
    });
    const s = await snapshot();
    expect(s.sources.find((x) => x.id === "xlm:tokens")).toMatchObject({ ok: false });
  });
});

describe("watch-list validation", () => {
  it("refuses a malformed contract, symbol or decimals in config (schema)", async () => {
    await ready({ networks: { eth: [ADDRESSES.eth] }, tokens: {} });
    await h!.manager.disable("portfolio");
    const bad: unknown[] = [
      { contract: EVM_TOKEN + "/../x", symbol: "A", decimals: 18 },
      { contract: "0x" + "c0".repeat(19), symbol: "A", decimals: 18 },
      { contract: EVM_TOKEN + "\n", symbol: "A", decimals: 18 },
      { contract: EVM_TOKEN, symbol: "<b>", decimals: 18 },
      { contract: EVM_TOKEN, symbol: "A".repeat(13), decimals: 18 },
      { contract: EVM_TOKEN, symbol: "A", decimals: 255 },
      { contract: EVM_TOKEN, symbol: "A", decimals: -1 },
      { contract: EVM_TOKEN, symbol: "A", decimals: 1.5 },
      { contract: EVM_TOKEN, symbol: "A" },
      { contract: EVM_TOKEN, symbol: "A", decimals: 18, extra: true },
    ];
    for (const entry of bad) {
      expect(
        () => h!.manager.configure("portfolio", { tokens: { eth: [entry] } }),
        JSON.stringify(entry),
      ).toThrow();
    }
    // Networks with no token reader cannot be given a list at all.
    expect(() =>
      h!.manager.configure("portfolio", {
        tokens: { btc: [{ contract: EVM_TOKEN, symbol: "A", decimals: 8 }] },
      }),
    ).toThrow();
  });

  it("caps the list at the schema (10) and the code (readWatchList ignores the rest)", async () => {
    await ready({ networks: { eth: [ADDRESSES.eth] }, tokens: {} });
    await h!.manager.disable("portfolio");
    const many = Array.from({ length: MAX_TOKENS_PER_NETWORK + 1 }, (_, i) => ({
      contract: "0x" + i.toString(16).padStart(40, "0"),
      symbol: "T" + i,
      decimals: 18,
    }));
    expect(() => h!.manager.configure("portfolio", { tokens: { eth: many } })).toThrow();

    const read = readWatchList(evmTokens, [...many, ...many, ...many, ...many, ...many, ...many]);
    expect(read.watch).toHaveLength(MAX_TOKENS_PER_NETWORK);
    expect(read.ignored).toBe(many.length * 6 - MAX_TOKENS_PER_NETWORK);
  });

  it("readWatchList drops invalid and repeated entries and lower-cases an EVM contract", () => {
    const read = readWatchList(evmTokens, [
      { contract: EVM_TOKEN.toUpperCase().replace("0X", "0x"), symbol: "A", decimals: 18 },
      { contract: EVM_TOKEN, symbol: "B", decimals: 18 },
      { contract: "nope", symbol: "C", decimals: 18 },
      { contract: EVM_OTHER, symbol: "D", decimals: 99 },
      { contract: EVM_OTHER, symbol: "D e", decimals: 6 },
      "text",
      null,
    ]);
    expect(read.watch).toEqual([{ contract: EVM_TOKEN, symbol: "A", decimals: 18 }]);
    expect(read.ignored).toBe(6);
    expect(readWatchList(evmTokens, "x")).toEqual({ watch: [], ignored: 0 });
  });

  it("a TRON contract needs a correct checksum", () => {
    expect(trc20.normalise(T_CONTRACT)).toBe(T_CONTRACT);
    const broken = T_CONTRACT.slice(0, -1) + (T_CONTRACT.endsWith("a") ? "b" : "a");
    expect(trc20.normalise(broken)).toBeUndefined();
    expect(trc20.normalise("T" + "9".repeat(33))).toBeUndefined();
    expect(trc20.normalise("0x" + "ab".repeat(20))).toBeUndefined();
  });

  it("a watch-list entry that passes the schema but not the checksum is reported, not read", async () => {
    await ready({
      state: (s) => {
        s.accounts.trx = { [ADDRESSES.trx]: { body: { data: [{ balance: 1, trc20: [] }] } } };
      },
      networks: { trx: [ADDRESSES.trx] },
      tokens: { trx: [{ contract: "T" + "9".repeat(33), symbol: "BAD", decimals: 6 }] },
    });
    const s = await snapshot();
    expect(s.sources.find((x) => x.id === "trx:tokens")).toMatchObject({
      ok: false,
      error: expect.stringContaining("1 watch-list entries"),
    });
    expect(s.holdings.filter((x) => x.token)).toEqual([]);
  });

  it("token lists apply only to networks with listed addresses", async () => {
    await ready({
      networks: { eth: [ADDRESSES.eth] },
      tokens: { base: [{ contract: EVM_TOKEN, symbol: "A", decimals: 18 }] },
    });
    await snapshot();
    expect(mock!.requests.some((r) => r.path.includes("token-balances"))).toBe(false);
  });
});

describe("disclosure", () => {
  const inventory = readFileSync(
    join(import.meta.dirname, "..", "..", "..", "docs", "licenses", "INVENTORY.md"),
    "utf8",
  );

  it("every host a token read can contact is in the privacy/licence inventory (no new host)", () => {
    for (const n of NETWORKS.filter((x) => x.tokens)) {
      const host = new URL(n.baseUrl).host;
      const covered = host.endsWith(".blockscout.com")
        ? inventory.includes(".blockscout.com")
        : inventory.includes(`https://${host}`);
      expect(covered, `${n.id}: ${host}`).toBe(true);
    }
  });

  it("the manifest discloses token reads and the config describes the watch list", () => {
    const { manifest } = createPortfolioCapability();
    expect(manifest.data_categories).toContain(
      "token balances of the public addresses you list, for the token contracts you list",
    );
    const text = JSON.stringify(manifest.config_schema);
    expect(text).toContain("the ONLY tokens that are read");
    expect(manifest.permissions).toEqual(["network", "external_api"]);
  });

  it("only networks with a documented keyless GET token route support tokens", () => {
    expect(
      NETWORKS.filter((n) => n.tokens)
        .map((n) => n.id)
        .sort(),
    ).toEqual(
      [
        "algo",
        "arbitrum",
        "atom",
        "base",
        "eth",
        "etc",
        "gnosis",
        "optimism",
        "polygon",
        "trx",
        "xlm",
      ].sort(),
    );
  });
});
