// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { RequestBlocker, type BlockMatch, type RequestInfo } from "./blocklist";
import {
  DEFAULT_NAVIGATION_POLICY,
  decideNavigation,
  type NavigationDecision,
  type NavigationIntent,
  type NavigationPolicy,
} from "./navigation";
import { SitePermissions, type PermissionDecision, type PermissionRequest } from "./permissions";
import { PRIVATE_PROFILE, type BrowserProfile } from "./profile";
import { hostMatchesSite, hostOf } from "./site";
import type { Shields, ShieldsExemption } from "./shields";

/** One line for the audit log. It carries the host, never the path or query (they can hold tokens). */
export type BrowserAuditEvent =
  | { type: "navigation"; tab: string; host: string | null; allowed: boolean; reason: string }
  | { type: "request_blocked"; tab: string; host: string; rule: string }
  | {
      type: "permission";
      tab: string;
      origin: string;
      kind: string;
      verdict: string;
      reason: string;
    };

export interface BrowserAuditSink {
  record(event: BrowserAuditEvent): void;
}

export interface BrowserGuardOptions {
  profile?: BrowserProfile;
  navigation?: Partial<NavigationPolicy>;
  blocker?: RequestBlocker;
  /**
   * The user's shields (global switch, per-site off-list, connector exemptions, filter lists). When
   * given, they decide every request and `blocker`, the per-site toggle and the profile's
   * `blockingExemptSites` are not consulted: the YouTube exemption then comes from the music
   * connector policy alone, and shields keep the counts per site.
   */
  shields?: Shields;
  audit?: BrowserAuditSink;
}

export interface RequestVerdict extends BlockMatch {
  /** Why blocking was not applied, when a matching rule did not block. */
  exempt: "site_toggle" | "profile_default" | ShieldsExemption | null;
}

/**
 * The decisions one browser window needs, in one place: may this tab go to that URL, should this
 * subresource load, and may this page use that capability. Tab ids are opaque strings from the
 * host. The guard keeps counts and grants in memory only.
 */
export class BrowserGuard {
  readonly profile: BrowserProfile;
  readonly permissions = new SitePermissions();
  #policy: NavigationPolicy;
  #blocker: RequestBlocker;
  #shields: Shields | undefined;
  #audit: BrowserAuditSink | undefined;
  /** Sites where the user switched blocking on (true) or off (false), overriding the profile default. */
  #siteToggle = new Map<string, boolean>();
  #blocked = new Map<string, number>();

  constructor(options: BrowserGuardOptions = {}) {
    this.profile = options.profile ?? PRIVATE_PROFILE;
    this.#policy = { ...DEFAULT_NAVIGATION_POLICY, ...options.navigation };
    this.#blocker = options.blocker ?? new RequestBlocker();
    this.#shields = options.shields;
    this.#audit = options.audit;
  }

  navigate(tab: string, url: string, intent: NavigationIntent): NavigationDecision {
    const decision = decideNavigation(url, this.#policy, intent);
    // A new top-level document starts a new count; a subresource redirect does not.
    if (decision.allow && (intent === "typed" || intent === "link")) this.#blocked.set(tab, 0);
    this.#audit?.record({
      type: "navigation",
      tab,
      host: hostOf(url),
      allowed: decision.allow,
      reason: decision.allow ? (decision.upgraded ? "https_upgrade" : "allowed") : decision.reason,
    });
    return decision;
  }

  /** Whether list-based blocking is on for pages of `documentHost`. */
  blockingEnabled(documentHost: string): boolean {
    if (this.#shields) return this.#shields.blockingEnabled(documentHost);
    const host = documentHost.toLowerCase();
    // The most specific toggle wins, so "off for example.com" can be undone for "ads.example.com".
    let best: { site: string; on: boolean } | null = null;
    for (const [site, on] of this.#siteToggle) {
      if (hostMatchesSite(host, site) && (best === null || site.length > best.site.length)) {
        best = { site, on };
      }
    }
    if (best !== null) return best.on;
    return !this.profile.blockingExemptSites.some((site) => hostMatchesSite(host, site));
  }

  setSiteBlocking(site: string, enabled: boolean): void {
    this.#siteToggle.set(site.toLowerCase(), enabled);
  }

  request(tab: string, request: RequestInfo): RequestVerdict {
    const documentHost = hostOf(request.documentUrl);
    if (documentHost === null) return { blocked: false, rule: null, excepted: false, exempt: null };
    if (!this.#shields && !this.blockingEnabled(documentHost)) {
      const toggled = [...this.#siteToggle.keys()].some((site) =>
        hostMatchesSite(documentHost, site),
      );
      return {
        blocked: false,
        rule: null,
        excepted: false,
        exempt: toggled ? "site_toggle" : "profile_default",
      };
    }
    if (this.#shields) {
      const verdict = this.#shields.decide(request);
      if (verdict.blocked) this.#countBlocked(tab, request, verdict, documentHost);
      return verdict;
    }
    const match = this.#blocker.match(request);
    if (match.blocked) this.#countBlocked(tab, request, match, documentHost);
    return { ...match, exempt: null };
  }

  #countBlocked(tab: string, request: RequestInfo, match: BlockMatch, documentHost: string): void {
    this.#blocked.set(tab, (this.#blocked.get(tab) ?? 0) + 1);
    this.#shields?.recordBlocked(documentHost);
    this.#audit?.record({
      type: "request_blocked",
      tab,
      host: hostOf(request.url) ?? "",
      rule: match.rule ?? "",
    });
  }

  blockedCount(tab: string): number {
    return this.#blocked.get(tab) ?? 0;
  }

  permission(tab: string, request: PermissionRequest): PermissionDecision {
    const decision = this.permissions.decide(request);
    this.#audit?.record({
      type: "permission",
      tab,
      origin: request.topOrigin,
      kind: request.kind,
      verdict: decision.verdict,
      reason: decision.reason,
    });
    return decision;
  }

  closeTab(tab: string): void {
    this.#blocked.delete(tab);
  }

  /** Closing the window: forget counts, grants and per-site toggles. */
  end(): void {
    this.#blocked.clear();
    this.#siteToggle.clear();
    this.permissions.clear();
  }
}
