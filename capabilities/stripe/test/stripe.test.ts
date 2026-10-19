// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The Stripe capability against a mock shaped from Stripe's API reference, on 127.0.0.1 only.
// Nothing in this file contacts the real Stripe. The safety property under test is that the
// capability is read-only: it cannot create, refund or otherwise change anything.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chargeTracker,
  diffCharges,
  formatMoney,
  parseBalance,
  parseCharge,
  parseCharges,
  createStripeCapability,
  summarise,
} from "../src";
import { Clock } from "../testing/clock";
import {
  MOCK_KEY,
  REMOTE_MARKER,
  charge,
  startMockStripe,
  type MockStripe,
} from "../testing/mock-stripe";

const T0 = Date.parse("2026-10-05T09:00:00Z");
const later = (s: number) => (T0 + s * 1000) / 1000;

let h: Harness | undefined;
let mock: MockStripe | undefined;
let clock: Clock;

afterEach(async () => {
  await h?.close();
  await mock?.close();
  h = mock = undefined;
});

async function ready(
  options: {
    key?: string | null;
    config?: Record<string, unknown>;
    data?: (m: MockStripe) => void;
  } = {},
) {
  mock = await startMockStripe();
  clock = new Clock();
  options.data?.(mock);
  h = createHarness({
    modules: [createStripeCapability({ now: () => clock.now, sleep: clock.sleep })],
  });
  h.manager.configure("stripe", { base_url: mock.url, ...options.config });
  const key = options.key === undefined ? MOCK_KEY : options.key;
  if (key) await h.manager.setSecret("stripe", "restricted_key", key);
  await h.enable("stripe");
  await clock.first();
}

const types = () => h!.types("stripe");
const health = async () => (await h!.manager.checkHealth("stripe")).health;
const everything = (ops: unknown[] = []) =>
  JSON.stringify({ ops, events: h!.events, audit: h!.db.prepare("SELECT * FROM audit_log").all() });

describe("read-only by construction", () => {
  it("the manifest has no command that writes, executes, sends or touches production", async () => {
    await ready();
    const { manifest } = createStripeCapability();
    expect(manifest.commands.length).toBeGreaterThan(0);
    for (const c of manifest.commands) {
      expect(["none", "read"], c.name).toContain(c.side_effect);
    }
    expect(manifest.commands.map((c) => c.name)).toEqual(["status"]);
    const view = h!.manager.get("stripe");
    expect(view.commands.every((c) => c.side_effect === "read")).toBe(true);
  });

  it("no source file imports ServiceClient or calls a `.post(` method", () => {
    const dir = join(import.meta.dirname, "..", "src");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const text = readFileSync(join(dir, file), "utf8");
      // Only import statements count: a comment may name the class it avoids.
      const imports = text.match(/^import[^;]*;/gm) ?? [];
      expect(imports.join("\n"), file).not.toMatch(/\bServiceClient\b/);
      expect(text, file).not.toMatch(/\.post\s*\(/);
    }
  });

  it("everything it ever sends is a GET, including polling and status", async () => {
    await ready({ data: (m) => m.charges.push(charge({ created: T0 / 1000 - 10 })) });
    await h!.run("stripe", "status");
    await clock.tick();
    expect(mock!.nonGet).toEqual([]);
    expect(mock!.service.requests.length).toBeGreaterThan(2);
    for (const r of mock!.service.requests) expect(r.method).toBe("GET");
  });

  it("a command that does not exist cannot be invoked (no refund, no charge)", async () => {
    await ready();
    for (const name of ["refund", "charge.create", "payout", "redeploy"]) {
      await expect(h!.run("stripe", name, {})).rejects.toThrow();
    }
    expect(mock!.nonGet).toEqual([]);
  });
});

