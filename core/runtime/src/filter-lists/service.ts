// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Core's owner of the ad and tracker filter lists (Phase 93). Lists are NOT bundled and NOT
// fetched on their own: a list is downloaded only when the user presses Update for it (one GET to
// the pinned host, see catalogue.ts), is off until the user turns it on, and is kept on this
// computer as one owner-only file. Nothing here schedules a later download: `refreshAfterDays` is
// the list's own advice, shown to the user, never acted on. Core never applies a list to traffic;
// it stores the text and hands it to the web app, whose pure matcher decides. There is no browser
// window yet, so no page is filtered by any of this.
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { AuditLog } from "@phoenix/permissions";
import type { SettingsStore } from "@phoenix/persistence";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import {
  FILTER_LIST_CATALOGUE,
  FILTER_LIST_ORIGIN,
  findFilterList,
  type FilterListSpec,
} from "./catalogue";

export const FILTER_LISTS_ENABLED_KEY = ["browser", "filter-lists", "enabled"].join(".");
export const SHIELDS_KEY = "browser.shields";

/** Largest list kept. EasyList is about 2 MiB, EasyPrivacy about 1.5 MiB. */
export const MAX_LIST_BYTES = 8 * 1024 * 1024;
/** More lines than this is not a filter list Phoenix knows (EasyList has about 86,000). */
export const MAX_LIST_LINES = 500_000;
/** A longer line is a sign of a corrupt or hostile file (the longest real line is about 6.5 KiB). */
export const MAX_LINE_CHARS = 16 * 1024;
/** An update smaller than this share of the copy it would replace is refused as a possible truncation. */
export const MIN_SIZE_RATIO = 0.5;
export const HEADERS_TIMEOUT_MS = 15_000;
export const BODY_TIMEOUT_MS = 30_000;
export const MIN_REFRESH_DAYS = 1;
export const MAX_REFRESH_DAYS = 30;
const DEFAULT_REFRESH_DAYS = 4;
export const MAX_OFF_SITES = 500;

/** Why an update was refused. A closed set: it is shown to the user and written to the audit log. */
export type RefusalReason =
  | "kill_switch"
  | "request_failed"
  | "timeout"
  | "redirect"
  | "status"
  | "not_text"
  | "not_a_filter_list"
  | "too_large"
  | "too_many_lines"
  | "line_too_long"
  | "invalid_encoding"
  | "truncated";

const REFUSAL_TEXT: Readonly<Record<RefusalReason, string>> = {
  kill_switch: "Emergency stop is engaged; nothing was downloaded",
  request_failed: "the list server could not be reached",
  timeout: "the list server was too slow",
  redirect: "the list server tried to send Phoenix somewhere else, which Phoenix refuses",
  status: "the list server did not answer with the list",
  not_text: "the answer was not plain text",
  not_a_filter_list: "the answer was not a filter list",
  too_large: "the list is larger than Phoenix accepts",
  too_many_lines: "the list has more lines than Phoenix accepts",
  line_too_long: "the list has a line longer than Phoenix accepts",
  invalid_encoding: "the list is not valid UTF-8 text",
  truncated:
    "the new list is less than half the size of the one already stored, which looks like a cut-off or tampered download",
};

/** Refusals that are about the content (the policy said no) rather than about reaching the server. */
const CONTENT_REFUSALS: ReadonlySet<RefusalReason> = new Set([
  "kill_switch",
  "redirect",
  "not_text",
  "not_a_filter_list",
  "too_large",
  "too_many_lines",
  "line_too_long",
  "invalid_encoding",
  "truncated",
]);

class Refusal extends Error {
  constructor(
    readonly reason: RefusalReason,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(REFUSAL_TEXT[reason]);
  }
}

export interface FilterListRuleCounts {
  /** Lines that are network rules (including exceptions). The browser's matcher may drop some it cannot model. */
  network: number;
  exceptions: number;
  /** Element-hiding and scriptlet lines: counted, never applied. */
  cosmetic: number;
}

