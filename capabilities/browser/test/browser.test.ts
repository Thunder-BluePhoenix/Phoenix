// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The browser capability end to end with FAKES at every layer: a fake "chrome page" answers the relay
// with canned HTML (standing in for the Tauri `page_snapshot` / `page_action` commands), the real
// capability manager, permission gateway, policy engine, tool gateway and BrowsingAssistant run for
// real, and the model and approval are fakes. No webview, no Tauri command, no HTTP and no model ran.
import type { GenerateResult } from "@phoenix/ai-models";
import {
  approverFromPermissions,
  enabledManifests,
  ToolGateway,
  ToolGatewayError,
  ToolRegistry,
} from "@phoenix/ai-tool-gateway";
import {
  BROWSER_TOOL_NAMES,
  BrowsingAssistant,
  type ActionApproval,
  type BrowserAction,
} from "@phoenix/ai-browsing";
import { PolicyEngine, PolicyStore, type Actor } from "@phoenix/policy";
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowserRelay,
  createBrowserCapability,
  createRelayPageReader,
  type RelayRequest,
} from "../src";

const SHOP = "https://shop.test/cart?session=abc123";
const SHOP_AUDIT = "https://shop.test/cart";
const HTML = `<html><head><title>Cart</title></head><body>
<h1>Your cart</h1>
<form id="search"><input id="q" type="text" aria-label="Search"><button id="go" type="submit">Go</button></form>
<form id="login"><input id="user" type="text" aria-label="Name"><input id="pw" type="password"><button name="signin" type="submit">Sign in</button></form>
<button id="dl">Download invoice</button>
</body></html>`;

interface Chrome {
  url: string;
  html: string;
  /** Every non-snapshot request the fake chrome page received, in order. */
  actions: RelayRequest[];
  snapshots: number;
  reply?: (request: RelayRequest) => unknown;
  stop(): void;
}

