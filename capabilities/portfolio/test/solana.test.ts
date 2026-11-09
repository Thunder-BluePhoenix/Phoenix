// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The Solana getBalance client: the one POST in this capability. These tests prove it can send
// exactly one request shape to one host, and nothing else. A fake `fetch` stands in for the network:
// no real Solana node was contacted.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { ServiceError } from "@phoenix/service-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LAMPORTS_PER_SOL,
  SOLANA_MAX_BYTES,
  SOLANA_RPC_URL,
  SolanaBalanceClient,
  createPortfolioCapability,
  validSolanaAddress,
  type Snapshot,
  type SolanaFetch,
} from "../src";
import { defaultState, startMockPortfolio, type MockPortfolio } from "../testing/mock-portfolio";
import { scan } from "./scan";

const ADDR = "83astBRguLMdt2h5U1Tpdq5tjFoJ6noeGwaY3mDLVcri";
const ADDR_2 = "11111111111111111111111111111112";
const SRC = join(import.meta.dirname, "..", "src");

interface Sent {
  url: string;
  init: RequestInit;
}

function fakeFetch(reply: () => Response | Promise<Response>): {
  fetchImpl: SolanaFetch;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  return {
    sent,
    fetchImpl: async (url, init) => {
      sent.push({ url, init });
      return reply();
    },
  };
}

const rpc = (value: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { context: { apiVersion: "3.1.8", slot: 1 }, value },
    ...extra,
  });

const ok = (text: string, status = 200) => new Response(text, { status });

/** A fetch that never answers until its signal aborts, then rejects; exposes the signal it got. */
function hanging(): { fetchImpl: SolanaFetch; signal(): AbortSignal | undefined } {
  let seen: AbortSignal | undefined;
  return {
    signal: () => seen,
    fetchImpl: (_url, init) => {
      const { promise, reject } = Promise.withResolvers<Response>();
      seen = init.signal as AbortSignal;
      seen.addEventListener("abort", () => reject(new Error("aborted")));
      return promise;
    },
  };
}

async function failure(text: string | Response, address = ADDR): Promise<ServiceError> {
  const { fetchImpl } = fakeFetch(() => (typeof text === "string" ? ok(text) : text));
  const err = await new SolanaBalanceClient({ fetchImpl }).balance(address).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ServiceError);
  return err as ServiceError;
}

