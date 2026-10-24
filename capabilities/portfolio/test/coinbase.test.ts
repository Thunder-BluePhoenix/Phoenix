// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Coinbase (Phase 68 gap "Coinbase was not attempted"): ES256 JWT signing with node:crypto, read
// only, one fresh token per request. The mock verifies each token with the PUBLIC key of a pair
// generated at test time (no key is committed). Real Coinbase was never contacted: the mock is
// written from the same reading of the documentation as the code, so a misreading would pass.
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COINBASE_HOST,
  EXCHANGES,
  buildJwt,
  createPortfolioCapability,
  exchangeById,
  loadPrivateKey,
  type Snapshot,
} from "../src";
import {
  defaultState,
  startMockPortfolio,
  verifyCoinbaseJwt,
  type MockPortfolio,
  type MockState,
} from "../testing/mock-portfolio";

const T0 = Date.parse("2026-10-19T09:00:00Z");
// Built from parts so no key-name-shaped literal sits in the source tree (gitleaks scans it).
const KEY_NAME = [
  "organizations",
  "11111111-2222-3333-4444-555555555555",
  "apiKeys",
  "aaaa-bbbb-cccc",
].join("/");
const PATH = "/api/v3/brokerage/accounts";

const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const sec1 = pair.privateKey.export({ type: "sec1", format: "pem" }).toString();
const pkcs8 = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
/** How the CDP portal shows the key: one line, newlines written as backslash-n. */
const oneLine = sec1.trim().replaceAll("\n", "\\n");

const decode = (part: string) =>
  JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;

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

const accounts = (extra: unknown[] = [], has_next: unknown = false) => ({
  accounts: [
    {
      uuid: "u1",
      name: "BTC Wallet",
      currency: "BTC",
      type: "ACCOUNT_TYPE_CRYPTO",
      active: true,
      unknown_field: { nested: true },
      available_balance: { value: "0.5", currency: "BTC" },
      hold: { value: "0.25", currency: "BTC" },
    },
    {
      uuid: "u2",
      name: "ETH Vault",
      currency: "ETH",
      type: "ACCOUNT_TYPE_VAULT",
      available_balance: { value: "2", currency: "ETH" },
    },
    {
      uuid: "u3",
      name: "Cash",
      currency: "USD",
      type: "ACCOUNT_TYPE_FIAT",
      available_balance: { value: "900", currency: "USD" },
    },
    {
      uuid: "u4",
      name: "Perp",
      currency: "USDC",
      type: "ACCOUNT_TYPE_PERP_FUTURES",
      available_balance: { value: "50", currency: "USDC" },
    },
    ...extra,
  ],
  has_next,
  size: 4,
});

interface Setup {
  body?: unknown;
  status?: number;
  key?: string;
  secret?: string;
  state?: (s: MockState) => void;
}

async function ready(setup: Setup = {}) {
  const state = defaultState();
  state.exchangeBodies.coinbase = "body" in setup ? setup.body : accounts();
  if (setup.status) state.exchangeStatus = setup.status;
  state.coinbase = { keyName: KEY_NAME, publicKey: pair.publicKey, now: () => clock.now };
  setup.state?.(state);
  mock = await startMockPortfolio(state);
  clock = new Clock();
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
    exchanges: ["coinbase"],
    networks: {},
    endpoints: {},
  });
  await h.manager.setSecret("portfolio", "coinbase_key", setup.key ?? KEY_NAME);
  await h.manager.setSecret("portfolio", "coinbase_secret", setup.secret ?? oneLine);
  await h.enable("portfolio");
  await clock.first();
}

const snapshot = async (): Promise<Snapshot> => {
  const op = await h!.run("portfolio", "snapshot");
  expect(op.status).toBe("succeeded");
  return op.result as Snapshot;
};

const coinbaseRequests = () => mock!.requests.filter((r) => r.path.startsWith("/x/coinbase"));