/** Plays the chrome page: long-polls the relay and answers like the Tauri commands would. */
function fakeChrome(relay: BrowserRelay, init: { url?: string; html?: string } = {}): Chrome {
  const state: Chrome = {
    url: init.url ?? SHOP,
    html: init.html ?? HTML,
    actions: [],
    snapshots: 0,
    stop: () => void (stopped = true),
  };
  let stopped = false;
  void (async () => {
    while (!stopped) {
      const request = await relay.next(20);
      if (!request) continue;
      if (state.reply) {
        relay.complete(request.id, state.reply(request));
        continue;
      }
      if (request.kind === "snapshot") {
        state.snapshots += 1;
        relay.complete(request.id, {
          ok: true,
          snapshot: { url: state.url, title: "Cart", html: state.html, truncated: false },
        });
        continue;
      }
      if (request.expectedUrl.split("#")[0] !== state.url.split("#")[0]) {
        relay.complete(request.id, { ok: false, reason: "page_changed" });
        continue;
      }
      state.actions.push(request);
      if (request.kind === "navigate") state.url = request.destination;
      relay.complete(request.id, { ok: true, url: state.url });
    }
  })();
  return state;
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function setup(htmlUrl?: { url?: string; html?: string }) {
  const relay = new BrowserRelay();
  const module = createBrowserCapability({ relay });
  const h: Harness = createHarness({ modules: [module] });
  cleanups.push(() => h.close());
  await h.enable("browser");
  const chrome = fakeChrome(relay, htmlUrl);
  cleanups.push(() => {
    chrome.stop();
    relay.close();
  });
  const store = new PolicyStore(h.db);
  const registry = new ToolRegistry({ manifests: enabledManifests(h.manager, h.db) });
  const policy = new PolicyEngine({
    store,
    audit: h.permissions.audit,
    isKillSwitchEngaged: () => h.permissions.isKillSwitchEngaged(),
    isKnownTool: (t) => registry.has(t),
  });
  const gateway = new ToolGateway({
    host: { invokeAndWait: (...a) => h.manager.invokeAndWait(...a) },
    registry,
    policy,
    audit: h.permissions.audit,
    approver: approverFromPermissions(h.permissions),
  });
  return { relay, h, chrome, gateway, registry };
}

const actor: Actor = { kind: "agent", id: "fawkes", trustedByUser: true };
const call = (tool: string, input: unknown) => ({
  actor,
  tool,
  input,
  environment: "local" as const,
});

/** Answers every pending Core confirmation, remembering the card it saw. */
function answerer(h: Harness, approve: boolean) {
  const seen: unknown[] = [];
  const timer = setInterval(() => {
    for (const c of h.permissions.pendingConfirmations()) {
      seen.push(c);
      h.permissions.resolveConfirmation(c.id, approve);
    }
  }, 2);
  cleanups.push(() => clearInterval(timer));
  return seen as {
    id: string;
    capabilityId: string;
    command: string;
    sideEffect: string;
    summary: string;
    details?: { browser?: Record<string, unknown> };
  }[];
}

describe("registration", () => {
  it("registers the five tools with side effect external, under the names the assistant expects", async () => {
    const { registry } = await setup();
    const tools = registry.list().filter((t) => t.capabilityId === "browser");
    expect(tools.map((t) => t.name).sort()).toEqual(Object.values(BROWSER_TOOL_NAMES).sort());
    for (const t of tools) expect(t.sideEffect).toBe("external");
    for (const t of tools) expect(t.idempotent).toBe(false);
  });

  it("is degraded until the chrome page polls", async () => {
    const relay = new BrowserRelay();
    const m = createBrowserCapability({ relay });
    expect(await m.health?.()).toMatchObject({ status: "degraded" });
    void relay.next(1);
    expect(await m.health?.()).toMatchObject({ status: "healthy" });
    relay.close();
  });
});

describe("through the tool gateway", () => {
  it("asks for confirmation every time, shows the card, and clicks on the active tab", async () => {
    const { h, gateway, chrome } = await setup();
    const seen = answerer(h, true);
    const r = await gateway.call(call("browser.click", { pageUrl: SHOP, selector: "button#dl" }));
    expect(r.output).toEqual({ ok: true, url: SHOP });
    expect(chrome.actions).toEqual([
      expect.objectContaining({
        kind: "click",
        expectedUrl: expect.any(String),
        selector: "button#dl",
      }),
    ]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      capabilityId: "browser",
      command: "click",
      sideEffect: "external",
      details: { browser: { kind: "click", pageUrl: "shop.test/cart", selector: "button#dl" } },
    });
    // a second action asks again
    await gateway.call(call("browser.click", { pageUrl: SHOP, selector: "button#dl" }));
    expect(seen).toHaveLength(2);
  });

  it("refuses before any action when the user declines", async () => {
    const { h, gateway, chrome } = await setup();
    answerer(h, false);
    const err = await gateway
      .call(call("browser.click", { pageUrl: SHOP, selector: "button#dl" }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolGatewayError);
    expect(chrome.actions).toEqual([]);
  });

  it("types the full text, shows it in full on the card, and never audits it", async () => {
    const { h, gateway, chrome } = await setup();
    const seen = answerer(h, true);
    const text = `tea ${"long ".repeat(200)}end\nline2 \u202e`;
    const r = await gateway.call(
      call("browser.type", { pageUrl: SHOP, selector: "input#q", text }),
    );
    expect(chrome.actions[0]).toMatchObject({ kind: "type", selector: "input#q", text });
    expect(JSON.stringify(r)).not.toContain("long long");
    const card = seen[0]!.details!.browser!;
    expect(card).toMatchObject({ kind: "type", textLength: text.length });
    expect(card.text).toContain("tea long long");
    expect(card.text).toContain("end\\nline2 \\u{202E}");
    const audit = JSON.stringify(h.permissions.audit.list({ limit: 1000 }));
    expect(audit).not.toContain("long long");
    expect(audit).not.toContain("tea ");
    expect(audit).not.toContain("abc123");
    // not in the summary or in any published event either
    expect(seen[0]!.summary).not.toContain("tea");
    expect(JSON.stringify(h.events)).not.toContain("long long");
  });

  it("shows the destination without its query and refuses a non-web destination", async () => {
    const { h, gateway, chrome } = await setup();
    const seen = answerer(h, true);
    await gateway.call(
      call("browser.navigate", {
        pageUrl: SHOP,
        destination: "https://shop.test/checkout?token=zzz",
      }),
    );
    expect(seen[0]!.details!.browser).toMatchObject({
      kind: "navigate",
      pageUrl: "shop.test/cart",
      destination: "shop.test/checkout",
      queryHidden: true,
    });
    expect(JSON.stringify(seen[0])).not.toContain("zzz");
    expect(chrome.actions[0]).toMatchObject({ kind: "navigate" });
    for (const destination of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "https://u:p@x.test/",
    ]) {
      const err = await gateway
        .call(call("browser.navigate", { pageUrl: SHOP, destination }))
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ToolGatewayError);
    }
    expect(chrome.actions).toHaveLength(1);
  });

  it("refuses when the active tab is no longer on the approved page, before any action", async () => {
    const { h, gateway, chrome } = await setup({ url: "https://evil.test/phish" });
    answerer(h, true);
    const err = (await gateway
      .call(call("browser.click", { pageUrl: SHOP, selector: "button#dl" }))
      .catch((e: unknown) => e)) as ToolGatewayError;
    // the gateway reports a SECURITY_POLICY_BLOCKED refusal as a rejection
    expect(err.details).toContain("SECURITY_POLICY_BLOCKED");
    expect(err.message).toContain("no longer on the page you approved");
    expect(chrome.actions).toEqual([]);
  });

  it("re-reads the page itself after approval, even when the chrome page would accept the action", async () => {
    const { h, gateway, chrome } = await setup({ url: "https://evil.test/phish" });
    answerer(h, true);
    // a chrome page that does not check expectedUrl (as if Rust's own check were missing)
    chrome.reply = (request) =>
      request.kind === "snapshot"
        ? { ok: true, snapshot: { url: chrome.url, title: "", html: HTML, truncated: false } }
        : (chrome.actions.push(request), { ok: true, url: chrome.url });
    const err = await gateway
      .call(call("browser.click", { pageUrl: SHOP, selector: "button#dl" }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolGatewayError);
    expect(chrome.actions).toEqual([]);
  });

  it("refuses an unsafe selector in the handler itself, below the manifest schema", async () => {
    const relay = new BrowserRelay();
    const module = createBrowserCapability({ relay });
    void relay.next(1);
    const ctx = { signal: new AbortController().signal } as never;
    for (const selector of [
      "body",
      "input:nth-of-type(1)",
      "input#a, input#b",
      'input[name="x"]~1',
    ]) {
      await expect(module.commands.click!({ pageUrl: SHOP, selector }, ctx)).rejects.toMatchObject({
        details: ["bad_selector"],
      });
    }
    relay.close();
  });

  it("refuses a page that changed during approval even if the chrome says nothing", async () => {
    const { h, gateway, chrome } = await setup();
    // the user takes a moment; the page navigates meanwhile
    const timer = setInterval(() => {
      for (const c of h.permissions.pendingConfirmations()) {
        chrome.url = "https://shop.test/other";
        h.permissions.resolveConfirmation(c.id, true);
      }
    }, 2);
    cleanups.push(() => clearInterval(timer));
    const err = await gateway
      .call(call("browser.click", { pageUrl: SHOP, selector: "button#dl" }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolGatewayError);
    expect(chrome.actions).toEqual([]);
  });

  it("passes the page URL to the chrome page so Rust can refuse a tab that moved after the read", async () => {
    const { h, gateway, chrome } = await setup();
    answerer(h, true);
    chrome.reply = (request) =>
      request.kind === "snapshot"
        ? { ok: true, snapshot: { url: SHOP, title: "", html: HTML, truncated: false } }
        : { ok: false, reason: "page_changed" };
    const err = (await gateway
      .call(call("browser.click", { pageUrl: SHOP, selector: "button#dl" }))
      .catch((e: unknown) => e)) as ToolGatewayError;
    expect(err.details).toContain("SECURITY_POLICY_BLOCKED");
  });

  it("refuses protected fields and unsafe selectors on the capability side too", async () => {
    const { h, gateway, chrome } = await setup();
    answerer(h, true);
    const cases: [string, Record<string, unknown>][] = [
      ["browser.type", { selector: "input#pw", text: "hunter2x" }],
      ["browser.click", { selector: "input#pw" }],
      ["browser.submit", { selector: "form#login" }],
      ["browser.type", { selector: "input#nope", text: "x" }],
    ];
    for (const [tool, input] of cases) {
      const err = await gateway
        .call(call(tool, { pageUrl: SHOP, ...input }))
        .catch((e: unknown) => e);
      expect(err, `${tool} ${JSON.stringify(input)}`).toBeInstanceOf(ToolGatewayError);
    }
    for (const selector of [
      "input:nth-of-type(1)",
      'input[name="a"]~1',
      "a",
      "body",
      "input#q, input#pw",
      "input#q\n",
      'input[name="x"] > b',
      "form :unreported-controls",
    ]) {
      const err = await gateway
        .call(call("browser.click", { pageUrl: SHOP, selector }))
        .catch((e: unknown) => e);
      expect(err, selector).toBeInstanceOf(ToolGatewayError);
    }
    expect(chrome.actions).toEqual([]);
  });

  it("submits a clean form and refuses when the Rust side reports the control gone", async () => {
    const { h, gateway, chrome } = await setup();
    answerer(h, true);
    await gateway.call(call("browser.submit", { pageUrl: SHOP, selector: "form#search" }));
    expect(chrome.actions).toEqual([
      expect.objectContaining({ kind: "submit", selector: "form#search" }),
    ]);
    chrome.reply = (request) =>
      request.kind === "snapshot"
        ? { ok: true, snapshot: { url: SHOP, title: "", html: HTML, truncated: false } }
        : { ok: false, reason: "not_found" };
    const err = await gateway
      .call(call("browser.submit", { pageUrl: SHOP, selector: "form#search" }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolGatewayError);
  });

  it("refuses when no browser window is open", async () => {
    const relay = new BrowserRelay();
    const h = createHarness({ modules: [createBrowserCapability({ relay })] });
    cleanups.push(() => h.close());
    await h.enable("browser");
    const op = h.manager.invoke("browser", "click", { pageUrl: SHOP, selector: "button#dl" });
    const timer = setInterval(() => {
      for (const c of h.permissions.pendingConfirmations())
        h.permissions.resolveConfirmation(c.id, true);
    }, 2);
    cleanups.push(() => clearInterval(timer));
    await vi.waitFor(() => expect(op.status).toBe("failed"));
    expect(op.error?.code).toBe("CAPABILITY_UNAVAILABLE");
  });

  it("rejects extra input properties and over-long text by schema", async () => {
    const { h, gateway } = await setup();
    answerer(h, true);
    for (const input of [
      { pageUrl: SHOP, selector: "button#dl", extra: 1 },
      { pageUrl: "javascript:alert(1)", selector: "button#dl" },
      { pageUrl: SHOP, selector: "input#q", text: "x".repeat(4097) },
    ]) {
      const err = await gateway
        .call(call(input.text ? "browser.type" : "browser.click", input))
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ToolGatewayError);
    }
  });
});

describe("relay page reader", () => {
  it("turns the active tab's snapshot into a PublicPage with fields and no values", async () => {
    const { relay } = await setup();
    const page = await createRelayPageReader(relay).readPublicPage();
    expect(page.url).toBe(SHOP);
    expect(page.text).toContain("Your cart");
    expect(page.fields.map((f) => f.selector)).toEqual(
      expect.arrayContaining(["input#q", "button#go", "input#pw", "form#login"]),
    );
  });

  it("refuses a page that is not http(s) and passes a browser refusal on", async () => {
    const { relay, chrome } = await setup({ url: "about:blank" });
    await expect(createRelayPageReader(relay).readPublicPage()).rejects.toThrow();
    chrome.reply = () => ({ ok: false, reason: "not_a_web_page" });
    await expect(createRelayPageReader(relay).readPublicPage()).rejects.toMatchObject({
      details: ["not_a_web_page"],
    });
  });
});

describe("BrowsingAssistant over the real reader, gateway and capability", () => {
  const model = {
    locality: "local" as const,
    trustedLocal: true,
    generate: async (): Promise<GenerateResult> => ({
      text: "ok",
      provenance: { provider: "ollama", model: "m", locality: "local", processedBy: "fake" },
    }),
  };

  async function assistant(approve: boolean) {
    const s = await setup();
    answerer(s.h, true); // Core's own confirmation always says yes here; the assistant's approval decides
    const approvals: { action: BrowserAction; pageUrl: string }[] = [];
    const approval: ActionApproval = {
      approve: async (action, pageUrl) => {
        approvals.push({ action, pageUrl });
        if (!approve) throw new Error("declined");
      },
    };
    const reader = createRelayPageReader(s.relay);
    const audit: { action: string; decision: string; details: Record<string, unknown> }[] = [];
    const a = new BrowsingAssistant({
      page: reader,
      model,
      gateway: s.gateway,
      approval,
      audit: {
        record: (e) => {
          audit.push(e);
          return { id: audit.length };
        },
      },
      actor: { kind: "agent", id: "fawkes", trustedByUser: false },
      environment: "local",
      tools: BROWSER_TOOL_NAMES,
    });
    return { ...s, a, approvals, audit };
  }

  it("runs a multi-step plan with an approval per step and re-reads the page each time", async () => {
    const { a, chrome, approvals, audit, h } = await assistant(true);
    const plan = await a.plan([
      { kind: "type", selector: "input#q", text: "tea" },
      { kind: "submit", selector: "form#search" },
      { kind: "navigate", destination: "https://shop.test/checkout" },
    ]);
    const report = await a.execute(plan);
    expect(report.results).toHaveLength(3);
    expect(approvals.map((x) => x.action.kind)).toEqual(["type", "submit", "navigate"]);
    expect(chrome.actions.map((x) => x.kind)).toEqual(["type", "submit", "navigate"]);
    expect(
      chrome.actions.every(
        (x) => x.kind === "snapshot" || x.expectedUrl.startsWith("https://shop.test/"),
      ),
    ).toBe(true);
    expect(chrome.snapshots).toBeGreaterThanOrEqual(7);
    expect(audit.every((e) => e.details.pageUrl !== undefined)).toBe(true);
    expect(JSON.stringify(audit)).not.toContain("abc123");
    expect(JSON.stringify(audit)).not.toContain('"tea"');
    // Core's own audit (policy decisions carry `resource`) has no query string either
    expect(JSON.stringify(h.permissions.audit.list({ limit: 1000 }))).not.toContain("abc123");
  });

  it("does nothing when the assistant's approval is refused", async () => {
    const { a, chrome } = await assistant(false);
    const plan = await a.plan([{ kind: "click", selector: "button#dl" }]);
    await expect(a.execute(plan)).rejects.toThrow("declined");
    expect(chrome.actions).toEqual([]);
  });

  it("stops the plan when the page moves between steps", async () => {
    const { a, chrome } = await assistant(true);
    const plan = await a.plan([
      { kind: "click", selector: "button#dl" },
      { kind: "click", selector: "button#dl" },
    ]);
    const original = chrome.actions.push.bind(chrome.actions);
    chrome.actions.push = (...items) => {
      chrome.url = "https://elsewhere.test/";
      return original(...items);
    };
    const report = await a.execute(plan);
    expect(report.stoppedBecause).toBe("page-changed");
    expect(report.remaining).toHaveLength(1);
    expect(chrome.actions).toHaveLength(1);
  });
});
