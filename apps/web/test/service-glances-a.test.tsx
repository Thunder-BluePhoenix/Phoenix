// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceGlances } from "../src/components/ServiceGlances";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import {
  parseN8nGlance,
  parseStripeGlance,
  parseVercelGlance,
} from "../src/core/service-glances-a";
import { cleanText, httpsUrl } from "../src/core/service-glances";
import { fakeApi, type FakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";
import { capability, sendEvent, XSS } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

type Routes = NonNullable<Parameters<typeof fakeApi>[0]>;

const SERVICES = ["vercel", "stripe", "n8n"] as const;
const WRITE_COMMANDS = ["redeploy", "run_again", "pause_workflow"];

/** The capability list with the given services at the given status. */
const caps = (status: Record<string, "enabled" | "installed">): Routes => ({
  "GET /api/capabilities": () => ({
    capabilities: Object.entries(status).map(([id, s]) => capability(id, s)),
  }),
});

/** `status` for one capability: POST starts `op-<id>`, GET reports the outcome. */
function statusRoute(id: string, outcome: () => unknown): Routes {
  return {
    [`POST /api/capabilities/${id}/commands/status`]: () => ({ id: `op-${id}` }),
    [`GET /api/operations/op-${id}`]: () => outcome(),
  };
}
const ok = (result: unknown) => () => ({ status: "succeeded", result });

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
      <ServiceGlances />
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
  return { api, ws: FakeWebSocket.last, container: view.container };
}

const section = async (name: string) =>
  (await screen.findByRole("heading", { name })).closest("section")!;

/** Every POST Core received: only the read command `status`, never a write command. */
function expectOnlyStatusPosts(api: FakeApi) {
  const posts = api.calls.filter((c) => c.method === "POST");
  for (const p of posts) {
    expect(p.path).toMatch(/^\/api\/capabilities\/(vercel|stripe|n8n)\/commands\/status$/);
    expect(p.body).toEqual({ input: {} });
  }
  for (const c of api.calls) for (const w of WRITE_COMMANDS) expect(c.path).not.toContain(w);
}

// The exact shapes of the capabilities' `status` results (service-kit ServiceStatus and friends).
const vercelStatus = (over: Record<string, unknown> = {}) => ({
  configured: true,
  events_refused: 0,
  items: [
    {
      id: "dpl_ready1",
      title: "site (production)",
      state: "ready",
      detail: "main",
      url: "https://site-abc.vercel.app/",
      at: "2026-10-24T09:00:00.000Z",
    },
    {
      id: "dpl_bad2",
      title: "api (preview)",
      state: "error",
      detail: "fix/login",
      at: "2026-10-24T08:00:00.000Z",
    },
    { id: "dpl_run3", title: "docs (preview)", state: "building", at: "2026-10-24T09:30:00.000Z" },
  ],
  ...over,
});

const stripeStatus = (over: Record<string, unknown> = {}) => ({
  configured: true,
  events_refused: 0,
  items: [
    {
      id: "ch_ok1",
      title: "20.00 USD",
      state: "succeeded",
      url: "https://pay.stripe.com/receipts/abc",
      at: "2026-10-24T09:00:00.000Z",
    },
    { id: "ch_bad2", title: "5.00 USD", state: "failed", detail: "card_declined" },
    { id: "ch_ref3", title: "7.50 EUR", state: "refunded" },
  ],
  summary: {
    charges_counted: 4,
    succeeded: {
      count: 2,
      totals: [{ currency: "usd", count: 2, amount: 3000, display: "30.00 USD" }],
    },
    failed: { count: 1, totals: [{ currency: "usd", count: 1, amount: 500, display: "5.00 USD" }] },
    pending: { count: 1 },
  },
  balance: {
    available: [{ currency: "usd", amount: 123456, display: "1234.56 USD" }],
    pending: [{ currency: "usd", amount: 700, display: "7.00 USD" }],
  },
  ...over,
});