describe("Coinbase balances", () => {
  it("reads crypto and vault accounts through a JWT the mock verifies with the public key", async () => {
    await ready();
    const s = await snapshot();
    expect(s.sources).toEqual([{ id: "coinbase", name: "Coinbase", kind: "exchange", ok: true }]);
    // available + hold; fiat and futures accounts are not counted; unknown fields are ignored.
    expect(s.holdings.map((x) => [x.label, x.asset, x.amount])).toEqual([
      ["Coinbase", "BTC", 0.75],
      ["Coinbase", "ETH", 2],
    ]);
    expect(s.total_usd).toBe(45_000 + 6_000);
    const requests = coinbaseRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.path).toBe(`/x/coinbase${PATH}?limit=250`);
  });

  it("accepts the key as real multi-line PEM, in SEC1 or PKCS#8 form", async () => {
    for (const secret of [sec1, pkcs8]) {
      await ready({ secret });
      expect((await snapshot()).sources[0]).toMatchObject({ ok: true });
      await h!.close();
      await mock!.close();
    }
    h = mock = undefined;
  });

  it("a token the mock refuses (wrong key pair) is reported as a rejected credential", async () => {
    const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    await ready({
      state: (s) => {
        s.coinbase!.publicKey = other.publicKey;
      },
    });
    const s = await snapshot();
    expect(s.sources[0]).toMatchObject({
      ok: false,
      error: expect.stringMatching(/rejected the credential/),
    });
    expect(s.holdings).toEqual([]);
  });

  it("without the key and secret it says what to add and sends nothing", async () => {
    await ready();
    await h!.manager.deleteSecret("portfolio", "coinbase_secret");
    await clock.tick();
    const before = coinbaseRequests().length;
    const s = await snapshot();
    expect(s.sources[0]).toMatchObject({ ok: false, error: expect.stringContaining("Coinbase") });
    expect(coinbaseRequests()).toHaveLength(before);
  });
});

