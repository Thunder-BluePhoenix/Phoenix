// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FAILURE_THRESHOLD,
  INITIAL_HEALTH,
  applyPing,
  createFrappeCapability,
  discoverBench,
  normalizeOrigin,
  pingSite,
  resolveSiteUrl,
  type PingResult,
  type SiteHealth,
  type SiteView,
} from "../src";
import {
  REMOTE_MARKER,
  startMockFrappe,
  type MockFrappe,
  type MockMode,
} from "../testing/mock-frappe";

// Fake credentials seeded into the fixture's config files. None of them may ever leave the files.
const canary = (what: string, tag: string) => ["SECRET", what, tag].join("-");
const SECRETS = [
  canary("DB-PASSWORD", "7f3a"),
  canary("ENCRYPTION-KEY", "91bd"),
  canary("REDIS-PASS", "c0de"),
  canary("ADMIN-PASS", "55aa"),
  canary("BROKEN-JSON-LEAK", "3e9"),
];

const dirs: string[] = [];
let h: Harness | undefined;
let mock: MockFrappe | undefined;
afterEach(async () => {
  await h?.close();
  await mock?.close();
  h = mock = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface FixtureOptions {
  /** Sites with a valid site_config.json (host_name is optional). */
  sites?: { name: string; host_name?: unknown }[];
  common?: Record<string, unknown> | null;
  apps?: string | null;
}

function write(path: string, content: string | object) {
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
}

function addSite(bench: string, name: string, extra: Record<string, unknown> = {}) {
  mkdirSync(join(bench, "sites", name), { recursive: true });
  write(join(bench, "sites", name, "site_config.json"), {
    db_name: "_abc123",
    db_password: SECRETS[0],
    encryption_key: SECRETS[1],
    admin_password: SECRETS[3],
    ...extra,
  });
}

/** A bench on disk: apps.txt, sites, common_site_config.json, `assets`, stray files, non-sites. */
function fixtureBench(options: FixtureOptions = {}): string {
  const bench = mkdtempSync(join(tmpdir(), "phoenix-frappe-"));
  dirs.push(bench);
  const sites = join(bench, "sites");
  mkdirSync(join(sites, "assets", "frappe"), { recursive: true });
  write(join(sites, "assets", "site_config.json"), { not: "a site" }); // assets is never a site
  if (options.apps !== null) write(join(sites, "apps.txt"), options.apps ?? "frappe\nerpnext\n");
  write(join(sites, "apps.json"), { frappe: {} });
  write(join(sites, "test_db.py"), "print('x')");
  if (options.common !== null) {
    write(join(sites, "common_site_config.json"), {
      redis_cache: `redis://:${SECRETS[2]}@127.0.0.1:13000`,
      ...options.common,
    });
  }
  for (const s of options.sites ?? [{ name: "a.localhost" }]) {
    addSite(bench, s.name, s.host_name !== undefined ? { host_name: s.host_name } : {});
  }
  mkdirSync(join(sites, "empty.localhost")); // directory without site_config.json
  mkdirSync(join(sites, ".hidden"));
  write(join(sites, ".hidden", "site_config.json"), "{}");
  return bench;
}

/** Drives the polling loop one cycle at a time instead of waiting on wall-clock time. */
function manualClock() {
  let waiter: PromiseWithResolvers<void> | undefined;
  let cycles = 0;
  return {
    sleep(_ms: number, signal: AbortSignal): Promise<void> {
      const w = Promise.withResolvers<void>();
      waiter = w;
      cycles++;
      signal.addEventListener("abort", () => w.resolve(), { once: true });
      return w.promise;
    },
    get cycles() {
      return cycles;
    },
    /** Waits for the loop to finish the cycle it is on (it is then sleeping). */
    started: () => vi.waitFor(() => expect(cycles).toBeGreaterThan(0)),
    /** Lets the sleeping loop run exactly one more cycle and waits for it to finish. */
    async tick() {
      await vi.waitFor(() => expect(waiter).toBeDefined());
      const before = cycles;
      const w = waiter!;
      waiter = undefined;
      w.resolve();
      await vi.waitFor(() => expect(cycles).toBe(before + 1));
    },
  };
}

interface Rig {
  h: Harness;
  mock: MockFrappe;
  bench: string;
  clock: ReturnType<typeof manualClock>;
  /** One polling cycle, then let the bus deliver everything it emitted. */
  tick(): Promise<void>;
  count(type: string): number;
  state(): { state: string; explanation: string };
}

async function rig(
  options: FixtureOptions & { config?: Record<string, unknown>; mode?: MockMode } = {},
): Promise<Rig> {
  mock = await startMockFrappe();
  if (options.mode) mock.setMode(options.mode);
  const bench = fixtureBench({
    ...options,
    common: options.common === null ? null : { webserver_port: mock.port, ...options.common },
  });
  const clock = manualClock();
  h = createHarness({ modules: [createFrappeCapability({ sleep: clock.sleep })] });
  h.manager.configure("frappe", { benches: [bench], poll_ms: 250, ...options.config });
  await h.enable("frappe");
  await clock.started();
  const harness = h;
  await harness.drain();
  return {
    h: harness,
    mock,
    bench,
    clock,
    async tick() {
      await clock.tick();
      await harness.drain();
    },
    count: (type) => harness.types("frappe").filter((t) => t === type).length,
    state: () => harness.state.snapshot(),
  };
}

const ok: PingResult = { ok: true, ms: 3 };
const fail: PingResult = { ok: false, ms: 3, error: "HTTP 500", status: 500 };

describe("normalizeOrigin", () => {
  it("accepts only http(s) and reduces to an origin", () => {
    expect(normalizeOrigin("http://127.0.0.1:8000/some/path?x=1")).toBe("http://127.0.0.1:8000");
    expect(normalizeOrigin("https://erp.example.com")).toBe("https://erp.example.com");
    expect(normalizeOrigin("ftp://x")).toBeUndefined();
    expect(normalizeOrigin("file:///etc/passwd")).toBeUndefined();
    expect(normalizeOrigin("javascript:alert(1)")).toBeUndefined();
    expect(normalizeOrigin("http://a b")).toBeUndefined();
    expect(normalizeOrigin("")).toBeUndefined();
  });

  it("takes a bare host_name (Frappe allows it) only when asked to", () => {
    expect(normalizeOrigin("erp.localhost:8000")).toBeUndefined();
    expect(normalizeOrigin("erp.localhost:8000", true)).toBe("http://erp.localhost:8000");
    expect(normalizeOrigin("ftp://erp.localhost", true)).toBeUndefined();
  });
});

describe("resolveSiteUrl", () => {
  const bench = { webserverPort: 8005 };
  it("prefers the user's override, then host_name, then the bench's port on loopback", () => {
    const site = { name: "a.localhost", hostName: "https://a.example.com" };
    const overrides = { "a.localhost": "http://127.0.0.1:9000/ignored" };
    expect(resolveSiteUrl(site, bench, overrides)).toEqual({
      url: "http://127.0.0.1:9000",
      source: "override",
    });
    expect(resolveSiteUrl(site, bench, {})).toEqual({
      url: "https://a.example.com",
      source: "host_name",
    });
    expect(resolveSiteUrl({ name: "a.localhost" }, bench, {})).toEqual({
      url: "http://127.0.0.1:8005",
      source: "default",
    });
  });

  it("does not use an override that is not http(s)", () => {
    expect(resolveSiteUrl({ name: "s" }, bench, { s: "gopher://x" }).source).toBe("default");
  });
});

describe("applyPing", () => {
  const at = new Date("2026-10-09T10:00:00Z");
  /** Feeds pings in order; returns the transitions Fawkes would see. */
  function feed(...results: PingResult[]): (string | undefined)[] {
    let health: SiteHealth = INITIAL_HEALTH;
    return results.map((r) => {
      const step = applyPing(health, r, at);
      health = step.next;
      return step.transition;
    });
  }

  it("needs two consecutive failures before unhealthy, and reports it once", () => {
    expect(FAILURE_THRESHOLD).toBe(2);
    expect(feed(ok, fail, fail, fail, fail)).toEqual([
      undefined,
      undefined,
      "unhealthy",
      undefined,
      undefined,
    ]);
  });

  it("does not flap on a blip: fail-ok-fail-ok never transitions", () => {
    expect(feed(ok, fail, ok, fail, ok, fail, ok)).toEqual(Array(7).fill(undefined));
  });

  it("reports recovery on the first success after unhealthy", () => {
    expect(feed(fail, fail, ok, ok)).toEqual([undefined, "unhealthy", "healthy", undefined]);
  });

  it("a site that is down when first seen still needs two failures", () => {
    expect(feed(fail)).toEqual([undefined]);
  });

  it("keeps the last success time and truncates the error", () => {
    const first = applyPing(INITIAL_HEALTH, ok, at).next;
    const later = applyPing(
      first,
      { ok: false, ms: 1, error: "x".repeat(900) },
      new Date(+at + 1),
    ).next;
    expect(later.lastOkAt).toBe(at.toISOString());
    expect(later.error).toHaveLength(200);
    expect(later.failures).toBe(1);
  });
});

describe("discoverBench", () => {
  it("lists real sites only, reads apps and the web server port", async () => {
    const bench = fixtureBench({
      sites: [{ name: "b.localhost" }, { name: "a.localhost" }],
      common: { webserver_port: 8005, default_site: "a.localhost", serve_default_site: true },
    });
    expect(await discoverBench(bench)).toEqual({
      path: bench,
      name: expect.stringMatching(/^phoenix-frappe-/),
      apps: ["frappe", "erpnext"],
      sites: [{ name: "a.localhost" }, { name: "b.localhost" }],
      webserverPort: 8005,
      defaultSite: "a.localhost",
      serveDefaultSite: true,
    });
  });

  it("skips assets, plain files, hidden dirs and dirs without site_config.json", async () => {
    const bench = fixtureBench({ sites: [{ name: "a.localhost" }] });
    // A symlink-free stand-in for a stray file that has a site-like name.
    write(join(bench, "sites", "notes.localhost"), "just a file");
    const info = await discoverBench(bench);
    expect(info.sites.map((s) => s.name)).toEqual(["a.localhost"]);
  });

  it("defaults the port to 8000 when common_site_config.json is missing, broken or odd", async () => {
    expect((await discoverBench(fixtureBench({ common: null }))).webserverPort).toBe(8000);
    const broken = fixtureBench({ common: null });
    write(join(broken, "sites", "common_site_config.json"), `{"redis": "${SECRETS[4]}`);
    expect((await discoverBench(broken)).webserverPort).toBe(8000);
    for (const port of ["8005", 0, 70000, 80.5, null]) {
      expect(
        (await discoverBench(fixtureBench({ common: { webserver_port: port } }))).webserverPort,
      ).toBe(8000);
    }
  });

  it("tolerates a missing apps.txt and keeps only well-formed, unique app names", async () => {
    expect((await discoverBench(fixtureBench({ apps: null }))).apps).toEqual([]);
    const apps = "frappe\n\n  erpnext  \nfrappe\n../evil\nbad name\nhrms\r\n";
    expect((await discoverBench(fixtureBench({ apps }))).apps).toEqual([
      "frappe",
      "erpnext",
      "hrms",
    ]);
  });

  it("keeps host_name only when it is a usable http(s) origin", async () => {
    const bench = fixtureBench({
      sites: [
        { name: "good.localhost", host_name: "https://erp.example.com/" },
        { name: "bare.localhost", host_name: "erp.localhost:8000" },
        { name: "ftp.localhost", host_name: "ftp://erp.example.com" },
        { name: "number.localhost", host_name: 42 },
      ],
    });
    const byName = Object.fromEntries((await discoverBench(bench)).sites.map((s) => [s.name, s]));
    expect(byName["good.localhost"]).toEqual({
      name: "good.localhost",
      hostName: "https://erp.example.com",
    });
    expect(byName["bare.localhost"]).toEqual({
      name: "bare.localhost",
      hostName: "http://erp.localhost:8000",
    });
    expect(byName["ftp.localhost"]).toEqual({ name: "ftp.localhost" });
    expect(byName["number.localhost"]).toEqual({ name: "number.localhost" });
  });

  it("lists a site whose site_config.json is not valid JSON, without its content", async () => {
    const bench = fixtureBench();
    mkdirSync(join(bench, "sites", "broken.localhost"));
    write(
      join(bench, "sites", "broken.localhost", "site_config.json"),
      `{"db_password": "${SECRETS[4]}`,
    );
    const info = await discoverBench(bench);
    expect(info.sites.map((s) => s.name)).toContain("broken.localhost");
    expect(JSON.stringify(info)).not.toContain(SECRETS[4]);
  });

  it("refuses a directory that is not a bench, with a message free of file content", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phoenix-notbench-"));
    dirs.push(dir);
    await expect(discoverBench(dir)).rejects.toThrow("Not a Frappe bench");
    await expect(discoverBench(join(dir, "missing"))).rejects.toThrow("Not a Frappe bench");
  });
});

describe("pingSite", () => {
  const timeoutMs = 2_000;
  async function pingMode(mode: MockMode, site = "a.localhost") {
    mock = await startMockFrappe();
    mock.setMode(mode);
    return pingSite(mock.url, site, { timeoutMs });
  }

  it("accepts Frappe's pong and sends the site name in X-Frappe-Site-Name", async () => {
    const result = await pingMode("ok", "erp.localhost");
    expect(result).toMatchObject({ ok: true });
    expect(mock!.requests).toEqual([
      { path: "/api/method/ping", site: "erp.localhost", accept: "application/json" },
    ]);
  });

  it("fails on a 500, a missing site, a wrong body and malformed JSON — never echoing the response", async () => {
    const results = [
      await pingMode("http500"),
      await pingMode("wrong-body"),
      await pingMode("malformed"),
    ];
    expect(results[0]).toMatchObject({ ok: false, status: 500, error: "HTTP 500" });
    expect(results[1]).toMatchObject({ ok: false, error: "not a Frappe ping response" });
    expect(results[2]).toMatchObject({ ok: false, error: "not a Frappe ping response" });
    expect(JSON.stringify(results)).not.toContain(REMOTE_MARKER);

    mock!.setMode("ok");
    mock!.serveOnly(["other.localhost"]);
    const missing = await pingSite(mock!.url, "a.localhost", { timeoutMs });
    expect(missing).toMatchObject({ ok: false, status: 404 });
    expect(JSON.stringify(missing)).not.toContain(REMOTE_MARKER);
  });

  it("caps the body: a chunked or declared-huge pong is a failure, not a memory problem", async () => {
    for (const mode of ["huge", "huge-declared"] as const) {
      const result = await pingMode(mode);
      expect(result).toMatchObject({ ok: false, error: "response too large for a ping" });
      await mock!.close();
    }
  });

  it("does not follow redirects", async () => {
    expect(await pingMode("redirect")).toMatchObject({ ok: false, status: 302 });
    expect(mock!.requests).toHaveLength(1);
  });

  it("reports a closed port and a dropped connection as failures", async () => {
    expect(await pingMode("down")).toMatchObject({ ok: false });
    const closed = await startMockFrappe();
    const url = closed.url;
    await closed.close();
    expect(await pingSite(url, "a", { timeoutMs })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^(connection failed \(ECONNREFUSED\)|request failed)$/),
    });
  });

  it("gives up on a hung server at the timeout", async () => {
    mock = await startMockFrappe();
    mock.setMode("hang");
    expect(await pingSite(mock.url, "a", { timeoutMs: 40 })).toMatchObject({
      ok: false,
      error: "no response within 40 ms",
    });
  });

  it("stops when the caller aborts", async () => {
    mock = await startMockFrappe();
    mock.setMode("hang");
    const abort = new AbortController();
    const pending = pingSite(mock.url, "a", { timeoutMs: 60_000, signal: abort.signal });
    await vi.waitFor(() => expect(mock!.requests).toHaveLength(1));
    abort.abort();
    expect(await pending).toMatchObject({ ok: false, error: "cancelled" });
  });
});

