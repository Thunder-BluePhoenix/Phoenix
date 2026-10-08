// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Frappe / ERPNext capability (Phase 23). Read-only: it never runs `bench`, never writes to a
// bench and never talks to a database. It
//   * discovers the benches the user selected (sites/apps.txt, the site directories, the web
//     server port from sites/common_site_config.json), and
//   * polls every site's `/api/method/ping`, turning transitions into frappe.site.* events.
//
// Secrets: a bench's `sites/<site>/site_config.json` and `sites/common_site_config.json` hold
// database passwords and encryption keys. They are parsed only to pull out `host_name`,
// `webserver_port`, `default_site` and `serve_default_site`; nothing else is retained, nothing
// else can reach an event, a command result, health text or a log, and parse errors (whose text
// can quote file content) are discarded.
//
// SSRF: the URL that gets polled is `sites[<site>]` from the user's own capability config, else
// the site's `host_name`, else http://127.0.0.1:<webserver_port>. Only http(s) origins are
// accepted, redirects are never followed, responses are size-capped and only ever compared with
// `{"message":"pong"}`; remote text never reaches an event. `host_name` comes from a file in a
// bench the user selected, so whoever can edit that file can already make Phoenix poll any URL;
// the per-site override exists so a dev bench whose host_name does not resolve can be pointed at
// loopback.
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { redact } from "@phoenix/logging";
import { defineCapability, type CapabilityContext, type HealthResult } from "@phoenix/sdk";
import { isRecord } from "./guards";

/** Consecutive failed pings before a site is reported unhealthy (a restart blip is not an outage). */
export const FAILURE_THRESHOLD = 2;
export const DEFAULT_PORT = 8000;
const DEFAULT_POLL_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_PING_BYTES = 16 * 1024;
const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_SITES_PER_BENCH = 50;
const MAX_APPS = 100;
const MAX_CONCURRENCY = 8;
const MAX_ERROR_CHARS = 200;
const SITE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,148}$/;
const APP_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/;

type FrappeEvent = Parameters<CapabilityContext["emit"]>[0];

// ---------------------------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------------------------

export interface SiteInfo {
  name: string;
  /** `host_name` from site_config.json, if it is a usable http(s) origin. */
  hostName?: string;
}

export interface BenchInfo {
  path: string;
  name: string;
  /** Apps installed in the bench (sites/apps.txt). Per-site installs live in the database. */
  apps: string[];
  sites: SiteInfo[];
  webserverPort: number;
  defaultSite?: string;
  serveDefaultSite: boolean;
}

export interface CommonSiteConfig {
  webserverPort: number;
  defaultSite?: string;
  serveDefaultSite: boolean;
}