describe("the JWT", () => {
  it("has exactly the documented header and claims, signed ES256 as raw r||s", () => {
    const key = loadPrivateKey(sec1);
    const token = buildJwt(KEY_NAME, key, PATH, T0 + 400);
    const [header, claims, signature] = token.split(".") as [string, string, string];
    expect(decode(header)).toEqual({
      alg: "ES256",
      kid: KEY_NAME,
      nonce: expect.stringMatching(/^[0-9a-f]{32}$/),
      typ: "JWT",
    });
    expect(decode(claims)).toEqual({
      sub: KEY_NAME,
      iss: "cdp",
      nbf: T0 / 1000,
      exp: T0 / 1000 + 120,
      uri: `GET ${COINBASE_HOST}${PATH}`,
    });
    expect(Buffer.from(signature, "base64url")).toHaveLength(64);
    expect(token).not.toMatch(/[=+/]/);
    const seen = new Set<string>();
    expect(
      verifyCoinbaseJwt(
        token,
        { keyName: KEY_NAME, publicKey: pair.publicKey, now: () => T0 },
        seen,
      ),
    ).toBeUndefined();
  });

  const mockFor = (now: number) => ({
    keyName: KEY_NAME,
    publicKey: pair.publicKey as KeyObject,
    now: () => now,
  });

  it("rejects an expired, a not-yet-valid, an altered and a replayed token", () => {
    const token = buildJwt(KEY_NAME, loadPrivateKey(sec1), PATH, T0);
    expect(verifyCoinbaseJwt(token, mockFor(T0 + 119_000), new Set())).toBeUndefined();
    expect(verifyCoinbaseJwt(token, mockFor(T0 + 120_000), new Set())).toBe("expired");
    expect(verifyCoinbaseJwt(token, mockFor(T0 - 1000), new Set())).toBe("expired");

    const [header, claims, signature] = token.split(".") as [string, string, string];
    const forged = Buffer.from(
      JSON.stringify({ ...decode(claims), uri: "GET api.coinbase.com/api/v3/brokerage/other" }),
    ).toString("base64url");
    expect(verifyCoinbaseJwt(`${header}.${forged}.${signature}`, mockFor(T0), new Set())).toBe(
      "signature",
    );
    const flipped = signature.startsWith("A") ? `B${signature.slice(1)}` : `A${signature.slice(1)}`;
    expect(verifyCoinbaseJwt(`${header}.${claims}.${flipped}`, mockFor(T0), new Set())).toBe(
      "signature",
    );

    const seen = new Set<string>();
    expect(verifyCoinbaseJwt(token, mockFor(T0), seen)).toBeUndefined();
    expect(verifyCoinbaseJwt(token, mockFor(T0), seen)).toBe("nonce reused");
  });

  it("a token signed by another key, or for another key name or path, is refused", () => {
    const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const wrongKey = buildJwt(KEY_NAME, other.privateKey, PATH, T0);
    expect(verifyCoinbaseJwt(wrongKey, mockFor(T0), new Set())).toBe("signature");
    const wrongName = buildJwt("organizations/x/apiKeys/y", loadPrivateKey(sec1), PATH, T0);
    expect(verifyCoinbaseJwt(wrongName, mockFor(T0), new Set())).toBe("kid");
    const wrongPath = buildJwt(KEY_NAME, loadPrivateKey(sec1), "/api/v3/brokerage/x", T0);
    expect(verifyCoinbaseJwt(wrongPath, mockFor(T0), new Set())).toBe("uri");
  });

  it("every request gets a fresh token: a new nonce each time and the clock of that request", async () => {
    await ready();
    await snapshot();
    clock.now = T0 + 300_000;
    await clock.tick();
    clock.now = T0 + 600_000;
    await clock.tick();
    const tokens = coinbaseRequests().map((r) =>
      String(r.headers.authorization).replace("Bearer ", ""),
    );
    expect(tokens.length).toBeGreaterThanOrEqual(3);
    expect(new Set(tokens).size).toBe(tokens.length);
    const nonces = tokens.map((t) => decode(t.split(".")[0]!).nonce);
    expect(new Set(nonces).size).toBe(tokens.length);
    // Each token is valid at the moment of its own request and carries that moment's nbf.
    const nbfs = tokens.map((t) => decode(t.split(".")[1]!).nbf);
    expect(nbfs).toEqual([...nbfs].sort((a, b) => Number(a) - Number(b)));
    expect(new Set(nbfs).size).toBe(tokens.length);
    for (const t of tokens) {
      const claims = decode(t.split(".")[1]!);
      expect(Number(claims.exp) - Number(claims.nbf)).toBe(120);
    }
    // The mock verifies the signature, header, claims, nonce uniqueness and expiry of every one:
    // any fault would have shown up as a rejected credential.
    expect((await snapshot()).sources[0]).toMatchObject({ ok: true });
  });

  it("the uri claim is the fixed endpoint, whatever the secrets or config say", async () => {
    // The mock accepts only uri "GET api.coinbase.com/api/v3/brokerage/accounts", although the
    // request itself went to the loopback mock: the uri names Coinbase, not the test server.
    await ready();
    expect((await snapshot()).sources[0]).toMatchObject({ ok: true });
    const token = String(coinbaseRequests()[0]!.headers.authorization).replace("Bearer ", "");
    expect(decode(token.split(".")[1]!).uri).toBe(`GET ${COINBASE_HOST}${PATH}`);
  });
});

