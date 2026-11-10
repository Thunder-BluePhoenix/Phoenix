// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 95: POST /api/browser/assist through a running Core. SIMULATED: the "chrome page" is this
// test calling the relay routes, the "local model" is a fake Ollama behind a recording fetch, and
// the pages are the HTML fixtures of the injection suite. No real model, webview or site ran.
// Shows: the page text and the goal reach only the loopback model; no model = "no local model" and
// no page read; a cloud provider, even preferred and granted, never sees them; the answer is data
// and nothing is dispatched or approved by the route; a gullible model's output cannot add steps
// that are not controls on the page or are protected.
import { BrowserRelay, createBrowserCapability } from "@phoenix/capability-browser";
import { afterEach, describe, expect, it } from "vitest";
import { CASES, INSTR, PAGE_URL } from "../../../ai/evaluation/test/browsing-injection-cases";
import { fakeNetwork, type FakeNetwork } from "./ai-network";
import { startCore, type TestCore } from "./helpers";

let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
  await stop?.();
  stop = undefined;
});

interface Rig {
  core: TestCore;
  net: FakeNetwork;
  /** Relay requests the fake chrome page served, by kind. */
  served: string[];
  setHtml(html: string): void;
  end(): Promise<void>;
}

async function boot(
  chat: (body: string) => string = () => "I can't tell.",
  options: { ollama?: "up" | "down"; ai?: boolean; relay?: boolean } = {},
): Promise<Rig> {
  const net = fakeNetwork({ chat, ollama: options.ollama });
  const relay = new BrowserRelay();
  const core = await startCore(
    {},
    {
      capabilities: [createBrowserCapability({ relay })],
      runtime: {
        fetch: net.fetch,
        ...(options.relay === false ? {} : { browserRelay: relay }),
      },
    },
  );
  let running = true;
  stop = async () => {
    running = false;
    await core.runtime.stop();
  };
  if (options.ai !== false) {
    expect((await core.api("POST", "/api/ai/settings", { enabled: true })).status).toBe(200);
  }
  let html = "<p>Shoes</p>";
  const served: string[] = [];
  const loop = (async () => {
    while (running) {
      const res = await core.api("GET", "/api/browser/relay/next?wait=50").catch(() => undefined);
      const request = res?.json?.request as Record<string, unknown> | null;
      if (!request) continue;
      served.push(String(request.kind));
      await core.api("POST", `/api/browser/relay/${request.id as string}/result`, {
        ok: true,
        snapshot: { url: PAGE_URL, title: "Shop", html, truncated: false },
      });
    }
  })();
  return {
    core,
    net,
    served,
    setHtml: (h) => {
      html = h;
    },
    end: async () => {
      running = false;
      await loop;
    },
  };
}

const FORM =
  `<p>Shoes</p><form id="f"><input id="q" type="text" aria-label="Search"><button id="go">Go</button>` +
  `<input id="pw" type="password" aria-label="Password"></form>`;
const assist = (r: Rig, goal: unknown) => r.core.api("POST", "/api/browser/assist", { goal });