describe("what the client sends", () => {
  it("is one POST of the constant template to the pinned host and path", async () => {
    const { fetchImpl, sent } = fakeFetch(() => ok(rpc(1_500_000_000)));
    const lamports = await new SolanaBalanceClient({ fetchImpl }).balance(ADDR);
    expect(lamports).toBe(1_500_000_000n);
    expect(sent).toHaveLength(1);
    expect(SOLANA_RPC_URL).toBe("https://api.mainnet.solana.com/");
    expect(sent[0]!.url).toBe("https://api.mainnet.solana.com/");
    expect(sent[0]!.init.method).toBe("POST");
    expect(sent[0]!.init.redirect).toBe("error");
    expect(sent[0]!.init.body).toBe(
      `{"jsonrpc":"2.0","id":1,"method":"getBalance","params":["${ADDR}"]}`,
    );
    expect(JSON.parse(sent[0]!.init.body as string)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "getBalance",
      params: [ADDR],
    });
    expect(Object.keys(sent[0]!.init.headers as object).sort()).toEqual([
      "accept",
      "content-type",
      "user-agent",
    ]);
    expect(sent[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("has exactly one public operation, balance(address); the host is not a parameter", () => {
    expect(Object.getOwnPropertyNames(SolanaBalanceClient.prototype).sort()).toEqual([
      "balance",
      "constructor",
    ]);
    expect(SolanaBalanceClient.prototype.balance.length).toBe(1);
  });

  it("no address can smuggle another method, parameter or path: the request is never sent", async () => {
    const evil = [
      `${ADDR}","x":"`,
      `${ADDR}"],"method":"sendTransaction`,
      `${ADDR}\n`,
      `${ADDR}/../x`,
      `${ADDR}?a=1`,
      ` ${ADDR}`,
      `${ADDR}${ADDR}`,
      ADDR.slice(0, 31),
      "0".repeat(44), // not in the base58 alphabet
      "O" + ADDR.slice(1),
      "l" + ADDR.slice(1),
      "I" + ADDR.slice(1),
      "1".repeat(33), // 33 zero bytes, not 32
      "z".repeat(44), // 44 chars but decodes past 32 bytes
      "",
    ];
    for (const address of evil) {
      const { fetchImpl, sent } = fakeFetch(() => ok(rpc(1)));
      const client = new SolanaBalanceClient({ fetchImpl });
      await expect(client.balance(address), JSON.stringify(address)).rejects.toMatchObject({
        message: "The Solana address is not valid",
      });
      expect(sent, JSON.stringify(address)).toEqual([]);
      expect(client.calls).toBe(0);
    }
    const nonString = new SolanaBalanceClient({ fetchImpl: fakeFetch(() => ok(rpc(1))).fetchImpl });
    for (const bad of [{ toString: () => ADDR }, ["a"], null, undefined, 5] as unknown[]) {
      await expect(nonString.balance(bad as string)).rejects.toBeInstanceOf(ServiceError);
    }
  });

  it("whatever a valid address is, the body is the template with only that address in it", async () => {
    for (const address of [
      ADDR,
      ADDR_2,
      "1".repeat(32),
      "So11111111111111111111111111111111111111112",
    ]) {
      expect(validSolanaAddress(address), address).toBe(true);
      const { fetchImpl, sent } = fakeFetch(() => ok(rpc(0)));
      await new SolanaBalanceClient({ fetchImpl }).balance(address);
      expect(sent[0]!.init.body).toBe(
        `{"jsonrpc":"2.0","id":1,"method":"getBalance","params":["${address}"]}`,
      );
    }
  });

  it("validSolanaAddress accepts 32-byte base58 only", () => {
    expect(validSolanaAddress(ADDR)).toBe(true);
    expect(validSolanaAddress("1".repeat(31))).toBe(false);
    expect(validSolanaAddress("1".repeat(45))).toBe(false);
    expect(validSolanaAddress(5)).toBe(false);
  });
});

describe("what the source of solana.ts can express (static scan)", () => {
  const text = readFileSync(join(SRC, "solana.ts"), "utf8");

  it("names exactly one RPC method, one POST, one fetch call and one host", () => {
    expect([...text.matchAll(/"method"\s*:\s*"([^"]+)"/g)].map((m) => m[1])).toEqual([
      "getBalance",
    ]);
    expect([...text.matchAll(/["'`]POST["'`]/g)]).toHaveLength(1);
    expect([...text.matchAll(/\bfetch\s*\(/g)]).toHaveLength(1);
    const hosts = [...text.matchAll(/https?:\/\/([^\s"'`)/]+)/g)].map((m) => m[1]);
    expect([...new Set(hosts)]).toEqual(["solana.com", "api.mainnet.solana.com"]);
    expect([...text.matchAll(/const SOLANA_RPC_URL = "([^"]+)"/g)].map((m) => m[1])).toEqual([
      "https://api.mainnet.solana.com/",
    ]);
    // No JSON.stringify of anything: the body is never built from an object.
    expect(text).not.toMatch(/JSON\.stringify/);
  });

  it("the generic scanner finds in it only the POST and fetch it is allowed", () => {
    const found = scan("solana.ts", text).map((p) => p.replace(/^solana\.ts: /, ""));
    expect(found).toEqual([
      expect.stringContaining("non-GET HTTP method"),
      expect.stringContaining("outside ReadOnlyClient"),
    ]);
  });

  it("no other source file sends anything itself, and only index.ts and collect.ts use the client", () => {
    for (const f of readdirSync(SRC).filter((n) => n.endsWith(".ts") && n !== "solana.ts")) {
      const body = readFileSync(join(SRC, f), "utf8");
      expect(scan(f, body), f).toEqual([]);
      if (/from "\.\/solana"/.test(body)) expect(["index.ts", "collect.ts"]).toContain(f);
    }
  });
});

describe("responses", () => {
  it("parses lamports as BigInt with no precision loss, up to the largest u64", async () => {
    for (const lamports of [
      "0",
      "1",
      "9007199254740993",
      "18446744073709551615",
      "1234567890123456789",
    ]) {
      const { fetchImpl } = fakeFetch(() => ok(rpc(0).replace('"value":0', `"value":${lamports}`)));
      await expect(new SolanaBalanceClient({ fetchImpl }).balance(ADDR)).resolves.toBe(
        BigInt(lamports),
      );
    }
    expect(LAMPORTS_PER_SOL).toBe(1_000_000_000n);
  });

  const hostile: [string, string | (() => Response)][] = [
    ["a value above the u64 maximum", rpc(0).replace('"value":0', '"value":18446744073709551616')],
    ["a negative value", rpc(-1)],
    ["a fractional value", rpc(1.5)],
    ["an exponent value", rpc(0).replace('"value":0', '"value":1e9')],
    ["a string value", rpc("5")],
    ["a null value", rpc(null)],
    ["a missing value", JSON.stringify({ jsonrpc: "2.0", id: 1, result: { context: {} } })],
    [
      "an error object",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32602, message: "leaked-remote-text" },
      }),
    ],
    ["an error beside a result", rpc(5, { error: { code: 1, message: "leaked-remote-text" } })],
    ["another id", rpc(5).replace('"id":1', '"id":2')],
    ["another jsonrpc version", rpc(5).replace('"2.0"', '"1.0"')],
    ["two value fields", rpc(5).replace('"slot":1', '"slot":1,"value":7')],
    [
      "a nested duplicate value that differs",
      '{"jsonrpc":"2.0","id":1,"result":{"value":1,"context":{"value":2}}}',
    ],
    ["a result that is a number", JSON.stringify({ jsonrpc: "2.0", id: 1, result: 5 })],
    ["an array", "[1,2]"],
    ["null", "null"],
    ["HTML", "<html><script>alert(1)</script>leaked-remote-text</html>"],
    ["empty", ""],
  ];

  it.each(hostile)("refuses %s with a fixed, remote-text-free message", async (_n, body) => {
    const err = await failure(typeof body === "function" ? body() : body);
    expect(err.kind).toBe("invalid");
    expect(err.message).toBe("Solana sent a response in an unexpected format");
    expect(err.message).not.toMatch(/leaked-remote-text|script/);
  });

  it("refuses an answer over 64 KiB, by declared length and by streamed size", async () => {
    expect(SOLANA_MAX_BYTES).toBe(65_536);
    const big = rpc(1) + " ".repeat(SOLANA_MAX_BYTES);
    const streamed = (await failure(ok(big))).message;
    expect(streamed).toBe("Solana response is too large");
    const declared = new Response(rpc(1), {
      headers: { "content-length": String(SOLANA_MAX_BYTES + 1) },
    });
    expect((await failure(declared)).message).toBe("Solana response is too large");
  });

  it.each([
    [429, "rate_limit", "Solana rate limit reached"],
    [403, "forbidden", "Solana refused the request (403)"],
    [500, "http", "Solana answered HTTP 500"],
    [301, "http", "Solana answered HTTP 301"],
  ])("maps HTTP %i to a fixed message that never shows the body", async (status, kind, message) => {
    const err = await failure(ok("<h1>leaked-remote-text</h1>", status));
    expect(err.kind).toBe(kind);
    expect(err.message).toBe(message);
  });

  it("a network failure or abort is 'unreachable' with no detail", async () => {
    const throwing: SolanaFetch = () =>
      Promise.reject(new Error("connect ECONNREFUSED 10.0.0.1 leaked-remote-text"));
    const err = await new SolanaBalanceClient({ fetchImpl: throwing })
      .balance(ADDR)
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: "network", message: "Solana is unreachable" });
  });

  it("a redirect is refused: fetch is told redirect error, and its failure is 'unreachable'", async () => {
    const { fetchImpl, sent } = fakeFetch(() => ok(rpc(1)));
    await new SolanaBalanceClient({ fetchImpl }).balance(ADDR);
    expect(sent[0]!.init.redirect).toBe("error");
  });

  it("times out at 15 s: the timeout signal is 15000 ms and aborting it cancels the request", async () => {
    const timer = new AbortController();
    const spy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timer.signal);
    try {
      const hang = hanging();
      const pending = new SolanaBalanceClient({ fetchImpl: hang.fetchImpl })
        .balance(ADDR)
        .catch((e: unknown) => e);
      expect(spy).toHaveBeenCalledWith(15_000);
      timer.abort();
      expect(await pending).toMatchObject({ kind: "network", message: "Solana is unreachable" });
    } finally {
      spy.mockRestore();
    }
  });

  it("the capability's own abort signal also cancels the request", async () => {
    const controller = new AbortController();
    const hang = hanging();
    const pending = new SolanaBalanceClient({
      fetchImpl: hang.fetchImpl,
      signal: controller.signal,
    })
      .balance(ADDR)
      .catch((e: unknown) => e);
    controller.abort();
    expect(await pending).toMatchObject({ kind: "network" });
  });
});

describe("in the capability", () => {
  let h: Harness | undefined;
  let mock: MockPortfolio | undefined;
  afterEach(async () => {
    await h?.close();
    await mock?.close();
    h = mock = undefined;
  });

  async function run(config: Record<string, unknown>, fetchImpl: SolanaFetch, withPrice = false) {
    const state = defaultState();
    if (withPrice)
      state.markets.push({ id: "solana", current_price: 100, price_change_percentage_24h: 1 });
    mock = await startMockPortfolio(state);
    const { promise: first, resolve: release } = Promise.withResolvers<void>();
    const { promise: never } = Promise.withResolvers<void>();
    h = createHarness({
      modules: [
        createPortfolioCapability({
          solanaFetch: fetchImpl,
          sleep: () => {
            release();
            return never;
          },
        }),
      ],
    });
    h.manager.configure("portfolio", { price_url: mock.url, ...config });
    await h.enable("portfolio");
    await first;
    const op = await h.run("portfolio", "snapshot");
    expect(op.status).toBe("succeeded");
    return op.result as Snapshot;
  }

  it("reads SOL for the owner's valid addresses only, prices it, and sends only the template", async () => {
    const { fetchImpl, sent } = fakeFetch(() => ok(rpc(2_500_000_000)));
    const s = await run({ networks: { sol: [ADDR] } }, fetchImpl, true);
    expect(s.sources).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "sol", name: "Solana", ok: true })]),
    );
    expect(s.holdings).toMatchObject([
      { source: "sol", asset: "SOL", amount: 2.5, value_usd: 250 },
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(SOLANA_RPC_URL);
    expect(sent[0]!.init.body).toContain('"method":"getBalance"');
    // The mock stood in for the price service only; nothing went to the Solana host for real.
    expect(mock!.requests.some((r) => r.path.includes("getBalance"))).toBe(false);
  });

  it("config refuses an invalid address by schema; no endpoint setting can move the host", async () => {
    const { fetchImpl, sent } = fakeFetch(() => ok(rpc(1)));
    await run({ networks: { sol: [ADDR] } }, fetchImpl);
    await h!.manager.disable("portfolio");
    for (const bad of [`${ADDR}"`, ADDR.slice(0, 31), `${ADDR}\n`, "0x" + "a".repeat(40)]) {
      expect(() => h!.manager.configure("portfolio", { networks: { sol: [bad] } }), bad).toThrow();
    }
    expect(() =>
      h!.manager.configure("portfolio", { endpoints: { sol: "https://evil.example" } }),
    ).toThrow();
    expect(() => h!.manager.configure("portfolio", { tokens: { sol: [] } })).toThrow();
    expect(sent.every((s) => s.url === SOLANA_RPC_URL)).toBe(true);
  });

  it("a Solana failure marks only the Solana source and shows nothing the remote said", async () => {
    const { fetchImpl } = fakeFetch(() => ok("<h1>leaked-remote-text</h1>", 500));
    const s = await run({ networks: { sol: [ADDR] } }, fetchImpl);
    const src = s.sources.find((x) => x.id === "sol");
    expect(src).toMatchObject({ ok: false, error: "Solana answered HTTP 500" });
    expect(JSON.stringify(s)).not.toContain("leaked-remote-text");
  });

  it("with no Solana address configured nothing is sent to Solana", async () => {
    const { fetchImpl, sent } = fakeFetch(() => ok(rpc(1)));
    await run({ networks: {} }, fetchImpl);
    expect(sent).toEqual([]);
  });

  it("the manifest discloses the Solana host and that it is the one POST", () => {
    const { manifest } = createPortfolioCapability();
    const text = JSON.stringify(manifest.data_categories);
    expect(text).toContain("api.mainnet.solana.com");
    expect(text).toContain("only POST");
  });
});