describe("manifest and configuration", () => {
  it("asks for network + external_api and keeps the key out of config and views", async () => {
    await ready();
    const view = h!.manager.get("stripe");
    expect(view.permissions.map((p) => p.permission)).toEqual(["network", "external_api"]);
    expect(view.secrets).toEqual([expect.objectContaining({ name: "restricted_key", set: true })]);
    expect(JSON.stringify(view)).not.toContain(MOCK_KEY);
    expect(() => h!.manager.configure("stripe", { base_url: "http://api.example.com" })).toThrow();
    expect(() =>
      h!.manager.configure("stripe", { base_url: "https://u:p@api.example.com" }),
    ).toThrow();
    expect(() => h!.manager.configure("stripe", { api_key: MOCK_KEY })).toThrow();
  });
});

describe("parsing", () => {
  it("keeps only ids, status, amount, currency, time and the receipt link; never personal data", () => {
    const parsed = parseCharge(charge());
    expect(parsed).toEqual({
      id: "ch_3Abc123",
      status: "succeeded",
      amount: 2000,
      currency: "usd",
      createdAt: Date.parse("2026-10-05T10:00:00Z"),
      refunded: false,
      livemode: false,
      failureCode: undefined,
      url: "https://pay.stripe.com/receipts/ch_3Abc123",
    });
    const text = JSON.stringify(parsed);
    expect(text).not.toContain("Ada");
    expect(text).not.toContain("example.com/");
    expect(text).not.toContain("customer@");
  });

  it.each([
    ["fractional amount", { amount: 10.5 }],
    ["string amount", { amount: "2000" }],
    ["huge amount", { amount: 1e30 }],
    ["bad currency", { currency: "dollars" }],
    ["unknown status", { status: "teleported" }],
    ["id that is not a charge", { id: "../../x" }],
    ["no created", { created: undefined }],
  ])("skips a charge with %s", (_n, over) => {
    expect(parseCharge({ ...charge(), ...over })).toBeUndefined();
  });

  it("drops non-https receipt links and odd failure codes", () => {
    const c = parseCharge(
      charge({ receipt_url: "javascript:alert(1)", failure_code: "DROP;TABLE", status: "failed" }),
    );
    expect(c?.url).toBeUndefined();
    expect(c?.failureCode).toBeUndefined();
    expect(parseCharge(charge({ receipt_url: "http://pay.example/x" }))?.url).toBeUndefined();
  });

  it("parseCharges skips broken entries and throws on the wrong shape", () => {
    expect(
      parseCharges({ data: [null, 1, "x", charge({ id: "ch_ok" }), { id: REMOTE_MARKER }] }).map(
        (c) => c.id,
      ),
    ).toEqual(["ch_ok"]);
    expect(() => parseCharges({ data: "x" })).toThrow();
    expect(() => parseCharges(null)).toThrow();
  });

  it("parseBalance needs both lists and skips bad amounts", () => {
    expect(
      parseBalance({
        available: [
          { amount: 5, currency: "EUR" },
          { amount: "x", currency: "usd" },
        ],
        pending: [],
      }),
    ).toEqual({ available: [{ amount: 5, currency: "eur" }], pending: [] });
    expect(() => parseBalance({ available: [] })).toThrow();
  });

  it("formats minor units by the currency's decimals", () => {
    expect(formatMoney(2000, "usd")).toBe("20.00 USD");
    expect(formatMoney(-5, "eur")).toBe("-0.05 EUR");
    expect(formatMoney(1500, "jpy")).toBe("1500 JPY");
    expect(formatMoney(1500, "kwd")).toBe("1.500 KWD");
  });
});