export interface FilterListMeta {
  id: string;
  sha256: string;
  bytes: number;
  fetchedAt: string;
  version: string | null;
  title: string | null;
  lastModified: string | null;
  /** The list's own `! Expires`, bounded to 1..30 days. Advice only: nothing refreshes by itself. */
  refreshAfterDays: number;
  rules: FilterListRuleCounts;
}

export interface FilterListView {
  id: string;
  title: string;
  purpose: FilterListSpec["purpose"];
  homepage: string;
  /** The exact address an update contacts. */
  source: string;
  licence: string;
  licenceUrl: string;
  attribution: string;
  enabled: boolean;
  status: "never" | "ready" | "damaged";
  fetchedAt: string | null;
  bytes: number | null;
  sha256: string | null;
  version: string | null;
  /** The `! Title` the list gave itself (header text only). */
  listTitle: string | null;
  lastModified: string | null;
  refreshAfterDays: number | null;
  /** When the list's own advice says to look again; `null` when never downloaded. */
  dueAt: string | null;
  rules: FilterListRuleCounts | null;
}

export interface ShieldsSettings {
  /** The master switch. On by default: the starter rules need no download. */
  enabled: boolean;
  /** Sites (a host and its subdomains) where the user turned blocking off. */
  offSites: string[];
}

export interface FilterListsTuning {
  /** Replaces the pinned origin. Code only (tests use a loopback fake server); no setting or request reaches it. */
  baseUrl?: string;
  fetcher?: typeof fetch;
  headersTimeoutMs?: number;
  bodyTimeoutMs?: number;
  now?: () => number;
}

export interface FilterListsDependencies extends FilterListsTuning {
  settings: SettingsStore;
  audit: Pick<AuditLog, "record">;
  dataDir: string;
  killSwitchEngaged: () => boolean;
}

const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])$/;

/** https anywhere, or http to loopback; no credentials, query or fragment. Throws otherwise. */
function checkedOrigin(value: string): string {
  if (!URL.canParse(value)) throw new TypeError("filter list baseUrl is not a URL");
  const url = new URL(value);
  const ok =
    (url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.test(url.hostname))) &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash;
  if (!ok) throw new TypeError("filter list baseUrl must be https, or http to loopback");
  return value.replace(/\/+$/, "");
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const COSMETIC = /#[@?$%]?#|#@?\$#|\$\$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const FIRST_LINE =
  /^(\[adblock[^\]\n]{0,40}\]|!\s*(title|version|last modified|expires|homepage)\b)/i;
const HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

function sanitizeField(value: string): string {
  return value
    .replace(/[^\p{L}\p{N} .:,+()_-]/gu, "")
    .trim()
    .slice(0, 80);
}

export interface ListHeaderFields {
  version: string | null;
  title: string | null;
  lastModified: string | null;
  /** From `! Expires`, bounded to 1..30 days; 4 when the header has none. */
  refreshAfterDays: number;
}

/** The text a user will read in the UI: the list's own header fields, never anything else of the body. */
function headerFields(lines: readonly string[]): ListHeaderFields {
  const out: ListHeaderFields = {
    version: null,
    title: null,
    lastModified: null,
    refreshAfterDays: DEFAULT_REFRESH_DAYS,
  };
  for (const line of lines.slice(0, 200)) {
    if (!line.startsWith("!")) continue;
    const m = /^!\s*(version|title|last modified|expires)\s*:\s*(.+)$/i.exec(line);
    if (!m) continue;
    const name = (m[1] as string).toLowerCase();
    const value = sanitizeField(m[2] as string);
    if (value === "") continue;
    if (name === "version") out.version = value;
    else if (name === "title") out.title = value;
    else if (name === "last modified") out.lastModified = value;
    else {
      const amount = /^(\d{1,4})\s*(day|hour)s?\b/i.exec(value);
      if (amount) {
        const days =
          (amount[2] as string).toLowerCase() === "day"
            ? Number(amount[1])
            : Number(amount[1]) / 24;
        out.refreshAfterDays = Math.min(
          MAX_REFRESH_DAYS,
          Math.max(MIN_REFRESH_DAYS, Math.ceil(days)),
        );
      }
    }
  }
  return out;
}

