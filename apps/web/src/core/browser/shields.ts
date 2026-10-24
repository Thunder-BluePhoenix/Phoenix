// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Shields: the user's ad and tracker blocking choices as one pure model. It decides whether a
// request from a page should be blocked (the global switch, the per-site off-list, the sites whose
// own ads must not be blocked, and then the filter lists through RequestBlocker) and counts what it
// blocked. It does nothing by itself: there is no browser window yet, so no request ever reaches it
// in the app. Cosmetic filtering is not modelled (cosmetic rules are counted and ignored).
import {
  DEFAULT_MAX_RULES,
  RequestBlocker,
  STARTER_RULES,
  type BlockMatch,
  type RequestInfo,
} from "./blocklist";
import { hostMatchesSite, hostOf, registrableDomain } from "./site";

export interface ShieldsSettings {
  /** The master switch. */
  enabled: boolean;
  /** Sites (a host and its subdomains) where blocking is off. */
  offSites: readonly string[];
}

export const DEFAULT_SHIELDS_SETTINGS: ShieldsSettings = { enabled: true, offSites: [] };

/** The text of one enabled filter list, as Core stored it. */
export interface ShieldsList {
  id: string;
  text: string;
}

/**
 * What the music connector policy says about a site (capabilities/youtube-music `SitePolicy`, as
 * `GET /api/music/connectors` returns it). Shields reads `adBlocking` and `hosts` from it and
 * keeps no list of its own: YouTube is exempt exactly while its connector is on.
 */
export interface ShieldsMusicSite {
  readonly hosts: readonly string[];
  readonly adBlocking: "normal" | "exempt";
}

export interface ShieldsOptions {
  settings?: ShieldsSettings;
  lists?: readonly ShieldsList[];
  music?: readonly ShieldsMusicSite[];
  /** Cap on rules across all lists (default {@link DEFAULT_MAX_RULES}). */
  maxRules?: number;
}

/** Why blocking was not applied to a page. */
export type ShieldsExemption = "shields_off" | "site_off" | "site_ads_exempt";

export interface ShieldsVerdict extends BlockMatch {
  exempt: ShieldsExemption | null;
}

/** Sites with a count of their own; further sites still add to the total. */
export const MAX_COUNTED_SITES = 2_000;

export class Shields {
  readonly blocker = new RequestBlocker();
  /** Where the rules came from: the downloaded lists, or the small starter set when none is loaded. */
  readonly source: "lists" | "starter";
  readonly #exemptHosts: ReadonlySet<string>;
  #enabled: boolean;
  #off: Set<string>;
  #bySite = new Map<string, number>();
  #total = 0;

  constructor(options: ShieldsOptions = {}) {
    const settings = options.settings ?? DEFAULT_SHIELDS_SETTINGS;
    this.#enabled = settings.enabled;
    this.#off = new Set(settings.offSites.map((site) => site.toLowerCase()));
    const budget = options.maxRules ?? DEFAULT_MAX_RULES;
    for (const list of options.lists ?? []) {
      const room = budget - this.blocker.ruleCount;
      if (room <= 0) break;
      this.blocker.load(list.text, { maxRules: budget });
    }
    this.source = this.blocker.ruleCount > 0 ? "lists" : "starter";
    if (this.source === "starter") this.blocker.load(STARTER_RULES);
    this.#exemptHosts = new Set(
      (options.music ?? []).filter((s) => s.adBlocking === "exempt").flatMap((s) => s.hosts),
    );
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  get offSites(): readonly string[] {
    return [...this.#off].sort();
  }

  /** Network rules in force. */
  get ruleCount(): number {
    return this.blocker.ruleCount;
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
  }

  /** `blocking: false` puts `site` (a host name) on the off-list; `true` takes it off. */
  setSiteBlocking(site: string, blocking: boolean): void {
    const key = site.trim().toLowerCase();
    if (key === "") return;
    if (blocking) this.#off.delete(key);
    else this.#off.add(key);
  }

  /** The site a page counts under, and the off-list entry the UI offers: its registrable domain. */
  siteOf(pageUrl: string): string | null {
    const host = hostOf(pageUrl);
    return host === null ? null : registrableDomain(host);
  }

  exemption(documentHost: string): ShieldsExemption | null {
    const host = documentHost.toLowerCase();
    if (!this.#enabled) return "shields_off";
    // An exact host only: the connector policy never trusts subdomains.
    if (this.#exemptHosts.has(host)) return "site_ads_exempt";
    let best: string | null = null;
    for (const site of this.#off) {
      if (hostMatchesSite(host, site) && (best === null || site.length > best.length)) best = site;
    }
    return best === null ? null : "site_off";
  }

  blockingEnabled(documentHost: string): boolean {
    return this.exemption(documentHost) === null;
  }

  /** Decides one request. Does not count: callers count what they actually blocked (see {@link recordBlocked}). */
  decide(request: RequestInfo): ShieldsVerdict {
    const documentHost = hostOf(request.documentUrl);
    if (documentHost === null) return { blocked: false, rule: null, excepted: false, exempt: null };
    const exempt = this.exemption(documentHost);
    if (exempt !== null) return { blocked: false, rule: null, excepted: false, exempt };
    return { ...this.blocker.match(request), exempt: null };
  }

  /** Counts one blocked request under the page's site. Only the host is kept: never a URL or query. */
  recordBlocked(documentHost: string): void {
    this.#total++;
    const site = registrableDomain(documentHost);
    const known = this.#bySite.get(site);
    if (known !== undefined) this.#bySite.set(site, known + 1);
    else if (this.#bySite.size < MAX_COUNTED_SITES) this.#bySite.set(site, 1);
  }

  blockedOnSite(site: string): number {
    return this.#bySite.get(registrableDomain(site)) ?? 0;
  }

  get blockedTotal(): number {
    return this.#total;
  }

  /** Sites with the most blocked requests, for a summary. Host names and counts only. */
  topSites(limit = 10): { site: string; blocked: number }[] {
    return [...this.#bySite]
      .map(([site, blocked]) => ({ site, blocked }))
      .sort((a, b) => b.blocked - a.blocked || a.site.localeCompare(b.site))
      .slice(0, limit);
  }

  resetCounts(): void {
    this.#bySite.clear();
    this.#total = 0;
  }
}
