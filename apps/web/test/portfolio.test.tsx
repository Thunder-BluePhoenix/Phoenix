// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import {
  formatAmount,
  formatPct,
  formatUsd,
  sparklinePath,
  type PortfolioSnapshot,
} from "../src/core/portfolio";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";
import { expectInert, sendEvent, XSS } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => cleanup());

const capability = (id: string, status: "enabled" | "installed") => ({
  id,
  name: id,
  version: "0.1.0",
  description: id,
  kind: "builtin",
  status,
  health: { status: "healthy" },
  permissions: [],
  commands: [],
  data_categories: [],
});

type Routes = Parameters<typeof fakeApi>[0];

function snapshotRoutes(result: () => unknown): Routes {
  return {
    "GET /api/capabilities": () => ({ capabilities: [capability("portfolio", "enabled")] }),
    "POST /api/capabilities/portfolio/commands/snapshot": () => ({ id: "op-portfolio" }),
    "GET /api/operations/op-portfolio": () => ({ status: "succeeded", result: result() }),
  };
}

function open(routes: Routes) {
  const api = fakeApi(routes);
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  const view = render(
    <CoreProvider client={client}>
      <App />
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
  fireEvent.click(screen.getByRole("button", { name: /^Fawkes/ }));
  return { api, ws: FakeWebSocket.last, container: view.container };
}

const snapshot = (over: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot => ({
  updated_at: new Date().toISOString(),
  total_usd: 12345.678,
  change_24h_pct: -1.5,
  sparkline: [10, 12, 11, 15],
  holdings: [
    {
      source: "eth",
      kind: "network",
      label: "Main wallet",
      asset: "ETH",
      amount: 1.5,
      price_usd: 2000,
      value_usd: 3000,
      change_24h_pct: 2.345,
    },
    {
      source: "kraken",
      kind: "exchange",
      label: "Kraken",
      asset: "BTC",
      amount: 0.12345678,
      value_usd: 9345.678,
      change_24h_pct: -3,
    },
  ],
  sources: [
    { id: "eth", name: "Ethereum", kind: "network", ok: true },
    { id: "kraken", name: "Kraken", kind: "exchange", ok: true },
  ],
  unpriced: 0,
  price_source: "public price feed",
  note: "Display only; nothing here can trade.",
  ...over,
});

const glance = async () =>
  (await screen.findByRole("heading", { name: "Portfolio" })).closest("section")!;

describe("Portfolio glance", () => {
  it("is absent, and calls nothing, while the capability is off", async () => {
    const { api } = open({
      "GET /api/capabilities": () => ({ capabilities: [capability("portfolio", "installed")] }),
    });
    await screen.findByRole("heading", { name: "Active tasks" });
    expect(screen.queryByRole("heading", { name: "Portfolio" })).toBeNull();
    expect(api.calls.some((c) => c.path.includes("/commands/"))).toBe(false);
  });

  it("shows the total, the signed change, holdings and the display-only footer", async () => {
    open(snapshotRoutes(() => snapshot()));
    const sec = await glance();
    expect(await within(sec).findByText("$12,345.68")).toBeTruthy();
    const change = within(sec).getByText("-1.50%");
    expect(change.className).toContain("error-text");
    expect(within(sec).getByText("Main wallet")).toBeTruthy();
    expect(within(sec).getByText("ETH")).toBeTruthy();
    expect(within(sec).getByText(/1\.5$/)).toBeTruthy();
    expect(within(sec).getByText(/\$3,000\.00/)).toBeTruthy();
    expect(within(sec).getByText("+2.35%").className).toContain("success-text");
    expect(within(sec).getByText(/0\.12345678/)).toBeTruthy();
    expect(within(sec).getByText(/Prices: public price feed/)).toBeTruthy();
    expect(within(sec).getByText(/Display only; nothing here can trade/)).toBeTruthy();
  });

  it("draws the 7-day line as an inline image with a finite path", async () => {
    open(snapshotRoutes(() => snapshot()));
    const sec = await glance();
    const svg = await within(sec).findByRole("img", { name: "7-day value" });
    const d = svg.querySelector("path")!.getAttribute("d")!;
    expect(d).toMatch(/^M0\.00 [\d.]+ L/);
    expect(d).not.toContain("NaN");
    expect(sec.querySelector("img")).toBeNull();
  });

  it("omits the line when there are fewer than two usable points", async () => {
    open(snapshotRoutes(() => snapshot({ sparkline: [5] })));
    const sec = await glance();
    await within(sec).findByText("$12,345.68");
    expect(within(sec).queryByRole("img", { name: "7-day value" })).toBeNull();
  });

  it("names every source that could not be read, with its error", async () => {
    open(
      snapshotRoutes(() =>
        snapshot({
          sources: [
            { id: "eth", name: "Ethereum", kind: "network", ok: true },
            { id: "kraken", name: "Kraken", kind: "exchange", ok: false, error: "rate limited" },
            { id: "btc", name: "Bitcoin", kind: "network", ok: false },
          ],
          unpriced: 2,
        }),
      ),
    );
    const sec = await glance();
    expect(await within(sec).findByText("Kraken: rate limited")).toBeTruthy();
    expect(within(sec).getByText("Bitcoin: could not be read")).toBeTruthy();
    expect(within(sec).queryByText(/Ethereum:/)).toBeNull();
    expect(within(sec).getByText(/2 without a price/)).toBeTruthy();
  });

  it("says plainly that nothing has loaded yet", async () => {
    open(
      snapshotRoutes(() => ({
        updated_at: null,
        holdings: [],
        sources: [],
        unpriced: 0,
        price_source: "",
        note: "",
      })),
    );
    const sec = await glance();
    expect(await within(sec).findByText("Not yet loaded.")).toBeTruthy();
    expect(within(sec).queryByRole("img")).toBeNull();
    expect(within(sec).queryByText(/\$/)).toBeNull();
  });

  it("keeps hostile labels and errors inert text", async () => {
    const { container } = open(
      snapshotRoutes(() =>
        snapshot({
          holdings: [
            { source: "x", kind: "network", label: XSS, asset: "ETH", amount: 1, value_usd: 1 },
          ],
          sources: [{ id: "x", name: "Node", kind: "network", ok: false, error: XSS }],
        }),
      ),
    );
    await screen.findByText(XSS);
    expectInert(container);
  });

  it("copes with a result whose fields have the wrong types", async () => {
    open(
      snapshotRoutes(() => ({
        updated_at: new Date().toISOString(),
        total_usd: "lots",
        holdings: [{ label: "A", asset: "ETH", amount: "1", value_usd: null }, "junk"],
        sources: "none",
      })),
    );
    const sec = await glance();
    expect(await within(sec).findByText("A")).toBeTruthy();
    expect(sec.textContent).not.toContain("NaN");
    expect(sec.textContent).not.toContain("undefined");
  });

  it("refreshes on portfolio.snapshot.updated only", async () => {
    let total = 100;
    const { api, ws } = open(snapshotRoutes(() => snapshot({ total_usd: total })));
    const sec = await glance();
    await within(sec).findByText("$100.00");
    total = 250;
    sendEvent(ws, 1, "portfolio.something.else");
    sendEvent(ws, 2, "portfolio.snapshot.updated");
    expect(await within(sec).findByText("$250.00")).toBeTruthy();
    await waitFor(() =>
      expect(api.posts("/api/capabilities/portfolio/commands/snapshot")).toHaveLength(2),
    );
  });
});

describe("sparklinePath", () => {
  it("scales into the box with the highest value at the top", () => {
    expect(sparklinePath([0, 10], 100, 20)).toBe("M0.00 20.00 L100.00 0.00");
    expect(sparklinePath([0, 5, 10], 100, 20)).toBe("M0.00 20.00 L50.00 10.00 L100.00 0.00");
  });

  it("draws a constant series as a flat line in the middle", () => {
    expect(sparklinePath([5, 5, 5], 100, 20)).toBe("M0.00 10.00 L50.00 10.00 L100.00 10.00");
  });

  it("drops non-finite points instead of printing NaN", () => {
    const d = sparklinePath([1, Number.NaN, 3, Number.POSITIVE_INFINITY], 100, 20);
    expect(d).toBe(sparklinePath([1, 3], 100, 20));
    expect(d).not.toMatch(/NaN|Infinity/);
  });

  it("returns undefined without two finite points", () => {
    expect(sparklinePath([], 100, 20)).toBeUndefined();
    expect(sparklinePath([4], 100, 20)).toBeUndefined();
    expect(sparklinePath([Number.NaN, 4], 100, 20)).toBeUndefined();
  });

  it("handles negative values and an empty box", () => {
    expect(sparklinePath([-10, -20], 100, 20)).toBe("M0.00 0.00 L100.00 20.00");
    expect(sparklinePath([1, 2], 0, 20)).toBeUndefined();
  });
});

describe("formatters", () => {
  it("formats USD with two decimals, grouping and a leading minus", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(1234.5)).toBe("$1,234.50");
    expect(formatUsd(-1234.567)).toBe("-$1,234.57");
    expect(formatUsd(0.004)).toBe("$0.00");
  });

  it("shows a dash for a missing or non-finite value", () => {
    for (const f of [formatUsd, formatPct, formatAmount]) {
      expect(f(undefined)).toBe("\u2014");
      expect(f(Number.NaN)).toBe("\u2014");
      expect(f(Number.POSITIVE_INFINITY)).toBe("\u2014");
    }
  });

  it("signs a percentage and drops the sign when it rounds to zero", () => {
    expect(formatPct(1.234)).toBe("+1.23%");
    expect(formatPct(-2)).toBe("-2.00%");
    expect(formatPct(0)).toBe("0.00%");
    expect(formatPct(0.004)).toBe("0.00%");
    expect(formatPct(-0.004)).toBe("0.00%");
    expect(formatPct(0.005)).toBe("+0.01%");
  });

  it("shows up to 8 decimals without trailing zeros", () => {
    expect(formatAmount(0)).toBe("0");
    expect(formatAmount(1.5)).toBe("1.5");
    expect(formatAmount(1000)).toBe("1,000");
    expect(formatAmount(0.123456789)).toBe("0.12345679");
    expect(formatAmount(1234.5)).toBe("1,234.5");
  });

  it("does not show a tiny positive amount as zero", () => {
    expect(formatAmount(1e-9)).toBe("<0.00000001");
  });
});