function countRules(lines: readonly string[]): FilterListRuleCounts {
  const counts = { network: 0, exceptions: 0, cosmetic: 0 };
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "" || line.startsWith("!") || /^\[.*\]$/.test(line)) continue;
    if (COSMETIC.test(line)) counts.cosmetic++;
    else {
      counts.network++;
      if (line.startsWith("@@")) counts.exceptions++;
    }
  }
  return counts;
}

interface Checked {
  text: string;
  bytes: number;
  sha256: string;
  fields: ListHeaderFields;
  rules: FilterListRuleCounts;
}

/** Everything the downloaded bytes must satisfy before they are stored. Pure: no I/O. */
export function checkListBytes(bytes: Uint8Array): Checked {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Refusal("invalid_encoding");
  }
  const text = decoded
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL, "");
  const lines = text.split("\n");
  if (lines.length > MAX_LIST_LINES) throw new Refusal("too_many_lines", { lines: lines.length });
  for (const line of lines) if (line.length > MAX_LINE_CHARS) throw new Refusal("line_too_long");
  const first = lines.find((line) => line.trim() !== "");
  if (first === undefined || !FIRST_LINE.test(first.trim())) throw new Refusal("not_a_filter_list");
  const body = Buffer.from(text, "utf8");
  return {
    text,
    bytes: body.length,
    sha256: createHash("sha256").update(body).digest("hex"),
    fields: headerFields(lines),
    rules: countRules(lines),
  };
}

function isCounts(value: unknown): value is FilterListRuleCounts {
  return (
    isObject(value) &&
    ["network", "exceptions", "cosmetic"].every(
      (k) =>
        typeof value[k] === "number" && Number.isInteger(value[k]) && (value[k] as number) >= 0,
    )
  );
}

function asMeta(raw: unknown, id: string): FilterListMeta | null {
  if (!isObject(raw) || raw.id !== id) return null;
  const nullableString = (v: unknown) => v === null || typeof v === "string";
  if (typeof raw.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(raw.sha256)) return null;
  if (typeof raw.bytes !== "number" || !Number.isInteger(raw.bytes) || raw.bytes < 0) return null;
  if (typeof raw.fetchedAt !== "string" || Number.isNaN(Date.parse(raw.fetchedAt))) return null;
  if (
    !nullableString(raw.version) ||
    !nullableString(raw.title) ||
    !nullableString(raw.lastModified)
  )
    return null;
  if (
    typeof raw.refreshAfterDays !== "number" ||
    raw.refreshAfterDays < MIN_REFRESH_DAYS ||
    raw.refreshAfterDays > MAX_REFRESH_DAYS
  )
    return null;
  if (!isCounts(raw.rules)) return null;
  return {
    id,
    sha256: raw.sha256,
    bytes: raw.bytes,
    fetchedAt: raw.fetchedAt,
    version: raw.version as string | null,
    title: raw.title as string | null,
    lastModified: raw.lastModified as string | null,
    refreshAfterDays: raw.refreshAfterDays,
    rules: raw.rules,
  };
}

type Stored =
  | { state: "never" }
  | { state: "damaged" }
  | { state: "ready"; meta: FilterListMeta; text: string };

export class FilterListsService {
  readonly #origin: string;
  readonly #fetcher: typeof fetch;
  readonly #now: () => number;
  readonly #headersMs: number;
  readonly #bodyMs: number;
  readonly #dir: string;
  readonly #inFlight = new Set<string>();

  constructor(private readonly d: FilterListsDependencies) {
    this.#origin = checkedOrigin(d.baseUrl ?? FILTER_LIST_ORIGIN);
    this.#fetcher = d.fetcher ?? fetch;
    this.#now = d.now ?? Date.now;
    this.#headersMs = d.headersTimeoutMs ?? HEADERS_TIMEOUT_MS;
    this.#bodyMs = d.bodyTimeoutMs ?? BODY_TIMEOUT_MS;
    this.#dir = join(d.dataDir, "filter-lists");
  }

  // ---- lists ---------------------------------------------------------------------------------

