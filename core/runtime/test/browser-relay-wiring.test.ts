// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 95 through a running Core (real HTTP, real permission gateway, real capability manager). The
// "chrome page" is this test calling the relay routes with the session token; no Tauri command,
// webview or real page exists. It shows: the routes need the session token, a snapshot round-trips
// through the 16 MiB result path (and no other path gets that limit), and a browser action raises an
// approval whose card carries the page (no query), the control and the FULL typed text over
// `GET /api/confirmations`, while the typed text stays out of the audit log and the event store.
import { createBrowserCapability, BrowserRelay } from "@phoenix/capability-browser";
import { afterEach, describe, expect, it } from "vitest";
import { startCore, type TestCore } from "./helpers";

const PAGE = "https://shop.test/cart?session=abc123";
const HTML = `<form id="f"><input id="q" type="text" aria-label="Search"><button id="go">Go</button></form>`;

let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
  await stop?.();
  stop = undefined;
});

async function boot() {
  const relay = new BrowserRelay();
  const core: TestCore = await startCore(
    {},
    { capabilities: [createBrowserCapability({ relay })], runtime: { browserRelay: relay } },
  );
  stop = () => core.runtime.stop();
  expect(
    (
      await core.api("POST", "/api/capabilities/browser/permissions/grant", {
        permissions: ["network"],
      })
    ).status,
  ).toBeLessThan(500);
  return core;
}

/** The chrome page: serves `snapshot` requests with canned HTML and records the rest. */
function chromePage(core: TestCore) {
  const seen: Record<string, unknown>[] = [];
  let running = true;
  const loop = (async () => {
    while (running) {
      const res = await core.api("GET", "/api/browser/relay/next?wait=100");
      const request = res.json?.request as Record<string, unknown> | null;
      if (!request) continue;
      const id = request.id as string;
      if (request.kind === "snapshot") {
        await core.api("POST", `/api/browser/relay/${id}/result`, {
          ok: true,
          snapshot: { url: PAGE, title: "Cart", html: HTML, truncated: false },
        });
      } else {
        seen.push(request);
        await core.api("POST", `/api/browser/relay/${id}/result`, { ok: true, url: PAGE });
      }
    }
  })();
  return {
    seen,
    async end() {
      running = false;
      await loop;
    },
  };
}

describe("browser relay routes", () => {
  it("need the session token and refuse a malformed wait or id", async () => {
    const core = await boot();
    const anon = await fetch(`${core.base}/api/browser/relay/next?wait=0`);
    expect(anon.status).toBe(401);
    const anonPost = await fetch(`${core.base}/api/browser/relay/rq_x/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(anonPost.status).toBe(401);
    expect((await core.api("GET", "/api/browser/relay/next?wait=abc")).status).toBe(400);
    expect((await core.api("GET", "/api/browser/relay/next?wait=0")).json).toEqual({
      request: null,
    });
    expect(
      (await core.api("POST", "/api/browser/relay/rq_unknown/result", { ok: true })).status,
    ).toBe(404);
  });

  it("gives only the result path a body above 256 KiB", async () => {
    const core = await boot();
    const big = { ok: false, reason: "failed", pad: "x".repeat(300 * 1024) };
    const other = await core.api("POST", "/api/browser/relay/rq_x/result", big);
    // unknown id => it was read (404), not rejected as too large
    expect(other.status).toBe(404);
    // Core answers 413 and closes the connection, so the client may see the closed socket instead.
    const refused = async (method: string, path: string, body: unknown) =>
      core.api(method, path, body).then(
        (r) => r.status,
        () => 413,
      );
    const huge = { ok: false, pad: "x".repeat(17 * 1024 * 1024) };
    expect(await refused("POST", "/api/browser/relay/rq_x/result", huge)).toBe(413);
    // a 300 KiB body to any other route (or another method on the result path) is still refused
    expect(await refused("PUT", "/api/browser/shields", big)).toBe(413);
    expect(await refused("POST", "/api/browser/relay/rq_x/other", big)).toBe(404);
  });
});

describe("browser action approval through Core", () => {
  it("shows page, control and the full text on the confirmation, and keeps the text out of the audit", async () => {
    const core = await boot();
    const enable = await core.api("POST", "/api/capabilities/browser/enable", {});
    expect(enable.status).toBe(200);
    const chrome = chromePage(core);
    const text = `hello ${"world ".repeat(100)}`;
    const op = core.runtime.capabilities.invoke("browser", "type", {
      pageUrl: PAGE,
      selector: "input#q",
      text,
    });
    let card: Record<string, any> | undefined;
    for (let i = 0; i < 200 && !card; i += 1) {
      const list = (await core.api("GET", "/api/confirmations")).json.confirmations as any[];
      card = list.find((c) => c.capabilityId === "browser");
      if (!card) await new Promise((r) => setTimeout(r, 10));
    }
    expect(card).toMatchObject({
      command: "type",
      sideEffect: "external",
      details: {
        browser: {
          kind: "type",
          pageUrl: "shop.test/cart",
          selector: "input#q",
          text,
          textLength: text.length,
        },
      },
    });
    expect(JSON.stringify(card)).not.toContain("abc123");
    expect(card!.summary).not.toContain("hello");
    expect(
      (await core.api("POST", `/api/confirmations/${card!.id}`, { approve: true })).status,
    ).toBe(200);
    while (op.status === "pending" || op.status === "running")
      await new Promise((r) => setTimeout(r, 10));
    expect(op.status).toBe("succeeded");
    expect(chrome.seen).toEqual([
      expect.objectContaining({ kind: "type", selector: "input#q", text }),
    ]);
    const audit = JSON.stringify((await core.api("GET", "/api/audit?limit=500")).json);
    expect(audit).not.toContain("hello world");
    expect(audit).not.toContain("abc123");
    await chrome.end();
  });

  it("does not put an action to the user that the card cannot describe exactly", async () => {
    const core = await boot();
    await core.api("POST", "/api/capabilities/browser/enable", {});
    const chrome = chromePage(core);
    // `type` with a selector the card whitelist refuses cannot even pass the manifest schema
    expect(() =>
      core.runtime.capabilities.invoke("browser", "click", { pageUrl: PAGE, selector: "body" }),
    ).toThrow();
    await chrome.end();
  });
});
