// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startCore, TOKEN } from "./helpers";

let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
  await stop?.();
  stop = undefined;
});

function site() {
  const root = mkdtempSync(join(tmpdir(), "phoenix-web-"));
  mkdirSync(join(root, "assets"));
  writeFileSync(
    join(root, "index.html"),
    "<!doctype html><html><head><title>Phoenix</title></head><body></body></html>",
  );
  writeFileSync(join(root, "assets", "app-abc123.js"), "console.log('fawkes')");
  return root;
}

/** Raw GET so path traversal sequences are sent untouched. */
function rawGet(port: number, path: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    request({ host: "127.0.0.1", port, path }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    })
      .on("error", reject)
      .end();
  });
}

describe("web app serving", () => {
  it("serves index.html with the session token and strict headers", async () => {
    const core = await startCore({ webRoot: site() });
    stop = () => core.runtime.stop();
    const res = await fetch(`${core.base}/`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain(`<meta name="phoenix-token" content="${TOKEN}">`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("serves hashed assets with long caching and falls back to index.html for app routes", async () => {
    const core = await startCore({ webRoot: site() });
    stop = () => core.runtime.stop();
    const asset = await fetch(`${core.base}/assets/app-abc123.js`);
    expect(asset.headers.get("content-type")).toContain("text/javascript");
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect(await asset.text()).toContain("fawkes");
    expect(await (await fetch(`${core.base}/meetings/42`)).text()).toContain("phoenix-token");
  });

  it("never serves files outside the web root", async () => {
    const core = await startCore({ webRoot: site() });
    stop = () => core.runtime.stop();
    for (const path of [
      "/../../../../etc/passwd",
      "/%2e%2e/%2e%2e/etc/passwd",
      "/assets/../../package.json",
    ]) {
      const res = await rawGet(core.port, path);
      expect(res.body).not.toMatch(/root:|"name"/);
    }
  });

  it("explains how to build when no web app is present", async () => {
    const core = await startCore();
    stop = () => core.runtime.stop();
    const res = await fetch(`${core.base}/`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { message: string }).message).toMatch(/not built/);
  });
});