  lists(): FilterListView[] {
    const enabled = this.#enabledIds();
    return FILTER_LIST_CATALOGUE.map((spec) => this.#view(spec, enabled));
  }

  /** How many lists have a stored copy (the privacy inventory row). */
  storedCount(): number {
    return FILTER_LIST_CATALOGUE.filter((spec) => this.#read(spec.id).state !== "never").length;
  }

  setEnabled(id: string, input: unknown): FilterListView[] {
    const spec = this.#spec(id);
    const enabled = isObject(input) && Object.keys(input).length === 1 ? input.enabled : undefined;
    if (typeof enabled !== "boolean")
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, 'Expected only a boolean "enabled"');
    if (enabled && this.#read(spec.id).state !== "ready")
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Download this list before turning it on");
    const ids = new Set(this.#enabledIds());
    if (enabled) ids.add(spec.id);
    else ids.delete(spec.id);
    this.d.settings.set(
      FILTER_LISTS_ENABLED_KEY,
      FILTER_LIST_CATALOGUE.filter((s) => ids.has(s.id)).map((s) => s.id),
    );
    this.d.audit.record({
      actor: "user",
      action: "browser.filter_list.changed",
      decision: "info",
      details: { list: spec.id, enabled },
    });
    return this.lists();
  }

  /** The stored text for the web app's matcher. Only a verified copy is ever returned. */
  text(id: string): { id: string; sha256: string; bytes: number; text: string } {
    const spec = this.#spec(id);
    const stored = this.#read(spec.id);
    if (stored.state !== "ready")
      throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "This list has not been downloaded");
    return {
      id: spec.id,
      sha256: stored.meta.sha256,
      bytes: stored.meta.bytes,
      text: stored.text,
    };
  }

  /** Deletes the stored copy and turns the list off. */
  remove(id: string): FilterListView[] {
    const spec = this.#spec(id);
    rmSync(this.#file(spec.id), { force: true });
    const ids = this.#enabledIds().filter((enabled) => enabled !== spec.id);
    this.d.settings.set(FILTER_LISTS_ENABLED_KEY, ids);
    this.d.audit.record({
      actor: "user",
      action: "browser.filter_list.removed",
      decision: "info",
      details: { list: spec.id },
    });
    return this.lists();
  }

  /**
   * Downloads one list, on the user's request. One GET to the pinned address, no redirects, no
   * cookies, a short header timeout and a longer body timeout, a size cap, and a content check; the
   * copy already stored is replaced only by a complete, valid list that is not suspiciously small.
   * Every attempt is audited with its outcome and sizes, never with any of the response text.
   */
  async update(id: string): Promise<FilterListView> {
    const spec = this.#spec(id);
    if (this.#inFlight.has(spec.id))
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, "This list is already being updated");
    this.#inFlight.add(spec.id);
    const previous = this.#read(spec.id);
    try {
      if (this.d.killSwitchEngaged()) throw new Refusal("kill_switch");
      const bytes = await this.#download(spec);
      const checked = checkListBytes(bytes);
      if (previous.state === "ready" && checked.bytes < previous.meta.bytes * MIN_SIZE_RATIO)
        throw new Refusal("truncated", {
          previousBytes: previous.meta.bytes,
          bytes: checked.bytes,
        });
      const meta: FilterListMeta = {
        id: spec.id,
        sha256: checked.sha256,
        bytes: checked.bytes,
        fetchedAt: new Date(this.#now()).toISOString(),
        version: checked.fields.version,
        title: checked.fields.title,
        lastModified: checked.fields.lastModified,
        refreshAfterDays: checked.fields.refreshAfterDays,
        rules: checked.rules,
      };
      this.#store(spec.id, meta, checked.text);
      this.d.audit.record({
        actor: "user",
        action: "browser.filter_list.update",
        decision: "allowed",
        details: {
          list: spec.id,
          outcome: "stored",
          bytes: meta.bytes,
          sha256: meta.sha256,
          networkRules: meta.rules.network,
          replaced: previous.state === "ready",
        },
      });
      return this.#view(spec, this.#enabledIds());
    } catch (error) {
      if (error instanceof Refusal) {
        this.d.audit.record({
          actor: "user",
          action: "browser.filter_list.update",
          decision: CONTENT_REFUSALS.has(error.reason) ? "blocked" : "info",
          details: {
            list: spec.id,
            outcome: "refused",
            reason: error.reason,
            keptPrevious: previous.state === "ready",
            ...error.extra,
          },
        });
        const kept = previous.state === "ready" ? "; the copy you already have was kept" : "";
        throw new PhoenixError(
          CONTENT_REFUSALS.has(error.reason)
            ? ErrorCode.SECURITY_POLICY_BLOCKED
            : ErrorCode.CAPABILITY_UNAVAILABLE,
          `${spec.title} was not updated: ${error.message}${kept}`,
        );
      }
      // A local failure (the disk): report it without detail that could carry a path.
      this.d.audit.record({
        actor: "user",
        action: "browser.filter_list.update",
        decision: "info",
        details: { list: spec.id, outcome: "failed", reason: "store_failed" },
      });
      throw new PhoenixError(
        ErrorCode.INTERNAL_ERROR,
        `${spec.title} was downloaded but could not be saved on this computer`,
      );
    } finally {
      this.#inFlight.delete(spec.id);
    }
  }

  // ---- shields -------------------------------------------------------------------------------

  shields(): ShieldsSettings {
    const raw = this.d.settings.get<unknown>(SHIELDS_KEY, null);
    const stored = isObject(raw) ? raw : {};
    const sites = Array.isArray(stored.offSites)
      ? stored.offSites.filter(
          (site): site is string => typeof site === "string" && this.#validSite(site) !== null,
        )
      : [];
    return {
      enabled: typeof stored.enabled === "boolean" ? stored.enabled : true,
      offSites: [...new Set(sites)].sort().slice(0, MAX_OFF_SITES),
    };
  }

  setShieldsEnabled(input: unknown): ShieldsSettings {
    const enabled = isObject(input) && Object.keys(input).length === 1 ? input.enabled : undefined;
    if (typeof enabled !== "boolean")
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, 'Expected only a boolean "enabled"');
    const next = { ...this.shields(), enabled };
    this.d.settings.set(SHIELDS_KEY, next);
    this.d.audit.record({
      actor: "user",
      action: "browser.shields.changed",
      decision: "info",
      details: { enabled },
    });
    return next;
  }

  /** `blocking: false` puts a site on the off list, `true` takes it off. Host names only, never URLs. */
  setSiteBlocking(site: string, input: unknown): ShieldsSettings {
    const host = this.#validSite(site);
    if (host === null)
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        "Give a site name such as example.com, without https:// or a path",
      );
    const blocking =
      isObject(input) && Object.keys(input).length === 1 ? input.blocking : undefined;
    if (typeof blocking !== "boolean")
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, 'Expected only a boolean "blocking"');
    const current = this.shields();
    const sites = new Set(current.offSites);
    if (blocking) sites.delete(host);
    else {
      if (!sites.has(host) && sites.size >= MAX_OFF_SITES)
        throw new PhoenixError(
          ErrorCode.INVALID_REQUEST,
          `At most ${MAX_OFF_SITES} sites can have blocking turned off`,
        );
      sites.add(host);
    }
    const next = { enabled: current.enabled, offSites: [...sites].sort() };
    this.d.settings.set(SHIELDS_KEY, next);
    this.d.audit.record({
      actor: "user",
      action: "browser.shields.changed",
      decision: "info",
      details: { site: host, blocking },
    });
    return next;
  }

  // ---- internals -----------------------------------------------------------------------------

  #validSite(value: string): string | null {
    const host = value.trim().toLowerCase().replace(/\.$/, "");
    return host.length > 0 && host.length <= 253 && HOST.test(host) ? host : null;
  }