const n8nStatus = (over: Record<string, unknown> = {}) => ({
  configured: true,
  sends_key_to: "n8n.example.com",
  events_refused: 0,
  workflows: [
    { id: "w1", name: "Nightly sync", active: true },
    { id: "w2", name: "Old flow", active: false },
  ],
  items: [
    { id: "101", title: "Nightly sync", state: "success", at: "2026-10-24T09:00:00.000Z" },
    { id: "102", title: "Old flow", state: "error", at: "2026-10-24T08:00:00.000Z" },
    { id: "103", title: "workflow w9", state: "crashed", at: "2026-10-24T07:00:00.000Z" },
    { id: "104", title: "Nightly sync", state: "running", at: "2026-10-24T09:40:00.000Z" },
  ],
  ...over,
});

describe("service glances (Vercel, Stripe, n8n)", () => {
  it("shows nothing and calls nothing for a service that is not installed", async () => {
    const { api } = open(caps({}));
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/capabilities")).toBe(true));
    expect(screen.queryByRole("heading", { name: /at a glance/ })).toBeNull();
    expect(api.calls.some((c) => c.path.includes("/commands/"))).toBe(false);
  });

  it("shows the enable prompt and calls nothing while a capability is installed but off", async () => {
    const { api } = open(caps({ vercel: "installed", stripe: "installed", n8n: "installed" }));
    for (const name of ["Vercel", "Stripe", "n8n"]) {
      const sec = await section(`${name} at a glance`);
      expect(within(sec).getByRole("status").textContent).toContain(`${name} is turned off`);
    }
    expect(api.calls.some((c) => c.path.includes("/commands/"))).toBe(false);
  });

  describe("Vercel", () => {
    it("lists deployments with their state and counts failed and in-progress ones", async () => {
      const { api } = open({
        ...caps({ vercel: "enabled" }),
        ...statusRoute("vercel", ok(vercelStatus())),
      });
      const sec = await section("Vercel at a glance");
      await within(sec).findByText("site (production)");
      expect(within(sec).getByText("api (preview)")).toBeTruthy();
      expect(within(sec).getByText("Ready")).toBeTruthy();
      expect(within(sec).getByText("Failed")).toBeTruthy();
      expect(within(sec).getByText("Building")).toBeTruthy();
      expect(within(sec).getByText("fix/login")).toBeTruthy();
      expect(sec.textContent).toContain("Recent deployments: 3");
      expect(sec.textContent).toContain("Failed: 1");
      expect(sec.textContent).toContain("In progress: 1");
      const link = within(sec).getByRole("link", { name: "site-abc.vercel.app" });
      expect(link.getAttribute("href")).toBe("https://site-abc.vercel.app/");
      expect(link.getAttribute("rel")).toContain("noopener");
      expect(screen.queryByRole("heading", { name: "Stripe at a glance" })).toBeNull();
      expectOnlyStatusPosts(api);
      expect(api.posts("/api/capabilities/vercel/commands/status")).toHaveLength(1);
    });

    it("renders hostile text inertly and never links a non-https address", async () => {
      const { container } = open({
        ...caps({ vercel: "enabled" }),
        ...statusRoute(
          "vercel",
          ok({
            configured: true,
            items: [
              { id: "dpl_a", title: XSS, state: "ready", detail: XSS, url: "javascript:alert(1)" },
              {
                id: "dpl_b",
                title: "x\u202egnp.exe",
                state: "<b>ready</b>",
                url: "http://evil.test/",
              },
              { id: "dpl_c", title: "cred", state: "ready", url: "https://user:pw@evil.test/" },
            ],
          }),
        ),
      });
      const sec = await section("Vercel at a glance");
      await within(sec).findByText("cred");
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector("script")).toBeNull();
      expect(container.querySelector("b")).toBeNull();
      expect(container.querySelector("a")).toBeNull();
      expect(sec.textContent).toContain(XSS);
      expect(sec.textContent).not.toContain("\u202e");
      expect(sec.textContent).not.toContain("evil.test");
    });

    it("shows the not-configured note, the empty state and an unreadable answer", async () => {
      const state = {
        value: { configured: false, items: [], note: "Add a Vercel token in Settings" } as unknown,
      };
      open({
        ...caps({ vercel: "enabled" }),
        ...statusRoute("vercel", () => ({ status: "succeeded", result: state.value })),
      });
      const sec = await section("Vercel at a glance");
      await within(sec).findByText("Add a Vercel token in Settings to see deployments.");
      cleanup();
      FakeWebSocket.reset();
      state.value = { configured: true, items: [] };
      open({
        ...caps({ vercel: "enabled" }),
        ...statusRoute("vercel", () => ({ status: "succeeded", result: state.value })),
      });
      await screen.findByText("No deployments yet.");
      cleanup();
      FakeWebSocket.reset();
      state.value = { items: "nope" };
      open({
        ...caps({ vercel: "enabled" }),
        ...statusRoute("vercel", () => ({ status: "succeeded", result: state.value })),
      });
      expect((await screen.findByRole("alert")).textContent).toContain(
        "returned data this page cannot read",
      );
    });
  });

  describe("Stripe", () => {
    it("shows counts, per-currency amounts and the balance, and nothing else", async () => {
      const { api, container } = open({
        ...caps({ stripe: "enabled" }),
        ...statusRoute(
          "stripe",
          ok(
            stripeStatus({
              // A capability that returned more than it should: none of this may be displayed.
              customer_email: "buyer@example.test",
              customer: { name: "Pat Example", card: { last4: "4242" } },
            }),
          ),
        ),
      });
      const sec = await section("Stripe at a glance");
      await within(sec).findByText("Latest payments counted: 4");
      expect(sec.textContent).toContain("Succeeded: 2");
      expect(sec.textContent).toContain("Received: 30.00 USD");
      expect(sec.textContent).toContain("Failed: 1");
      expect(sec.textContent).toContain("Failed amounts: 5.00 USD");
      expect(sec.textContent).toContain("Pending: 1");
      expect(sec.textContent).toContain("Available balance: 1234.56 USD");
      expect(sec.textContent).toContain("Pending balance: 7.00 USD");
      expect(within(sec).getByText("20.00 USD")).toBeTruthy();
      expect(within(sec).getByText("7.50 EUR")).toBeTruthy();
      expect(within(sec).getByText("Refunded")).toBeTruthy();
      // The receipt link and the failure code are not shown; nor is anything customer-related.
      expect(container.querySelector("a")).toBeNull();
      for (const hidden of ["receipts", "card_declined", "buyer@example", "Pat Example", "4242"]) {
        expect(container.textContent).not.toContain(hidden);
      }
      expectOnlyStatusPosts(api);
    });

    it("drops any amount or count that is not in the capability's own format", async () => {
      const { container } = open({
        ...caps({ stripe: "enabled" }),
        ...statusRoute(
          "stripe",
          ok({
            configured: true,
            items: [
              { id: "ch_x", title: "buyer@example.test paid", state: "succeeded" },
              { id: "ch_y", title: XSS, state: "succeeded" },
              { id: "ch_z", title: "1.00 USD", state: XSS },
            ],
            summary: {
              charges_counted: "many",
              succeeded: { count: -1, totals: [{ display: "Pat Example", count: 1 }] },
              failed: { count: 1.5, totals: [] },
              pending: { count: 1e12 },
            },
            balance: { available: [{ display: "<b>9</b> USD" }], pending: "x" },
          }),
        ),
      });
      const sec = await section("Stripe at a glance");
      await within(sec).findByText("1.00 USD");
      expect(sec.textContent).not.toContain("buyer@example");
      expect(sec.textContent).not.toContain("Pat Example");
      expect(sec.textContent).not.toContain("<b>");
      expect(container.querySelector("b")).toBeNull();
      expect(container.querySelector("img")).toBeNull();
      expect(sec.textContent).toContain("Unknown");
      expect(sec.textContent).toContain("Latest payments counted: 0");
    });

    it("shows the not-configured note and the empty state", async () => {
      const state = { value: { configured: false, items: [], note: "x" } as unknown };
      const routes = {
        ...caps({ stripe: "enabled" }),
        ...statusRoute("stripe", () => ({ status: "succeeded", result: state.value })),
      };
      open(routes);
      await screen.findByText("Add a restricted read-only Stripe key in Settings to see payments.");
      cleanup();
      FakeWebSocket.reset();
      state.value = {
        configured: true,
        items: [],
        summary: {
          charges_counted: 0,
          succeeded: { count: 0, totals: [] },
          failed: { count: 0, totals: [] },
          pending: { count: 0 },
        },
        balance: { available: [], pending: [] },
      };
      open(routes);
      await screen.findByText("No recent payments.");
    });
  });

  describe("n8n", () => {
    it("lists executions, counts the failed ones and shows active workflows", async () => {
      const { api } = open({
        ...caps({ n8n: "enabled" }),
        ...statusRoute("n8n", ok(n8nStatus())),
      });
      const sec = await section("n8n at a glance");
      await within(sec).findByText("Old flow");
      expect(sec.textContent).toContain("Recent executions: 4");
      expect(sec.textContent).toContain("Failed: 2");
      expect(sec.textContent).toContain("Active workflows: 1 of 2");
      expect(within(sec).getByText("Succeeded")).toBeTruthy();
      expect(within(sec).getByText("Crashed")).toBeTruthy();
      expect(within(sec).getByText("Running")).toBeTruthy();
      expect(within(sec).getByText("workflow w9")).toBeTruthy();
      expect(sec.textContent).toContain("API key is sent to n8n.example.com");
      expectOnlyStatusPosts(api);
    });

    it("renders hostile workflow names inertly and ignores a hostile host", async () => {
      const { container } = open({
        ...caps({ n8n: "enabled" }),
        ...statusRoute(
          "n8n",
          ok(
            n8nStatus({
              sends_key_to: "evil.test/<script>",
              items: [
                { id: "1", title: XSS, state: "success", url: "https://evil.test/x", detail: XSS },
              ],
            }),
          ),
        ),
      });
      const sec = await section("n8n at a glance");
      await within(sec).findByText(XSS);
      expect(container.querySelector("script")).toBeNull();
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector("a")).toBeNull();
      expect(sec.textContent).not.toContain("API key is sent");
    });

    it("shows the not-configured note and the empty state", async () => {
      const state = { value: { configured: false, workflows: [], items: [] } as unknown };
      const routes = {
        ...caps({ n8n: "enabled" }),
        ...statusRoute("n8n", () => ({ status: "succeeded", result: state.value })),
      };
      open(routes);
      await screen.findByText(
        "Set your n8n address and add an API key in Settings to see executions.",
      );
      cleanup();
      FakeWebSocket.reset();
      state.value = { configured: true, workflows: [], items: [] };
      open(routes);
      await screen.findByText("No recent executions.");
    });
  });

  describe("states", () => {
    it("shows loading while the command runs, then the error when it fails", async () => {
      const phase = { value: "running" };
      open({
        ...caps({ vercel: "enabled" }),
        ...statusRoute("vercel", () =>
          phase.value === "running"
            ? { status: "running" }
            : { status: "failed", error: { message: "Vercel rejected the token" } },
        ),
      });
      const sec = await section("Vercel at a glance");
      await within(sec).findByText("Loading…");
      phase.value = "failed";
      const alert = await within(sec).findByRole("alert", undefined, { timeout: 3000 });
      expect(alert.textContent).toContain("Vercel could not be read.");
      expect(alert.textContent).toContain("Vercel rejected the token");
      expect(within(sec).queryByText("Loading…")).toBeNull();
    });

    it("keeps the last data and says it is stale when a refresh fails", async () => {
      const phase = { value: "ok" };
      const { ws } = open({
        ...caps({ vercel: "enabled" }),
        ...statusRoute("vercel", () =>
          phase.value === "ok"
            ? { status: "succeeded", result: vercelStatus() }
            : { status: "failed", error: { message: "Vercel is unreachable" } },
        ),
      });
      const sec = await section("Vercel at a glance");
      await within(sec).findByText("site (production)");
      phase.value = "bad";
      sendEvent(ws, 1, "vercel.deploy.failed");
      await within(sec).findByText(/could not be refreshed; showing the last data/);
      expect(within(sec).getByText("site (production)")).toBeTruthy();
    });

    it("reads again when one of the service's own events arrives, and for no other event", async () => {
      const { api, ws } = open({
        ...caps({ stripe: "enabled" }),
        ...statusRoute("stripe", ok(stripeStatus())),
      });
      await screen.findByText("Latest payments counted: 4");
      const status = () => api.posts("/api/capabilities/stripe/commands/status").length;
      expect(status()).toBe(1);
      sendEvent(ws, 1, "vercel.deploy.failed");
      sendEvent(ws, 2, "stripe.something_else");
      await new Promise((r) => setTimeout(r, 50));
      expect(status()).toBe(1);
      sendEvent(ws, 3, "stripe.payment.failed");
      await waitFor(() => expect(status()).toBe(2));
      expectOnlyStatusPosts(api);
    });

    it("refreshes on a bounded interval only while the page is visible", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { api } = open({
        ...caps({ n8n: "enabled" }),
        ...statusRoute("n8n", ok(n8nStatus())),
      });
      await screen.findByText(/Recent executions: 4/);
      const status = () => api.posts("/api/capabilities/n8n/commands/status").length;
      expect(status()).toBe(1);

      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60_000);
      });
      expect(status()).toBe(1);

      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await waitFor(() => expect(status()).toBe(2));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(status()).toBe(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      await waitFor(() => expect(status()).toBeGreaterThanOrEqual(3));
      expectOnlyStatusPosts(api);
    });

    it("stops refreshing when it is unmounted", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { api } = open({
        ...caps({ n8n: "enabled" }),
        ...statusRoute("n8n", ok(n8nStatus())),
      });
      await screen.findByText(/Recent executions: 4/);
      cleanup();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10 * 60_000);
      });
      expect(api.posts("/api/capabilities/n8n/commands/status")).toHaveLength(1);
    });
  });

  it("calls only status for all three services at once", async () => {
    const { api } = open({
      ...caps({ vercel: "enabled", stripe: "enabled", n8n: "enabled" }),
      ...statusRoute("vercel", ok(vercelStatus())),
      ...statusRoute("stripe", ok(stripeStatus())),
      ...statusRoute("n8n", ok(n8nStatus())),
    });
    for (const s of SERVICES) {
      await screen.findByRole("heading", { name: new RegExp(`^${s} at a glance`, "i") });
    }
    await screen.findByText(/Recent executions: 4/);
    await screen.findByText(/Recent deployments: 3/);
    await screen.findByText("Latest payments counted: 4");
    expectOnlyStatusPosts(api);
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(3);
  });
});