/** Reads a small regular file; undefined if it is missing, not a file or too large. */
async function readSmallFile(path: string): Promise<string | undefined> {
  try {
    const s = await stat(path);
    if (!s.isFile() || s.size > MAX_CONFIG_BYTES) return undefined;
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Parses JSON, returning undefined on any error. The error text is dropped on purpose: a
 * SyntaxError message can quote the file's content, which may be a password. */
function parseJsonObject(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The origin of an http(s) URL (host_name may omit the scheme, as Frappe's get_url allows). */
export function normalizeOrigin(value: string, assumeHttp = false): string | undefined {
  const text = value.trim();
  if (!text || text.length > 300 || /\s/.test(text)) return undefined;
  const withScheme = assumeHttp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? `http://${text}` : text;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

/** Only these four fields of common_site_config.json are ever looked at. */
export async function readCommonSiteConfig(benchPath: string): Promise<CommonSiteConfig> {
  const json = parseJsonObject(
    await readSmallFile(join(benchPath, "sites", "common_site_config.json")),
  );
  const port = json?.webserver_port;
  const defaultSite = json?.default_site;
  return {
    webserverPort:
      typeof port === "number" && Number.isInteger(port) && port >= 1 && port <= 65_535
        ? port
        : DEFAULT_PORT,
    ...(typeof defaultSite === "string" && SITE_NAME.test(defaultSite) ? { defaultSite } : {}),
    serveDefaultSite: json?.serve_default_site === true,
  };
}

/** Installed app names from sites/apps.txt (empty if the file is missing). */
export async function readBenchApps(benchPath: string): Promise<string[]> {
  const text = await readSmallFile(join(benchPath, "sites", "apps.txt"));
  if (text === undefined) return [];
  const apps: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const app = line.trim();
    if (APP_NAME.test(app) && !apps.includes(app)) apps.push(app);
    if (apps.length >= MAX_APPS) break;
  }
  return apps;
}

/**
 * Names of the real sites in a bench: directories under sites/ that contain a site_config.json.
 * `assets`, plain files (apps.txt, apps.json, ...), hidden entries, odd names and directories
 * without site_config.json are skipped. site_config.json is only stat'ed here, never opened.
 */
export async function listSiteNames(benchPath: string): Promise<string[]> {
  const sitesDir = join(benchPath, "sites");
  const entries = await readdir(sitesDir);
  const names: string[] = [];
  for (const name of entries.sort()) {
    if (name === "assets" || !SITE_NAME.test(name)) continue;
    try {
      if (!(await stat(join(sitesDir, name))).isDirectory()) continue;
      if (!(await stat(join(sitesDir, name, "site_config.json"))).isFile()) continue;
    } catch {
      continue;
    }
    names.push(name);
    if (names.length >= MAX_SITES_PER_BENCH) break;
  }
  return names;
}

/** `host_name` of a site, or undefined. Everything else in site_config.json is discarded. */
export async function readHostName(benchPath: string, site: string): Promise<string | undefined> {
  const json = parseJsonObject(
    await readSmallFile(join(benchPath, "sites", site, "site_config.json")),
  );
  const hostName = json?.host_name;
  return typeof hostName === "string" ? normalizeOrigin(hostName, true) : undefined;
}

/** Reads one bench. Throws an Error with a short, content-free message if it is not a bench. */
export async function discoverBench(benchPath: string): Promise<BenchInfo> {
  let names: string[];
  try {
    names = await listSiteNames(benchPath);
  } catch {
    throw new Error("Not a Frappe bench (cannot read its sites/ directory)");
  }
  const [apps, common] = await Promise.all([
    readBenchApps(benchPath),
    readCommonSiteConfig(benchPath),
  ]);
  const sites = await Promise.all(
    names.map(async (name): Promise<SiteInfo> => {
      const hostName = await readHostName(benchPath, name);
      return hostName ? { name, hostName } : { name };
    }),
  );
  return {
    path: benchPath,
    name: basename(benchPath),
    apps,
    sites,
    webserverPort: common.webserverPort,
    ...(common.defaultSite ? { defaultSite: common.defaultSite } : {}),
    serveDefaultSite: common.serveDefaultSite,
  };
}

export type UrlSource = "override" | "host_name" | "default";

/** Where to ping a site: user override, else host_name, else loopback on the bench's port. */
export function resolveSiteUrl(
  site: SiteInfo,
  bench: Pick<BenchInfo, "webserverPort">,
  overrides: Readonly<Record<string, string>>,
): { url: string; source: UrlSource } {
  const override = overrides[site.name];
  if (override) {
    const url = normalizeOrigin(override);
    if (url) return { url, source: "override" };
  }
  if (site.hostName) return { url: site.hostName, source: "host_name" };
  return { url: `http://127.0.0.1:${bench.webserverPort}`, source: "default" };
}

// ---------------------------------------------------------------------------------------------
// Health polling
// ---------------------------------------------------------------------------------------------

export type PingResult =
  { ok: true; ms: number } | { ok: false; ms: number; error: string; status?: number };

function errorCode(err: unknown): string | undefined {
  const cause = isRecord(err) ? err.cause : undefined;
  const code = isRecord(cause) ? cause.code : isRecord(err) ? err.code : undefined;
  return typeof code === "string" && /^[A-Z0-9_]{3,40}$/.test(code) ? code : undefined;
}

/** Reads at most `max` bytes; null when the body is larger. */
async function readCapped(res: Response, max: number): Promise<string | null> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > max) {
    await res.body?.cancel();
    return null;
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * GETs `<base>/api/method/ping` and checks for Frappe's `{"message":"pong"}`. Never throws; the
 * failure text is built here from the status/error class, never from the response.
 * The site name goes in X-Frappe-Site-Name, which Frappe uses to pick the site on a multi-tenant
 * bench (frappe/app.py init_request). fetch() cannot override the Host header.
 */
export async function pingSite(
  base: string,
  site: string,
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<PingResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    const res = await fetch(`${base}/api/method/ping`, {
      headers: { accept: "application/json", "x-frappe-site-name": site },
      redirect: "manual",
      signal,
    });
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      return {
        ok: false,
        ms: elapsed(),
        status: res.status,
        error: `HTTP ${res.status} redirect (not followed)`,
      };
    }
    if (!res.ok) {
      await res.body?.cancel();
      return { ok: false, ms: elapsed(), status: res.status, error: `HTTP ${res.status}` };
    }
    const text = await readCapped(res, MAX_PING_BYTES);
    const ms = elapsed();
    if (text === null) {
      return { ok: false, ms, status: res.status, error: "response too large for a ping" };
    }
    const body = parseJsonObject(text);
    if (body?.message !== "pong") {
      return { ok: false, ms, status: res.status, error: "not a Frappe ping response" };
    }
    return { ok: true, ms };
  } catch (err) {
    const ms = elapsed();
    if (timeout.aborted) {
      return { ok: false, ms, error: `no response within ${options.timeoutMs} ms` };
    }
    if (options.signal?.aborted) return { ok: false, ms, error: "cancelled" };
    const code = errorCode(err);
    return { ok: false, ms, error: code ? `connection failed (${code})` : "request failed" };
  }
}

/** One entry of the `sites` command's result (what a panel view renders). */
export interface SiteView {
  site: string;
  bench: string;
  url: string;
  url_source: UrlSource;
  status: "checking" | "healthy" | "unhealthy";
  consecutive_failures: number;
  last_checked_at?: string;
  last_ok_at?: string;
  response_ms?: number;
  error?: string;
  apps: string[];
}

/** What Phoenix remembers about one site's health. */
export interface SiteHealth {
  /** True once a ping has completed. */
  checked: boolean;
  /** Consecutive failed pings. */
  failures: number;
  /** True once frappe.site.unhealthy was emitted and frappe.site.healthy has not followed. */
  unhealthy: boolean;
  lastCheckedAt?: string;
  lastOkAt?: string;
  responseMs?: number;
  error?: string;
  status?: number;
}

export const INITIAL_HEALTH: SiteHealth = { checked: false, failures: 0, unhealthy: false };

/**
 * Folds one ping into a site's health. A transition is returned only when it should reach Fawkes:
 * "unhealthy" after FAILURE_THRESHOLD consecutive failures, "healthy" on the first success after
 * that. A single failed ping between successes changes nothing visible.
 */
export function applyPing(
  prev: SiteHealth,
  result: PingResult,
  now: Date,
  threshold = FAILURE_THRESHOLD,
): { next: SiteHealth; transition?: "unhealthy" | "healthy" } {
  const at = now.toISOString();
  if (result.ok) {
    const next: SiteHealth = {
      checked: true,
      failures: 0,
      unhealthy: false,
      lastCheckedAt: at,
      lastOkAt: at,
      responseMs: result.ms,
    };
    return prev.unhealthy ? { next, transition: "healthy" } : { next };
  }
  const failures = prev.failures + 1;
  const crossed = !prev.unhealthy && failures >= threshold;
  const next: SiteHealth = {
    checked: true,
    failures,
    unhealthy: prev.unhealthy || crossed,
    ...(prev.lastOkAt ? { lastOkAt: prev.lastOkAt } : {}),
    lastCheckedAt: at,
    responseMs: result.ms,
    error: result.error.slice(0, MAX_ERROR_CHARS),
    ...(result.status !== undefined ? { status: result.status } : {}),
  };
  return crossed ? { next, transition: "unhealthy" } : { next };
}

// ---------------------------------------------------------------------------------------------
// Capability
// ---------------------------------------------------------------------------------------------

interface BenchState {
  path: string;
  info?: BenchInfo;
  /** Why the last discovery failed; the previous `info` stays in use. */
  error?: string;
}

interface SiteState {
  bench: string;
  name: string;
  url: string;
  urlSource: UrlSource;
  apps: string[];
  health: SiteHealth;
}

/** One enable → disable run. A new run gets fresh state, so a late cycle of an old run is harmless. */
interface Run {
  benches: Map<string, BenchState>;
  sites: Map<string, SiteState>;
  overrides: Record<string, string>;
  /** Resolves once the first discovery pass is done (pings may still be running). */
  firstCycle: Promise<void>;
  finishFirstCycle: () => void;
}

export interface FrappeOptions {
  /** Waits between polling cycles; rejects never, resolves early on abort. Tests inject a fake. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => Date;
}

function timerSleep(ms: number, signal: AbortSignal): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const t = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  return promise;
}

const siteKey = (bench: string, site: string) => `${bench}\0${site}`;

/** One activity per site: a later event with this id replaces the earlier one in Fawkes. */
export function siteCorrelation(bench: string, site: string): string {
  return `frappe-site:${createHash("sha1").update(bench).digest("hex").slice(0, 8)}:${site}`;
}

async function mapLimit<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function benchList(ctx: CapabilityContext): string[] {
  const raw = ctx.config.benches;
  return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string") : [];
}

function siteOverrides(ctx: CapabilityContext): Record<string, string> {
  const raw = ctx.config.sites;
  const out: Record<string, string> = {};
  if (isRecord(raw)) {
    for (const [name, url] of Object.entries(raw)) if (typeof url === "string") out[name] = url;
  }
  return out;
}

/** A fresh capability instance (its own state); Phoenix Core uses `frappeCapability`. */
export function createFrappeCapability(options: FrappeOptions = {}) {
  const sleep = options.sleep ?? timerSleep;
  const now = options.now ?? (() => new Date());
  let run: Run | undefined;

  const siteEvent = (
    type: "frappe.site.unhealthy" | "frappe.site.healthy",
    s: SiteState,
  ): FrappeEvent => ({
    event_type: type,
    severity: type === "frappe.site.unhealthy" ? "error" : "success",
    subject: s.name,
    correlation_id: siteCorrelation(s.bench, s.name),
    payload: {
      site: s.name,
      bench: s.bench,
      url: s.url,
      ...(s.health.responseMs !== undefined ? { response_ms: s.health.responseMs } : {}),
      ...(type === "frappe.site.unhealthy"
        ? {
            consecutive_failures: s.health.failures,
            ...(s.health.error ? { error: redact(s.health.error) } : {}),
            ...(s.health.status !== undefined ? { status_code: s.health.status } : {}),
          }
        : {}),
    },
  });

  function reconcile(ctx: CapabilityContext, r: Run, bench: BenchState, info: BenchInfo): void {
    const prev = bench.info;
    bench.info = info;
    const present = new Set(info.sites.map((s) => s.name));
    const added = info.sites.filter((s) => !prev?.sites.some((p) => p.name === s.name));
    for (const old of prev?.sites ?? []) {
      if (present.has(old.name)) continue;
      const gone = r.sites.get(siteKey(info.path, old.name));
      r.sites.delete(siteKey(info.path, old.name));
      ctx.emit({
        event_type: "frappe.site.removed",
        severity: "info",
        subject: old.name,
        correlation_id: siteCorrelation(info.path, old.name),
        payload: {
          site: old.name,
          bench: info.path,
          was_unhealthy: gone?.health.unhealthy ?? false,
        },
      });
    }
    for (const site of info.sites) {
      const { url, source } = resolveSiteUrl(site, info, r.overrides);
      const key = siteKey(info.path, site.name);
      const existing = r.sites.get(key);
      r.sites.set(key, {
        bench: info.path,
        name: site.name,
        url,
        urlSource: source,
        apps: info.apps,
        health: existing?.health ?? INITIAL_HEALTH,
      });
    }
    if (!prev || added.length) {
      ctx.emit(
        {
          event_type: "frappe.bench.discovered",
          severity: "info",
          subject: info.path.slice(0, 500),
          payload: {
            bench: info.path,
            name: info.name,
            apps: info.apps,
            sites: info.sites.map((s) => s.name),
            ...(prev ? { added: added.map((s) => s.name) } : {}),
          },
        },
        // The first sync is background for Fawkes; a site that appears later is news.
        { ephemeral: !prev },
      );
    }
  }

  async function pollSite(ctx: CapabilityContext, site: SiteState): Promise<void> {
    const timeoutMs = (ctx.config.timeout_ms as number | undefined) ?? DEFAULT_TIMEOUT_MS;
    const result = await pingSite(site.url, site.name, { timeoutMs, signal: ctx.signal });
    if (ctx.signal.aborted) return;
    const { next, transition } = applyPing(site.health, result, now());
    site.health = next;
    if (transition) ctx.emit(siteEvent(`frappe.site.${transition}`, site));
  }

  interface Discovery {
    bench: BenchState;
    info?: BenchInfo;
    error?: string;
  }

  async function cycle(ctx: CapabilityContext, r: Run): Promise<void> {
    const found = await Promise.all(
      [...r.benches.values()].map(async (bench): Promise<Discovery> => {
        try {
          return { bench, info: await discoverBench(bench.path) };
        } catch (err) {
          return { bench, error: (err as Error).message };
        }
      }),
    );
    if (ctx.signal.aborted) return;
    for (const f of found) {
      if (f.info) {
        delete f.bench.error;
        reconcile(ctx, r, f.bench, f.info);
      } else {
        f.bench.error = f.error;
      }
    }
    // Discovery is done: `sites`/`benches` can answer (unpinged sites read "checking").
    r.finishFirstCycle();
    await mapLimit([...r.sites.values()], MAX_CONCURRENCY, (site) => pollSite(ctx, site));
  }

  async function loop(ctx: CapabilityContext, r: Run): Promise<void> {
    const interval = (ctx.config.poll_ms as number | undefined) ?? DEFAULT_POLL_MS;
    while (!ctx.signal.aborted) {
      try {
        await cycle(ctx, r);
      } catch (err) {
        ctx.logger.warn("frappe polling cycle failed", { error: (err as Error).message });
      }
      r.finishFirstCycle();
      await sleep(interval, ctx.signal);
    }
    r.finishFirstCycle();
  }

  function snapshot() {
    return run
      ? [...run.sites.values()].sort((a, b) =>
          siteKey(a.bench, a.name).localeCompare(siteKey(b.bench, b.name)),
        )
      : [];
  }

  return defineCapability({
    manifest: {
      id: "frappe",
      name: "Frappe / ERPNext",
      version: "0.1.0",
      description: "Watches the health of the sites in your local Frappe benches.",
      license: "GPL-3.0-or-later",
      events: ["frappe.bench.*", "frappe.site.*"],
      permissions: ["filesystem_read", "network"],
      data_categories: ["bench paths", "site names", "installed app names", "site health"],
      healthcheck: { interval_ms: 5_000 },
      commands: [
        {
          name: "sites",
          description: "Health, URL, response time and apps of every discovered site",
          side_effect: "read",
          permissions: ["filesystem_read", "network"],
        },
        {
          name: "benches",
          description: "The selected benches: apps, sites and web server port",
          side_effect: "read",
          permissions: ["filesystem_read"],
        },
      ],
      config_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          benches: {
            type: "array",
            maxItems: 10,
            items: { type: "string", minLength: 1, maxLength: 500 },
            description: "Absolute paths of the Frappe benches to watch",
          },
          sites: {
            type: "object",
            maxProperties: 100,
            additionalProperties: { type: "string", pattern: "^https?://[^\\s]+$", maxLength: 300 },
            description:
              'Per-site URL overrides, e.g. { "erp.localhost": "http://127.0.0.1:8000" }. ' +
              "Only http(s); redirects are not followed.",
          },
          poll_ms: { type: "integer", minimum: 250, maximum: 300_000 },
          timeout_ms: { type: "integer", minimum: 250, maximum: 30_000 },
        },
      },
      state_rules: [
        {
          match: "frappe.site.unhealthy",
          effect: { state: "ERROR", explain: "Site {subject} is unhealthy" },
        },
        { match: "frappe.site.healthy", effect: { clear: true } },
        { match: "frappe.site.removed", effect: { clear: true } },
      ],
    },
    init(ctx) {
      run = undefined;
      const benches = benchList(ctx);
      const relative = benches.filter((p) => !isAbsolute(p));
      if (relative.length) throw new Error(`Bench paths must be absolute: ${relative.join(", ")}`);
      const overrides = siteOverrides(ctx);
      for (const [name, url] of Object.entries(overrides)) {
        if (!SITE_NAME.test(name))
          throw new Error(`Invalid site name in sites: ${name.slice(0, 80)}`);
        if (!normalizeOrigin(url)) throw new Error(`Site URL for ${name} must be an http(s) URL`);
      }
      const firstCycle = Promise.withResolvers<void>();
      const r: Run = {
        benches: new Map(),
        sites: new Map(),
        overrides,
        firstCycle: firstCycle.promise,
        finishFirstCycle: firstCycle.resolve,
      };
      for (const p of benches) r.benches.set(resolve(p), { path: resolve(p) });
      run = r;
      if (r.benches.size === 0) return r.finishFirstCycle();
      void loop(ctx, r);
    },
    commands: {
      async sites(): Promise<{ sites: SiteView[] }> {
        await run?.firstCycle;
        return {
          sites: snapshot().map((s) => ({
            site: s.name,
            bench: s.bench,
            url: s.url,
            url_source: s.urlSource,
            status: !s.health.checked ? "checking" : s.health.unhealthy ? "unhealthy" : "healthy",
            consecutive_failures: s.health.failures,
            ...(s.health.lastCheckedAt ? { last_checked_at: s.health.lastCheckedAt } : {}),
            ...(s.health.lastOkAt ? { last_ok_at: s.health.lastOkAt } : {}),
            ...(s.health.responseMs !== undefined ? { response_ms: s.health.responseMs } : {}),
            ...(s.health.error ? { error: s.health.error } : {}),
            apps: s.apps,
          })),
        };
      },
      async benches() {
        await run?.firstCycle;
        return {
          benches: [...(run?.benches.values() ?? [])].map((b) => ({
            path: b.path,
            ...(b.error ? { error: b.error } : {}),
            ...(b.info
              ? {
                  apps: b.info.apps,
                  sites: b.info.sites.map((s) => s.name),
                  webserver_port: b.info.webserverPort,
                  ...(b.info.defaultSite ? { default_site: b.info.defaultSite } : {}),
                  serve_default_site: b.info.serveDefaultSite,
                }
              : {}),
          })),
        };
      },
    },
    health(): HealthResult {
      if (!run || run.benches.size === 0)
        return { status: "degraded", message: "No benches selected" };
      const benches = [...run.benches.values()];
      const sites = snapshot();
      const broken = benches.filter((b) => b.error);
      if (!sites.length && !broken.length && !benches.some((b) => b.info)) {
        return { status: "healthy", message: "Reading benches…" };
      }
      const down = sites.filter((s) => s.health.unhealthy);
      const problems = [
        ...down.slice(0, 3).map((s) => `${s.name}: ${s.health.error ?? "unhealthy"}`),
        ...broken.slice(0, 2).map((b) => `${basename(b.path)}: ${b.error}`),
      ];
      const summary = `${sites.length - down.length}/${sites.length} sites healthy`;
      const message = problems.length ? `${summary}; ${problems.join("; ")}` : summary;
      const allDown = sites.length > 0 && down.length === sites.length;
      if (allDown || broken.length === benches.length) {
        return { status: "unhealthy", message };
      }
      if (down.length || broken.length || !sites.length) {
        return {
          status: "degraded",
          message: sites.length ? message : `${message}; no sites found`,
        };
      }
      return { status: "healthy", message };
    },
  });
}

export const frappeCapability = createFrappeCapability();