describe("the private key is validated before use", () => {
  const refuse = /ECDSA \(P-256\) private key|API key name/;

  const wrong: [string, string][] = [
    [
      "Ed25519",
      generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    ],
    [
      "RSA",
      generateKeyPairSync("rsa", { modulusLength: 2048 })
        .privateKey.export({ type: "pkcs8", format: "pem" })
        .toString(),
    ],
    [
      "P-384",
      generateKeyPairSync("ec", { namedCurve: "secp384r1" })
        .privateKey.export({ type: "pkcs8", format: "pem" })
        .toString(),
    ],
    [
      "secp256k1",
      generateKeyPairSync("ec", { namedCurve: "secp256k1" })
        .privateKey.export({ type: "pkcs8", format: "pem" })
        .toString(),
    ],
    ["public key", pair.publicKey.export({ type: "spki", format: "pem" }).toString()],
    [
      "encrypted",
      pair.privateKey
        .export({
          type: "pkcs8",
          format: "pem",
          cipher: "aes-256-cbc",
          passphrase: "x".repeat(12),
        })
        .toString(),
    ],
    ["garbage", "not a key at all"],
    ["truncated", sec1.slice(0, sec1.length - 40)],
    [
      "oversize",
      `${["-----BEGIN", "EC", "PRIVATE", "KEY-----"].join(" ")}\n${"A".repeat(5000)}\n${["-----END", "EC", "PRIVATE", "KEY-----"].join(" ")}`,
    ],
  ];

  it.each(wrong)("refuses %s", (_name, pem) => {
    expect(() => loadPrivateKey(pem)).toThrow(refuse);
  });

  it("accepts the P-256 key in every layout", () => {
    for (const pem of [sec1, pkcs8, oneLine, `\n${sec1}\n`]) {
      const key = loadPrivateKey(pem);
      expect(key.asymmetricKeyType).toBe("ec");
      expect(key.asymmetricKeyDetails?.namedCurve).toBe("prime256v1");
    }
  });

  it("a refused key stops the cycle before any request and never appears in the result", async () => {
    for (const [, pem] of wrong.slice(0, 7)) {
      await ready({ secret: pem.includes("\n") ? pem.trim().replaceAll("\n", "\\n") : pem });
      const s = await snapshot();
      expect(s.sources[0]).toMatchObject({
        id: "coinbase",
        ok: false,
        error: expect.stringMatching(refuse),
      });
      expect(coinbaseRequests()).toEqual([]);
      const shown = JSON.stringify([s, h!.events, h!.manager.get("portfolio")]);
      for (const line of pem.split("\n").filter((l) => l.length > 20 && !l.startsWith("-----"))) {
        expect(shown).not.toContain(line);
      }
      await h!.close();
      await mock!.close();
    }
    h = mock = undefined;
  });

  it("a key name that is not organizations/{org}/apiKeys/{key} is refused before any request", async () => {
    const badNames = [
      "my key",
      ["organizations", "x", "apiKeys", ""].join("/"),
      "../../etc/passwd",
      `${KEY_NAME}\n`,
    ];
    for (const name of badNames) {
      await ready({ key: name });
      const s = await snapshot();
      expect(s.sources[0]).toMatchObject({ ok: false, error: expect.stringMatching(/key name/) });
      expect(coinbaseRequests()).toEqual([]);
      await h!.close();
      await mock!.close();
    }
    h = mock = undefined;
  });
});

describe("the secret stays secret", () => {
  it("the private key, the token and the signature appear nowhere that is returned or emitted", async () => {
    await ready();
    const s = await snapshot();
    const token = String(coinbaseRequests()[0]!.headers.authorization).replace("Bearer ", "");
    const body = sec1.split("\n").filter((l) => l.length > 20 && !l.startsWith("-----"));
    expect(body.length).toBeGreaterThan(0);
    const shown = JSON.stringify([
      s,
      h!.events,
      h!.manager.get("portfolio"),
      await h!.manager.checkHealth("portfolio"),
    ]);
    for (const secret of [...body, token, token.split(".")[2]!, oneLine]) {
      expect(shown).not.toContain(secret);
    }
  });

  it("the token goes only to the Coinbase route, never to a network indexer or the price service", async () => {
    await ready({
      state: (s) => {
        s.accounts.eth = { ["0x" + "ab".repeat(20)]: { body: { coin_balance: "1" } } };
      },
    });
    h!.manager.configure("portfolio", {
      exchanges: ["coinbase"],
      networks: { eth: ["0x" + "ab".repeat(20)] },
      price_url: mock!.url,
      endpoints: { eth: mock!.endpoint("eth") },
    });
    await clock.tick();
    for (const r of mock!.requests) {
      expect(r.headers.authorization !== undefined, r.path).toBe(r.path.startsWith("/x/coinbase"));
    }
  });

  it("the secrets are named, described and not settable through config", async () => {
    await ready();
    const view = h!.manager.get("portfolio");
    const names = view.secrets.map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(["coinbase_key", "coinbase_secret"]));
    expect(view.secrets.find((x) => x.name === "coinbase_secret")?.description).toMatch(/ECDSA/);
    expect(() =>
      h!.manager.configure("portfolio", { exchanges: ["coinbase"], coinbase_secret: oneLine }),
    ).toThrow();
    expect(() =>
      h!.manager.configure("portfolio", { endpoints: { coinbase: "https://attacker.example" } }),
    ).toThrow();
  });
});