  #spec(id: string): FilterListSpec {
    const spec = findFilterList(id);
    if (!spec) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Unknown filter list");
    return spec;
  }

  #enabledIds(): string[] {
    const stored = this.d.settings.get<unknown>(FILTER_LISTS_ENABLED_KEY, []);
    const known = new Set(FILTER_LIST_CATALOGUE.map((s) => s.id));
    return Array.isArray(stored)
      ? stored.filter((id): id is string => typeof id === "string" && known.has(id))
      : [];
  }

  #file(id: string): string {
    return join(this.#dir, `${id}.filterlist`);
  }

  #view(spec: FilterListSpec, enabledIds: readonly string[]): FilterListView {
    const stored = this.#read(spec.id);
    const meta = stored.state === "ready" ? stored.meta : null;
    return {
      id: spec.id,
      title: spec.title,
      purpose: spec.purpose,
      homepage: spec.homepage,
      source: this.#origin + spec.path,
      licence: spec.licence,
      licenceUrl: spec.licenceUrl,
      attribution: spec.attribution,
      // A list that cannot be read is never on.
      enabled: meta !== null && enabledIds.includes(spec.id),
      status: stored.state,
      fetchedAt: meta?.fetchedAt ?? null,
      bytes: meta?.bytes ?? null,
      sha256: meta?.sha256 ?? null,
      version: meta?.version ?? null,
      listTitle: meta?.title ?? null,
      lastModified: meta?.lastModified ?? null,
      refreshAfterDays: meta?.refreshAfterDays ?? null,
      dueAt: meta
        ? new Date(Date.parse(meta.fetchedAt) + meta.refreshAfterDays * 86_400_000).toISOString()
        : null,
      rules: meta?.rules ?? null,
    };
  }

  /** The stored file: one JSON header line, then the list. Anything that does not verify is "damaged". */
  #read(id: string): Stored {
    const path = this.#file(id);
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      return { state: "never" };
    }
    if (size > MAX_LIST_BYTES + 4096) return { state: "damaged" };
    try {
      const raw = readFileSync(path);
      const newline = raw.indexOf(10);
      if (newline < 0) return { state: "damaged" };
      const meta = asMeta(JSON.parse(raw.subarray(0, newline).toString("utf8")), id);
      if (meta === null) return { state: "damaged" };
      const body = raw.subarray(newline + 1);
      if (
        body.length !== meta.bytes ||
        createHash("sha256").update(body).digest("hex") !== meta.sha256
      )
        return { state: "damaged" };
      return { state: "ready", meta, text: body.toString("utf8") };
    } catch {
      return { state: "damaged" };
    }
  }

  /** Temp file in the same directory (0600), then rename over the old copy: a reader sees one whole file. */
  #store(id: string, meta: FilterListMeta, text: string): void {
    mkdirSync(this.#dir, { recursive: true, mode: 0o700 });
    chmodSync(this.#dir, 0o700);
    const path = this.#file(id);
    const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      writeFileSync(temp, `${JSON.stringify(meta)}\n${text}`, { mode: 0o600, flag: "wx" });
      chmodSync(temp, 0o600);
      renameSync(temp, path);
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
  }

  async #download(spec: FilterListSpec): Promise<Uint8Array> {
    const controller = new AbortController();
    let timer = setTimeout(() => controller.abort(), this.#headersMs);
    try {
      let response: Response;
      try {
        response = await this.#fetcher(this.#origin + spec.path, {
          method: "GET",
          redirect: "manual",
          credentials: "omit",
          headers: { accept: "text/plain" },
          signal: controller.signal,
        });
      } catch {
        throw new Refusal(controller.signal.aborted ? "timeout" : "request_failed");
      }
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), this.#bodyMs);
      if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
        await response.body?.cancel().catch(() => undefined);
        throw new Refusal("redirect", { status: response.status });
      }
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => undefined);
        throw new Refusal("status", { status: response.status });
      }
      const type = (response.headers.get("content-type") ?? "").toLowerCase();
      if (!type.startsWith("text/plain")) {
        await response.body?.cancel().catch(() => undefined);
        throw new Refusal("not_text");
      }
      if (Number(response.headers.get("content-length") ?? 0) > MAX_LIST_BYTES) {
        await response.body?.cancel().catch(() => undefined);
        throw new Refusal("too_large");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Refusal("request_failed");
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > MAX_LIST_BYTES) {
            await reader.cancel().catch(() => undefined);
            throw new Refusal("too_large");
          }
          chunks.push(value);
        }
      } catch (error) {
        if (error instanceof Refusal) throw error;
        throw new Refusal(controller.signal.aborted ? "timeout" : "request_failed");
      }
      return Buffer.concat(chunks, total);
    } finally {
      clearTimeout(timer);
    }
  }
}