describe("frappe capability", () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, "write");
    vi.spyOn(process.stderr, "write");
  });
  afterEach(() => vi.restoreAllMocks());

  it("asks for filesystem_read, network and external_api, and only task.create writes", async () => {
    const r = await rig();
    const view = r.h.manager.get("frappe");
    expect(view.permissions.map((p) => p.permission)).toEqual([
      "filesystem_read",
      "network",
      "external_api",
    ]);
    expect(view.commands).toEqual([
      expect.objectContaining({ name: "sites", side_effect: "read" }),
      expect.objectContaining({ name: "benches", side_effect: "read" }),
      expect.objectContaining({ name: "task.create", side_effect: "external" }),
    ]);
  });

  it("refuses relative bench paths and non-http(s) site URLs", async () => {
    h = createHarness({ modules: [createFrappeCapability()] });
    h.manager.configure("frappe", { benches: ["relative/bench"] });
    await expect(h.enable("frappe")).rejects.toThrow(/must be absolute/);
    expect(() =>
      h!.manager.configure("frappe", { sites: { "a.localhost": "file:///etc/passwd" } }),
    ).toThrow();
    expect(() => h!.manager.configure("frappe", { benches: Array(11).fill("/x") })).toThrow();
    h.manager.configure("frappe", { benches: ["/tmp"], sites: { "../x": "http://127.0.0.1:1" } });
    await expect(h.enable("frappe")).rejects.toThrow(/Invalid site name/);
  });

  it("announces a bench quietly on first sync, and a later new site as news", async () => {
    const r = await rig({ sites: [{ name: "a.localhost" }, { name: "b.localhost" }] });
    const found = r.h.events.filter((e) => e.event_type === "frappe.bench.discovered");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      source: "frappe",
      severity: "info",
      payload: {
        bench: r.bench,
        apps: ["frappe", "erpnext"],
        sites: ["a.localhost", "b.localhost"],
      },
    });
    expect(found[0]!.payload).not.toHaveProperty("added");
    // First sync is ephemeral: Fawkes does not light up for something that already existed.
    expect(
      r.h.db.prepare("SELECT 1 FROM events WHERE event_type = 'frappe.bench.discovered'").all(),
    ).toEqual([]);

    await r.tick();
    expect(r.count("frappe.bench.discovered")).toBe(1);
    addSite(r.bench, "c.localhost");
    await r.tick();
    const second = r.h.events.filter((e) => e.event_type === "frappe.bench.discovered")[1];
    expect(second).toMatchObject({ payload: { added: ["c.localhost"] } });
    expect(
      r.h.db.prepare("SELECT 1 FROM events WHERE event_type = 'frappe.bench.discovered'").all(),
    ).toHaveLength(1);
  });

  it("a site failure drives Fawkes to ERROR after two failures, and recovery clears it", async () => {
    const r = await rig();
    expect(r.count("frappe.site.unhealthy")).toBe(0);
    expect(r.state().state).not.toBe("ERROR");

    r.mock.setMode("down");
    await r.tick();
    expect(r.count("frappe.site.unhealthy")).toBe(0); // one failure is a blip
    expect(r.state().state).not.toBe("ERROR");

    await r.tick();
    expect(r.count("frappe.site.unhealthy")).toBe(1);
    expect(r.state()).toMatchObject({
      state: "ERROR",
      explanation: "Site a.localhost is unhealthy",
    });
    const event = r.h.events.find((e) => e.event_type === "frappe.site.unhealthy")!;
    expect(event).toMatchObject({
      severity: "error",
      subject: "a.localhost",
      payload: { site: "a.localhost", url: r.mock.url, consecutive_failures: 2 },
    });

    await r.tick(); // still down: no repeat event
    expect(r.count("frappe.site.unhealthy")).toBe(1);
    expect(r.state().state).toBe("ERROR");

    r.mock.setMode("ok");
    await r.tick();
    expect(r.count("frappe.site.healthy")).toBe(1);
    expect(r.state().state).not.toBe("ERROR");
    expect(r.h.events.find((e) => e.event_type === "frappe.site.healthy")).toMatchObject({
      severity: "success",
      subject: "a.localhost",
    });
  });

  it("a restart blip does not flap Fawkes", async () => {
    const r = await rig();
    for (let i = 0; i < 3; i++) {
      r.mock.setMode("down");
      await r.tick();
      r.mock.setMode("ok");
      await r.tick();
    }
    expect(r.count("frappe.site.unhealthy") + r.count("frappe.site.healthy")).toBe(0);
    expect(r.state().state).not.toBe("ERROR");
  });

  it("a hostile response makes the site unhealthy without any of its text reaching an event", async () => {
    const r = await rig();
    for (const mode of ["http500", "malformed", "huge", "wrong-body"] as const) {
      r.mock.setMode(mode);
      await r.tick();
      await r.tick();
      expect(r.state().state).toBe("ERROR");
      r.mock.setMode("ok");
      await r.tick();
      expect(r.state().state).not.toBe("ERROR");
    }
    expect(r.count("frappe.site.unhealthy")).toBe(4);
    expect(JSON.stringify(r.h.events)).not.toContain(REMOTE_MARKER);
  });

  it("tracks sites independently: one failing site is ERROR for that site and degrades health", async () => {
    const r = await rig({ sites: [{ name: "a.localhost" }, { name: "b.localhost" }] });
    r.mock.serveOnly(["a.localhost"]); // b.localhost now 404s, like a site that was dropped
    await r.tick();
    await r.tick();
    expect(r.count("frappe.site.unhealthy")).toBe(1);
    expect(r.state()).toMatchObject({
      state: "ERROR",
      explanation: "Site b.localhost is unhealthy",
    });
    const view = await r.h.manager.checkHealth("frappe");
    expect(view.health).toMatchObject({
      status: "degraded",
      message: expect.stringContaining("1/2 sites healthy"),
    });
    expect(view.health.message).toContain("b.localhost: HTTP 404");

    // Each site was addressed by its own name.
    const seen = new Set(r.mock.requests.map((q) => q.site));
    expect(seen).toEqual(new Set(["a.localhost", "b.localhost"]));

    r.mock.setMode("down");
    await r.tick();
    await r.tick();
    expect(r.count("frappe.site.unhealthy")).toBe(2);
    expect((await r.h.manager.checkHealth("frappe")).health.status).toBe("unhealthy");

    r.mock.setMode("ok");
    r.mock.serveOnly(null);
    await r.tick();
    expect(r.count("frappe.site.healthy")).toBe(2);
    expect(r.state().state).not.toBe("ERROR");
    expect((await r.h.manager.checkHealth("frappe")).health.status).toBe("healthy");
  });

  it("two benches with the same site name stay separate activities", async () => {
    const second = await startMockFrappe();
    const other = fixtureBench({ common: { webserver_port: second.port } });
    const r = await rig();
    await r.h.close();
    const clock = manualClock();
    h = createHarness({ modules: [createFrappeCapability({ sleep: clock.sleep })] });
    h.manager.configure("frappe", { benches: [r.bench, other], poll_ms: 250 });
    await h.enable("frappe");
    await clock.started();
    second.setMode("down");
    await clock.tick();
    await clock.tick();
    await h.drain();
    expect(h.events.filter((e) => e.event_type === "frappe.site.unhealthy")).toHaveLength(1);
    expect(h.state.snapshot().state).toBe("ERROR");
    r.mock.setMode("down");
    await clock.tick();
    await clock.tick();
    await h.drain();
    expect(h.events.filter((e) => e.event_type === "frappe.site.unhealthy")).toHaveLength(2);
    second.setMode("ok");
    await clock.tick();
    await h.drain();
    expect(h.state.snapshot().state).toBe("ERROR"); // the first bench's site is still down
    await second.close();
  });

  it("uses a configured URL override, then host_name, then the bench port", async () => {
    mock = await startMockFrappe();
    const viaHost = await startMockFrappe();
    const viaPort = await startMockFrappe();
    const bench = fixtureBench({
      sites: [
        { name: "over.localhost", host_name: "http://127.0.0.1:1" }, // dead, but overridden
        { name: "host.localhost", host_name: viaHost.url },
        { name: "port.localhost" },
      ],
      common: { webserver_port: viaPort.port },
    });
    const clock = manualClock();
    h = createHarness({ modules: [createFrappeCapability({ sleep: clock.sleep })] });
    h.manager.configure("frappe", {
      benches: [bench],
      sites: { "over.localhost": mock.url },
      poll_ms: 250,
    });
    await h.enable("frappe");
    await clock.started();
    const op = await h.run("frappe", "sites");
    const { sites } = op.result as { sites: SiteView[] }; // the handler's declared return type
    expect(sites.map((s) => [s.site, s.url, s.url_source, s.status])).toEqual([
      ["host.localhost", viaHost.url, "host_name", "healthy"],
      ["over.localhost", mock.url, "override", "healthy"],
      ["port.localhost", viaPort.url, "default", "healthy"],
    ]);
    expect(mock.requests.map((q) => q.site)).toEqual(["over.localhost"]);
    expect(viaHost.requests.map((q) => q.site)).toEqual(["host.localhost"]);
    expect(viaPort.requests.map((q) => q.site)).toEqual(["port.localhost"]);
    await viaHost.close();
    await viaPort.close();
  });

  it("removes the ERROR when an unhealthy site disappears from the bench", async () => {
    const r = await rig({ sites: [{ name: "a.localhost" }, { name: "b.localhost" }] });
    r.mock.setMode("down");
    await r.tick();
    await r.tick();
    expect(r.count("frappe.site.unhealthy")).toBe(2);
    rmSync(join(r.bench, "sites", "a.localhost"), { recursive: true });
    rmSync(join(r.bench, "sites", "b.localhost"), { recursive: true });
    await r.tick();
    expect(r.count("frappe.site.removed")).toBe(2);
    expect(r.state().state).not.toBe("ERROR");
    expect(r.h.events.find((e) => e.event_type === "frappe.site.removed")).toMatchObject({
      payload: { was_unhealthy: true },
    });
  });

  it("a bench that is not there degrades health and does not stop the others", async () => {
    mock = await startMockFrappe();
    const good = fixtureBench({ common: { webserver_port: mock.port } });
    const missing = join(tmpdir(), "phoenix-no-such-bench-" + process.pid);
    const clock = manualClock();
    h = createHarness({ modules: [createFrappeCapability({ sleep: clock.sleep })] });
    h.manager.configure("frappe", { benches: [missing, good], poll_ms: 250 });
    await h.enable("frappe");
    await clock.started();
    const view = await h.manager.checkHealth("frappe");
    expect(view.health.status).toBe("degraded");
    expect(view.health.message).toContain("Not a Frappe bench");
    const op = await h.run("frappe", "benches");
    expect(op.result).toMatchObject({
      benches: [
        { path: missing, error: expect.stringContaining("Not a Frappe bench") },
        { path: good, sites: ["a.localhost"], webserver_port: mock.port },
      ],
    });
    // Bench dies later: the earlier discovery is kept and the error is reported.
    rmSync(good, { recursive: true, force: true });
    await clock.tick();
    expect((await h.manager.checkHealth("frappe")).health.status).toBe("unhealthy");
  });

  it("degrades health when no bench is selected", async () => {
    h = createHarness({ modules: [createFrappeCapability()] });
    h.manager.configure("frappe", {});
    await h.enable("frappe");
    expect((await h.manager.checkHealth("frappe")).health).toMatchObject({
      status: "degraded",
      message: "No benches selected",
    });
    expect((await h.run("frappe", "sites")).result).toEqual({ sites: [] });
  });

  it("the sites command gives a panel everything it needs, and no config values", async () => {
    const r = await rig({ sites: [{ name: "a.localhost" }, { name: "b.localhost" }] });
    r.mock.serveOnly(["a.localhost"]);
    await r.tick();
    const op = await r.h.run("frappe", "sites");
    expect(op.status).toBe("succeeded");
    expect(op.result).toEqual({
      sites: [
        {
          site: "a.localhost",
          bench: r.bench,
          url: r.mock.url,
          url_source: "default",
          status: "healthy",
          consecutive_failures: 0,
          last_checked_at: expect.any(String),
          last_ok_at: expect.any(String),
          response_ms: expect.any(Number),
          apps: ["frappe", "erpnext"],
        },
        {
          site: "b.localhost",
          bench: r.bench,
          url: r.mock.url,
          url_source: "default",
          status: "healthy", // one failure so far: not yet reported
          consecutive_failures: 1,
          last_checked_at: expect.any(String),
          last_ok_at: expect.any(String),
          response_ms: expect.any(Number),
          error: "HTTP 404",
          apps: ["frappe", "erpnext"],
        },
      ],
    });
    await r.tick();
    const afterOp = await r.h.run("frappe", "sites");
    const after = afterOp.result as { sites: SiteView[] }; // handler's declared return type
    expect(after.sites.map((s) => s.status)).toEqual(["healthy", "unhealthy"]);
  });

  it("never lets anything from site_config.json or common_site_config.json out", async () => {
    const r = await rig({
      sites: [{ name: "a.localhost", host_name: "http://127.0.0.1:1" }, { name: "b.localhost" }],
    });
    // A third site whose config is not valid JSON (the parse error text would quote it).
    mkdirSync(join(r.bench, "sites", "broken.localhost"));
    write(
      join(r.bench, "sites", "broken.localhost", "site_config.json"),
      `{"db_password": "${SECRETS[4]}`,
    );
    r.mock.serveOnly(["b.localhost"]); // a and broken fail, so unhealthy events and errors are produced
    await r.tick();
    await r.tick();
    await r.tick();
    expect(r.count("frappe.site.unhealthy")).toBeGreaterThan(0);

    const outputs = [
      JSON.stringify(r.h.events),
      JSON.stringify(await r.h.run("frappe", "sites")),
      JSON.stringify(await r.h.run("frappe", "benches")),
      JSON.stringify((await r.h.manager.checkHealth("frappe")).health),
      JSON.stringify(r.h.manager.get("frappe")),
      JSON.stringify(r.state()),
      JSON.stringify(r.h.db.prepare("SELECT * FROM events").all()),
      JSON.stringify(vi.mocked(process.stdout.write).mock.calls),
      JSON.stringify(vi.mocked(process.stderr.write).mock.calls),
    ].join("\n");
    for (const secret of SECRETS) expect(outputs).not.toContain(secret);
    expect(outputs).not.toContain("_abc123"); // db_name
    expect(outputs).not.toContain("db_password");
    expect(outputs).not.toContain("redis://");
  });

  it("disabling stops polling, aborts an in-flight ping and clears the site's ERROR", async () => {
    const r = await rig();
    r.mock.setMode("down");
    await r.tick();
    await r.tick();
    expect(r.state().state).toBe("ERROR");

    await r.h.manager.disable("frappe");
    expect(r.state().state).not.toBe("ERROR");
    const requests = r.mock.requests.length;
    const cycles = r.clock.cycles;
    await new Promise<void>((resolve) => setImmediate(resolve)); // flush; the loop must not start another cycle
    expect(r.clock.cycles).toBe(cycles);
    expect(r.mock.requests.length).toBe(requests);

    // Re-enabling starts fresh, hangs, and is then disabled mid-request.
    r.mock.setMode("hang");
    const events = r.h.events.length;
    const abandoned = r.mock.closedEarly;
    await r.h.enable("frappe");
    await vi.waitFor(() => expect(r.mock.requests.length).toBe(requests + 1));
    await r.h.manager.disable("frappe");
    await vi.waitFor(() => expect(r.mock.closedEarly).toBe(abandoned + 1));
    await r.h.drain();
    expect(r.h.events.slice(events).map((e) => e.event_type)).not.toContain(
      "frappe.site.unhealthy",
    );
  });
});