describe("read only, one host", () => {
  it("every request is a GET without a body, and the exchange host is Coinbase's own", async () => {
    await ready();
    await snapshot();
    expect(coinbaseRequests().length).toBeGreaterThan(0);
    expect(mock!.requests.every((r) => r.method === "GET" && r.body === "")).toBe(true);
    expect(exchangeById("coinbase")?.baseUrl).toBe("https://api.coinbase.com");
    expect(COINBASE_HOST).toBe("api.coinbase.com");
  });

  it("no non-GET request can be built: buildJwt has no method input and the uri says GET", () => {
    // 4 inputs: key name, key, path, clock. A method cannot be passed.
    expect(buildJwt.length).toBe(4);
    for (const path of [PATH, "/api/v3/brokerage/x"]) {
      const token = buildJwt(KEY_NAME, loadPrivateKey(sec1), path, T0);
      expect(String(decode(token.split(".")[1]!).uri)).toMatch(/^GET api\.coinbase\.com\//);
    }
    const src = readFileSync(join(import.meta.dirname, "..", "src", "coinbase-jwt.ts"), "utf8");
    expect(src).not.toMatch(/\b(?:POST|PUT|PATCH|DELETE)\b/);
    const spec = exchangeById("coinbase")!;
    const request = spec.sign({ key: KEY_NAME, secret: sec1 }, T0);
    expect(request.path).toBe(`${PATH}?limit=250`);
    expect(Object.keys(request.headers)).toEqual(["Authorization"]);
  });
});

describe("responses are parsed defensively", () => {
  it("skips malformed entries, bad numbers and unknown types without failing the others", async () => {
    await ready({
      body: accounts([
        null,
        "text",
        { currency: "LTC", type: "ACCOUNT_TYPE_CRYPTO", available_balance: { value: "-3" } },
        { currency: "DOGE", type: "ACCOUNT_TYPE_CRYPTO", available_balance: { value: "1e9" } },
        { currency: "XRP", type: "ACCOUNT_TYPE_CRYPTO", available_balance: { value: 7 } },
        { currency: "ADA", type: "ACCOUNT_TYPE_CRYPTO", available_balance: "5" },
        { currency: "<script>", type: "ACCOUNT_TYPE_CRYPTO", available_balance: { value: "1" } },
        { currency: "ZZZ", type: "ACCOUNT_TYPE_CRYPTO", available_balance: { value: "0" } },
        { currency: "USDT", type: "ACCOUNT_TYPE_WHATEVER", available_balance: { value: "5" } },
      ]),
    });
    const s = await snapshot();
    expect(s.sources[0]).toMatchObject({ ok: true });
    expect(s.holdings.map((x) => [x.asset, x.amount])).toEqual([
      ["BTC", 0.75],
      ["ETH", 2],
    ]);
    expect(JSON.stringify(s)).not.toContain("SCRIPT");
  });

  it.each([
    ["more pages than one", accounts([], true)],
    ["no has_next", { accounts: [] }],
    ["accounts is not an array", { accounts: {}, has_next: false }],
    ["an array", []],
    ["a string", "hello"],
    ["null", null],
  ])("a response with %s is an unusable source, not a guess", async (_name, body) => {
    await ready({ body });
    const s = await snapshot();
    expect(s.sources[0]).toMatchObject({ ok: false });
    expect(s.holdings).toEqual([]);
    expect(s.total_usd).toBeUndefined();
  });

  it("garbage and oversize bodies are refused with a fixed message", async () => {
    await ready({ body: "<<< not json >>> sk-do-not-echo" });
    let s = await snapshot();
    expect(s.sources[0]).toMatchObject({
      ok: false,
      error: expect.stringMatching(/unexpected format/),
    });
    expect(JSON.stringify(s)).not.toContain("do-not-echo");
    await h!.close();
    await mock!.close();

    const huge = JSON.stringify(accounts([{ pad: "x".repeat(3 * 1024 * 1024) }]));
    await ready({ body: huge });
    s = await snapshot();
    expect(s.sources[0]).toMatchObject({ ok: false });
    expect(s.holdings).toEqual([]);
  });

  it.each([
    [401, /rejected the credential/],
    [403, /lacks permission/],
    [429, /rate limit/],
    [500, /HTTP 500/],
  ])("HTTP %i is shown as a fixed message", async (status, message) => {
    await ready({ status });
    const s = await snapshot();
    expect(s.sources[0]).toMatchObject({ ok: false, error: expect.stringMatching(message) });
  });
});