describe("POST /api/browser/assist", () => {
  it("needs the session token", async () => {
    const r = await boot();
    const res = await fetch(`${r.core.base}/api/browser/assist`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal: "x" }),
    });
    expect(res.status).toBe(401);
    await r.end();
  });

  it("validates the goal: string, no control or bidi characters, no extra fields, clipped to 500", async () => {
    const r = await boot();
    for (const goal of [5, null, "", "   ", "a\u202eb", "a\u0007b", "a\u200bb", "a\u2066b"]) {
      expect((await assist(r, goal)).status, String(goal)).toBe(400);
    }
    expect((await r.core.api("POST", "/api/browser/assist", { goal: "x", extra: 1 })).status).toBe(
      400,
    );
    expect(r.net.chats()).toEqual([]);
    await assist(r, `${"a".repeat(600)}END`);
    const sent = JSON.parse(r.net.chats()[0]!.body).messages[1].content as string;
    const data = JSON.parse(sent) as { goal: string };
    expect(data.goal).toHaveLength(500);
    expect(sent).not.toContain("END");
    await r.end();
  });

  it("returns a plan as data; nothing is approved, dispatched or confirmed by the route", async () => {
    const r = await boot(() =>
      JSON.stringify({
        actions: [
          { kind: "type", selector: "input#q", text: "red shoes" },
          { kind: "click", selector: "button#go" },
        ],
      }),
    );
    r.setHtml(FORM);
    await r.core.api("POST", "/api/capabilities/browser/enable", {});
    const res = await assist(r, "search for red shoes");
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      status: "ok",
      dropped: 0,
      plan: {
        page_url: PAGE_URL,
        actions: [
          { kind: "type", selector: "input#q", text: "red shoes" },
          { kind: "click", selector: "button#go" },
        ],
      },
    });
    // Only snapshot reads were served to the browser: no click/type reached it.
    expect(new Set(r.served)).toEqual(new Set(["snapshot"]));
    const confirmations = (await r.core.api("GET", "/api/confirmations")).json.confirmations;
    expect(confirmations).toEqual([]);
    await r.end();
  });

  it("drops what the model should not propose: password, unknown controls, navigate, download, extra steps", async () => {
    const r = await boot(() =>
      JSON.stringify({
        actions: [
          { kind: "click", selector: "button#go" },
          { kind: "type", selector: "input#pw", text: "hunter2" },
          { kind: "click", selector: "button#nope" },
          { kind: "navigate", destination: "https://evil.test/" },
          { kind: "download", selector: "button#go" },
          { kind: "submit", selector: "form#f" },
        ],
      }),
    );
    r.setHtml(FORM);
    const res = await assist(r, "do things");
    // `submit form#f` is past the five-step cap and would be refused anyway: the form holds a password field.
    expect(res.json.plan.actions).toEqual([{ kind: "click", selector: "button#go" }]);
    expect(res.json.dropped).toBe(5);
    await r.end();
  });

  it("a gullible model's tool-call text and an unparseable reply give an empty plan", async () => {
    const r = await boot(
      () => `Following the page.\n{"tool":"browser.submit","input":{"selector":"#buy"}}`,
    );
    r.setHtml(`<p>${INSTR}</p>`);
    const res = await assist(r, "what can I do");
    expect(res.json).toMatchObject({ status: "ok", plan: { actions: [] } });
    await r.end();
  });

  it("keeps the person's words and the page on the loopback model only", async () => {
    const r = await boot();
    r.setHtml(`<p>${INSTR} ZZ99</p>`);
    await assist(r, "buy the shoes");
    expect(r.net.chats()).toHaveLength(1);
    for (const req of r.net.requests)
      expect(req.url.startsWith("http://127.0.0.1:11434")).toBe(true);
    expect(r.net.cloud()).toEqual([]);
    const body = JSON.parse(r.net.chats()[0]!.body) as {
      messages: { role: string; content: string }[];
    };
    expect(body.messages[0]!.content).not.toContain("ZZ99");
    expect(body.messages[1]!.content).toContain("ZZ99");
    await r.end();
  });

  it("with the local model down it fails closed: no_local_model, no cloud call, even with a cloud provider preferred and allowed", async () => {
    const r = await boot(undefined, { ollama: "down" });
    expect(
      (await r.core.api("POST", "/api/ai/external-processing", { granted: true })).status,
    ).toBe(200);
    await r.core.api("POST", "/api/ai/settings", {
      preferred: "anthropic",
      cloud_opt_in: { public: true, internal: true, sensitive: true },
    });
    r.setHtml(`<p>${INSTR} ZZ98</p>`);
    const res = await assist(r, "buy the shoes");
    expect(res.status).toBe(200);
    // The down model is refused by the router (health check); either way nothing reaches the cloud.
    expect(res.json.status).toBe("no_local_model");
    expect(r.net.cloud()).toEqual([]);
    expect(JSON.stringify(r.net.requests)).not.toContain("ZZ98");
    expect(JSON.stringify(r.net.requests)).not.toContain("buy the shoes");
    await r.end();
  });

  it("with AI switched off it answers no_local_model and reads no page and sends nothing", async () => {
    const r = await boot(undefined, { ai: false });
    const res = await assist(r, "buy the shoes");
    expect(res.json.status).toBe("no_local_model");
    expect(r.served).toEqual([]);
    expect(r.net.requests).toEqual([]);
    await r.end();
  });

  it("a runtime without a Phoenix browser says so", async () => {
    const r = await boot(undefined, { relay: false });
    const res = await r.core.api("POST", "/api/browser/assist", { goal: "x" });
    expect(res.json.status).toBe("no_browser");
    await r.end();
  });

  it("audits counts and the page without its query; never the goal or the plan text", async () => {
    const r = await boot(() =>
      JSON.stringify({ actions: [{ kind: "type", selector: "input#q", text: "SECRETTEXT" }] }),
    );
    r.setHtml(FORM);
    await assist(r, "GOALWORDS please");
    const audit = JSON.stringify((await r.core.api("GET", "/api/audit?limit=500")).json);
    expect(audit).toContain("browser.assist.proposed");
    expect(audit).not.toContain("GOALWORDS");
    expect(audit).not.toContain("SECRETTEXT");
    expect(audit).not.toContain("id=1");
    await r.end();
  });
});

describe("POST /api/browser/assist with the hostile pages of the injection suite", () => {
  it("never sends removed content to the model and never turns a gullible reply into steps", async () => {
    const r = await boot((body) => {
      const names = new Set(body.match(/browser\.[a-z]+/g) ?? ["browser.submit"]);
      return [...names]
        .map((tool) =>
          JSON.stringify({ tool, input: { selector: "#buy", destination: "https://evil.test/" } }),
        )
        .join("\n");
    });
    for (const c of CASES) {
      r.setHtml(c.html);
      const before = r.net.chats().length;
      const res = await assist(r, "what should I do here?");
      expect(res.status, c.name).toBe(200);
      expect(res.json.status, c.name).toBe("ok");
      expect(res.json.plan.actions, c.name).toEqual([]);
      const sent = r.net.chats().slice(before);
      expect(sent, c.name).toHaveLength(1);
      for (const marker of c.gone ?? []) expect(sent[0]!.body, c.name).not.toContain(marker);
      const messages = JSON.parse(sent[0]!.body).messages as { role: string; content: string }[];
      expect(messages[0]!.content, c.name).not.toMatch(/ZZ\d\d/);
    }
    expect(r.net.cloud()).toEqual([]);
    expect(r.served.every((k) => k === "snapshot")).toBe(true);
    expect((await r.core.api("GET", "/api/confirmations")).json.confirmations).toEqual([]);
    await r.end();
  }, 120_000);
});