describe("events", () => {
  const live = Date.parse("2026-10-05T09:00:00Z");
  const parsed = (over = {}) => parseCharge(charge(over))!;

  it("history rule: charges that settled before enabling are silent", () => {
    const t = chargeTracker(live);
    expect(
      diffCharges(t, [
        parsed({ created: live / 1000 - 3600 }),
        parsed({ id: "ch_2", status: "failed", created: live / 1000 - 5 }),
      ]),
    ).toEqual([]);
  });

  it("a new succeeded or failed charge is announced once; pending says nothing until it settles", () => {
    const t = chargeTracker(live);
    const ok = diffCharges(t, [parsed({ created: later(5) })]);
    expect(ok).toMatchObject([
      { event_type: "stripe.payment.succeeded", severity: "success", subject: "20.00 USD" },
    ]);
    expect(diffCharges(t, [parsed({ created: later(5) })])).toEqual([]);
    expect(diffCharges(t, [parsed({ id: "ch_p", status: "pending", created: later(6) })])).toEqual(
      [],
    );
    const failed = diffCharges(t, [
      parsed({ id: "ch_p", status: "failed", failure_code: "card_declined", created: later(6) }),
    ]);
    expect(failed).toMatchObject([{ event_type: "stripe.payment.failed", severity: "warning" }]);
    expect(failed[0]!.payload).toEqual({
      charge_id: "ch_p",
      amount: 2000,
      currency: "usd",
      livemode: false,
      failure_code: "card_declined",
      url: "https://pay.stripe.com/receipts/ch_p",
    });
  });

  it("summarise counts and totals per currency", () => {
    const s = summarise([
      parsed({ id: "ch_a", amount: 1000 }),
      parsed({ id: "ch_b", amount: 250 }),
      parsed({ id: "ch_c", amount: 400, currency: "eur", status: "failed" }),
      parsed({ id: "ch_d", status: "pending" }),
    ]);
    expect(s).toEqual({
      charges_counted: 4,
      succeeded: {
        count: 2,
        totals: [{ currency: "usd", count: 2, amount: 1250, display: "12.50 USD" }],
      },
      failed: {
        count: 1,
        totals: [{ currency: "eur", count: 1, amount: 400, display: "4.00 EUR" }],
      },
      pending: { count: 1 },
    });
  });
});

describe("polling through the capability", () => {
  it("history rule: nothing from before enabling is replayed", async () => {
    await ready({
      data: (m) =>
        m.charges.push(
          charge({ id: "ch_old1", created: T0 / 1000 - 86400 }),
          charge({ id: "ch_old2", status: "failed", created: T0 / 1000 - 600 }),
        ),
    });
    expect(types()).toEqual([]);
    expect(h!.state.snapshot().state).toBe("IDLE");
  });

  it("a payment after enabling becomes an event and a brief SUCCESS; a failed one a WARNING", async () => {
    await ready();
    mock!.charges.push(charge({ id: "ch_new1", created: later(10) }));
    await clock.tick();
    await vi.waitFor(() => expect(types()).toEqual(["stripe.payment.succeeded"]));
    await h!.drain();
    expect(h!.state.snapshot()).toMatchObject({
      state: "SUCCESS",
      explanation: "Payment received: 20.00 USD",
    });
    mock!.charges.push(
      charge({
        id: "ch_new2",
        status: "failed",
        failure_code: "card_declined",
        created: later(20),
      }),
    );
    await clock.tick();
    await vi.waitFor(() => expect(types()).toContain("stripe.payment.failed"));
    await h!.drain();
    expect(h!.state.snapshot().conditions.some((c) => c.state === "WARNING")).toBe(true);
    expect(everything()).not.toContain("Ada");
    expect(everything()).not.toContain("customer@");
  });

  it("sends the key only as a Bearer header to base_url", async () => {
    await ready();
    expect(mock!.service.requests[0]!.path).toBe("/v1/charges?limit=25");
    for (const r of mock!.service.requests)
      expect(r.headers.authorization).toBe(`Bearer ${MOCK_KEY}`);
  });

  it("without a key it makes no request and health is degraded", async () => {
    await ready({ key: null });
    expect(mock!.service.requests).toEqual([]);
    expect(await health()).toMatchObject({ status: "degraded" });
  });

  it("makes no request while unwatched and resumes when someone watches", async () => {
    mock = await startMockStripe();
    clock = new Clock();
    h = createHarness({
      modules: [createStripeCapability({ now: () => clock.now, sleep: clock.sleep })],
    });
    h.manager.presence.setClients(0);
    h.manager.configure("stripe", { base_url: mock.url });
    await h.manager.setSecret("stripe", "restricted_key", MOCK_KEY);
    await h.enable("stripe");
    await new Promise((r) => setImmediate(r));
    expect(mock.service.requests).toEqual([]);
    h.manager.presence.setClients(1);
    await clock.first();
    expect(mock.service.requests).toHaveLength(1);
    h.manager.presence.setClients(0);
    clock.release();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(mock.service.requests).toHaveLength(1);
  });
});