describe("glance parsers", () => {
  it("cleanText strips control and bidi characters, collapses space and clips", () => {
    expect(cleanText("a\u0000b\u202ec\n\n d", 20)).toBe("a b c d");
    expect(cleanText("   ", 10)).toBeUndefined();
    expect(cleanText(5, 10)).toBeUndefined();
    expect(cleanText("abcdefghij", 5)).toBe("abcd…");
    expect(cleanText("x".repeat(5_000_000), 10)).toBe("xxxxxxxxx…");
  });

  it("httpsUrl accepts only plain https addresses", () => {
    expect(httpsUrl("https://a.example/x")).toBe("https://a.example/x");
    for (const bad of [
      "http://a.example/",
      "javascript:alert(1)",
      "https://u:p@a.example/",
      "https://a.example/ x",
      "data:text/html,x",
      "//a.example",
      `https://a.example/${"x".repeat(400)}`,
      42,
    ]) {
      expect(httpsUrl(bad)).toBeUndefined();
    }
  });

  it("every parser rejects a result that is not a status object", () => {
    for (const parse of [parseVercelGlance, parseStripeGlance, parseN8nGlance]) {
      for (const bad of [
        null,
        undefined,
        "x",
        3,
        [],
        {},
        { configured: "yes", items: [] },
        { configured: true },
      ]) {
        expect(parse(bad)).toBeNull();
      }
    }
  });

  it("bounds the number of items and skips malformed ones", () => {
    const items = Array.from({ length: 500 }, (_, i) => ({
      id: `d${i}`,
      title: `t${i}`,
      state: "ready",
    }));
    const view = parseVercelGlance({ configured: true, items: [null, 3, { id: 1 }, ...items] });
    expect(view!.items.length).toBeLessThanOrEqual(25);
    expect(view!.items.every((i) => i.id.startsWith("d"))).toBe(true);
  });
});
