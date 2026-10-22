// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentApproval, confirmation, startFakeCore, type FakeCore } from "./fake-core";
import { makeHarness, type Harness } from "./harness";

let core: FakeCore;
let h: Harness;

beforeEach(async () => {
  core = await startFakeCore();
  h = makeHarness(core.token, core.url);
});

afterEach(async () => {
  h.cleanup();
  await core.stop();
});

describe("phoenix status", () => {
  it("summarises Core, Fawkes, waiting approvals and unhealthy capabilities", async () => {
    core.confirmations.push(confirmation("conf_1"));
    core.agentApprovals.push(agentApproval("apr_1"));
    const r = await h.cli(["status"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Core ok  v0.0.0-test  dev  up 1h 2m");
    expect(r.out).toContain("Fawkes WAITING: Your input is needed");
    expect(r.out).toContain("Approvals waiting 2");
    expect(r.out).toContain("Active tasks 2");
    expect(r.out).toContain("Kill switch off");
    // Only an enabled capability that is not healthy needs attention; a disabled one does not.
    expect(r.out).toContain("Needs attention: docker (unhealthy)");
    expect(r.out).not.toContain("calendar");
  });

  it("emits one machine-readable JSON document with --json", async () => {
    core.health = { ...core.health, kill_switch: true };
    const r = await h.cli(["status", "--json"]);
    expect(r.code).toBe(0);
    const doc = JSON.parse(r.out) as Record<string, unknown>;
    expect(doc).toMatchObject({
      core: { status: "ok", version: "0.0.0-test", env: "dev", uptime_ms: 3_725_000 },
      fawkes: { state: "WAITING", sleeping: false },
      kill_switch: true,
      approvals_pending: 0,
    });
  });

  it("escapes format characters instead of sending them to terminals in JSON", async () => {
    core.health = { ...core.health, version: "v1\u202Espoof" };
    const r = await h.cli(["status", "--json"]);
    expect(r.out).toContain("\\u202e");
    expect(r.out).not.toContain("\u202E");
    expect(JSON.parse(r.out)).toMatchObject({ core: { version: "v1\\u202espoof" } });
  });

  it("authenticates every request with the token file and labels itself", async () => {
    await h.cli(["status"]);
    expect(core.requests.length).toBeGreaterThanOrEqual(3);
    for (const request of core.requests) {
      expect(request.authorization).toBe(`Bearer ${core.token}`);
      expect(request.client).toBe("phoenix-cli");
      expect(request.method).toBe("GET");
    }
  });

  it("never prints the token, on success or on any failure", async () => {
    const ok = await h.cli(["status"]);
    const json = await h.cli(["status", "--json"]);
    core.failWith = {
      status: 500,
      body: { code: "INTERNAL_ERROR", message: `crashed holding ${core.token} in memory` },
    };
    const failed = await h.cli(["status"]);
    expect(failed.code).toBe(1);
    for (const r of [ok, json, failed]) expect(h.everything(r)).not.toContain(core.token);
    expect(failed.err).toContain("[redacted]");
  });

  it("neutralises terminal escape sequences in text that came from Core", async () => {
    core.health = {
      ...core.health,
      capabilities: [{ id: "evil\u001b]0;pwned\u0007", status: "enabled", health: "unhealthy" }],
    };
    const r = await h.cli(["status"]);
    expect(r.out).not.toContain("\u001b");
    expect(r.out).not.toContain("\u0007");
  });

  it("rejects extra arguments instead of ignoring them", async () => {
    const r = await h.cli(["status", "now"]);
    expect(r.code).toBe(2);
    expect(core.requests).toEqual([]);
  });
});

describe("connecting to Core", () => {
  it("exits 3 with a plain message when nothing is listening", async () => {
    await core.stop();
    const r = await h.cli(["status"]);
    expect(r.code).toBe(3);
    expect(r.err).toContain("Cannot reach Phoenix Core");
    expect(r.err).not.toContain(core.token);
    core = await startFakeCore();
  });

  it("reports a rejected token without echoing it, and exits 1", async () => {
    const stale = makeHarness("stale-token-from-last-run", core.url);
    const r = await stale.cli(["status"]);
    stale.cleanup();
    expect(r.code).toBe(1);
    expect(r.err).toContain("rejected the session token");
    expect(h.everything(r)).not.toContain("stale-token-from-last-run");
  });

  it("refuses to send the token to a non-loopback host or over https", async () => {
    for (const url of [
      "http://example.com:4870",
      "https://127.0.0.1:4870",
      "http://10.0.0.5:4870",
    ]) {
      const r = await h.cli(["--url", url, "status"]);
      expect(r.code, url).toBe(2);
      expect(r.err).toContain("session token is never sent anywhere else");
    }
    expect(core.requests).toEqual([]);
  });

  it("refuses a Core URL that carries credentials", async () => {
    const r = await h.cli(["--url", "http://user:pw@127.0.0.1:4870", "status"]);
    expect(r.code).toBe(2);
  });

  it("does not follow a redirect, so the token cannot be carried to another address", async () => {
    const elsewhere = await startFakeCore(core.token);
    const redirector = createServer((_req, res) => {
      res.writeHead(302, { location: `${elsewhere.url}/api/health` });
      res.end();
    });
    const listening = Promise.withResolvers<void>();
    redirector.listen(0, "127.0.0.1", () => listening.resolve());
    await listening.promise;
    const url = `http://127.0.0.1:${(redirector.address() as AddressInfo).port}`;
    const r = await h.cli(["--url", url, "status"]);
    expect(r.code).toBe(3);
    expect(elsewhere.requests).toEqual([]);
    const closed = Promise.withResolvers<void>();
    redirector.close(() => closed.resolve());
    redirector.closeAllConnections();
    await closed.promise;
    await elsewhere.stop();
  });

  it("asks fetch to treat redirects as errors", async () => {
    let seen: RequestInit["redirect"];
    await h.cli(["status"], {
      fetch: (input, init) => {
        seen = init?.redirect;
        return fetch(input, init);
      },
    });
    expect(seen).toBe("error");
  });

  it("exits 1 when Core answers something that is not JSON", async () => {
    const r = await h.cli(["status"], {
      fetch: () => Promise.resolve(new Response("<html>hi</html>", { status: 200 })),
    });
    expect(r.code).toBe(1);
    expect(r.err).toContain("not JSON");
  });
});