describe("failures", () => {
  it("401: degraded, waits >= 5 minutes, neither key nor remote text in the message", async () => {
    await ready({
      data: (m) =>
        (m.override.current = () => ({ status: 401, body: { error: { message: REMOTE_MARKER } } })),
    });
    expect(clock.sleeps[0]).toBeGreaterThanOrEqual(300_000);
    const status = await health();
    expect(status.status).toBe("degraded");
    expect(JSON.stringify(status)).not.toContain(REMOTE_MARKER);
    expect(JSON.stringify(status)).not.toContain(MOCK_KEY);
  });

  it("429 with Retry-After is honoured", async () => {
    await ready({
      data: (m) =>
        (m.override.current = () => ({ status: 429, headers: { "retry-after": "90" }, body: {} })),
    });
    expect(clock.sleeps[0]).toBeGreaterThanOrEqual(90_000);
    expect((await health()).status).toBe("degraded");
  });

  it("a redirect is not followed", async () => {
    const other = await startMockStripe();
    try {
      await ready({
        data: (m) =>
          (m.override.current = () => ({
            status: 307,
            headers: { location: `${other.url}/v1/charges` },
            body: {},
          })),
      });
      expect(other.service.requests).toEqual([]);
      expect((await health()).status).toBe("unhealthy");
    } finally {
      await other.close();
    }
  });

  it("an oversized response is cut off", async () => {
    await ready({
      data: (m) =>
        (m.override.current = () => ({
          body: JSON.stringify({ data: [], pad: "x".repeat(2 * 1024 * 1024 + 10) }),
        })),
    });
    expect((await health()).status).toBe("unhealthy");
    expect(types()).toEqual([]);
  });

  it.each([
    ["not JSON", "<html>REMOTE</html>"],
    ["a string", '"REMOTE"'],
    ["wrong shape", JSON.stringify({ data: { a: 1 } })],
  ])("a hostile body (%s) makes no events and leaks no text", async (_n, body) => {
    await ready({ data: (m) => (m.override.current = () => ({ body })) });
    expect(types()).toEqual([]);
    const status = await health();
    expect(status.status).toBe("unhealthy");
    expect(JSON.stringify(status)).not.toContain("REMOTE");
  });
});

describe("status", () => {
  it("shows counts, amounts and the balance, not who paid", async () => {
    await ready({
      data: (m) =>
        m.charges.push(
          charge({ id: "ch_a", amount: 1000, created: T0 / 1000 - 30 }),
          charge({
            id: "ch_b",
            amount: 500,
            status: "failed",
            failure_code: "card_declined",
            created: T0 / 1000 - 20,
          }),
        ),
    });
    const op = await h!.run("stripe", "status");
    expect(op.status).toBe("succeeded");
    expect(op.result).toMatchObject({
      configured: true,
      summary: {
        charges_counted: 2,
        succeeded: { count: 1, totals: [{ currency: "usd", amount: 1000, display: "10.00 USD" }] },
        failed: { count: 1 },
      },
      balance: {
        available: [{ currency: "usd", amount: 123456, display: "1234.56 USD" }],
        pending: [{ currency: "usd", amount: 7800, display: "78.00 USD" }],
      },
    });
    expect(everything([op])).not.toContain(MOCK_KEY);
    expect(everything([op])).not.toContain("Ada");
    expect(mock!.nonGet).toEqual([]);
  });

  it("says so when no key is set, without calling out", async () => {
    await ready({ key: null });
    const op = await h!.run("stripe", "status");
    expect(op.result).toMatchObject({ configured: false, items: [] });
    expect(mock!.service.requests).toEqual([]);
  });

  it("a 403 (key lacks Balance access) is reported without leaking text", async () => {
    await ready();
    mock!.override.current = (path) =>
      path.startsWith("/v1/balance") ? { status: 403, body: REMOTE_MARKER } : undefined;
    const op = await h!.run("stripe", "status");
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/403/);
    expect(JSON.stringify(op)).not.toContain(REMOTE_MARKER);
  });
});
