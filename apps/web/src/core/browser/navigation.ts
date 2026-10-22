// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { classifyHost, isBadPort, type PrivateReason } from "./network";
import { hostMatchesSite } from "./site";

export type NavigationDenial =
  | "unparseable"
  | "scheme_not_allowed"
  | "dangerous_scheme"
  | "file_blocked"
  | "credentials_in_url"
  | "private_network"
  | "bad_port"
  | "insecure_blocked"
  | "site_denied";

export type NavigationIntent = "typed" | "link" | "redirect" | "subresource" | "new_window";

export type NavigationDecision =
  | {
      allow: true;
      /** The URL to load. Differs from the input when HTTP was upgraded or the URL was normalized. */
      url: string;
      upgraded: boolean;
    }
  | { allow: false; reason: NavigationDenial; privateReason?: PrivateReason };

export interface NavigationPolicy {
  /** Allowed schemes without the colon. Defaults to https only; http is reachable only through the upgrade. */
  allowedSchemes: readonly string[];
  /** Rewrite http: to https: before loading. A site in `insecureAllowedSites` is exempt. */
  upgradeHttp: boolean;
  /** Sites (and their subdomains) allowed to load over plain http, e.g. a dev server the user chose. */
  insecureAllowedSites: readonly string[];
  /** Sites (and their subdomains) that are never loaded. */
  deniedSites: readonly string[];
  /**
   * Private and local hosts (loopback, RFC 1918, link-local, `.local`, ...). Allowed only for a
   * site the user typed in and listed here; a link or redirect from a public page never gets in.
   */
  privateNetworkAllowedSites: readonly string[];
}

export const DEFAULT_NAVIGATION_POLICY: NavigationPolicy = {
  allowedSchemes: ["https"],
  upgradeHttp: true,
  insecureAllowedSites: [],
  deniedSites: [],
  privateNetworkAllowedSites: [],
};

/** Schemes that execute code or carry the document itself; never navigable, whatever the policy. */
const DANGEROUS_SCHEMES: Readonly<Record<string, true>> = {
  javascript: true,
  data: true,
  blob: true,
  vbscript: true,
  filesystem: true,
  "view-source": true,
  about: true,
  tauri: true,
  ipc: true,
  asset: true,
};

function allowedBySite(host: string, sites: readonly string[]): boolean {
  return sites.some((site) => hostMatchesSite(host, site));
}

/**
 * Decide whether a webview may load `input`. Pure: the same inputs always give the same answer, so
 * the Rust host can call the same rules (or an equivalent port) from `on_navigation`.
 *
 * `intent` matters for one rule only: a private-network URL is reachable by typing it (when the
 * site is listed) but never by a link, redirect, subresource or popup from a page, because a public
 * page pointing at `http://192.168.1.1/` or `http://localhost:4870/` is how a web page attacks the
 * user's own network and Phoenix Core.
 */
export function decideNavigation(
  input: string,
  policy: NavigationPolicy = DEFAULT_NAVIGATION_POLICY,
  intent: NavigationIntent = "link",
): NavigationDecision {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { allow: false, reason: "unparseable" };
  }
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  if (scheme === "file") return { allow: false, reason: "file_blocked" };
  if (Object.hasOwn(DANGEROUS_SCHEMES, scheme)) return { allow: false, reason: "dangerous_scheme" };
  if (scheme !== "http" && scheme !== "https") {
    // A custom scheme the caller vouches for (e.g. an app protocol); it still may not carry credentials.
    if (!policy.allowedSchemes.includes(scheme))
      return { allow: false, reason: "scheme_not_allowed" };
    if (url.username !== "" || url.password !== "") {
      return { allow: false, reason: "credentials_in_url" };
    }
    return { allow: true, url: url.toString(), upgraded: false };
  }
  if (url.username !== "" || url.password !== "") {
    return { allow: false, reason: "credentials_in_url" };
  }
  const host = url.hostname.toLowerCase();
  if (host === "") return { allow: false, reason: "unparseable" };
  if (allowedBySite(host, policy.deniedSites)) return { allow: false, reason: "site_denied" };
  const hostClass = classifyHost(host);
  if (hostClass.kind === "private") {
    const listed = allowedBySite(host, policy.privateNetworkAllowedSites);
    if (intent !== "typed" || !listed) {
      return { allow: false, reason: "private_network", privateReason: hostClass.reason };
    }
  }
  if (url.port !== "" && isBadPort(Number(url.port))) return { allow: false, reason: "bad_port" };
  if (scheme === "https") {
    if (!policy.allowedSchemes.includes("https"))
      return { allow: false, reason: "scheme_not_allowed" };
    return { allow: true, url: url.toString(), upgraded: false };
  }
  // Plain http. A listed dev server or a vetted private-network host has no certificate to upgrade to.
  if (allowedBySite(host, policy.insecureAllowedSites) || hostClass.kind === "private") {
    return { allow: true, url: url.toString(), upgraded: false };
  }
  if (policy.upgradeHttp) {
    if (!policy.allowedSchemes.includes("https"))
      return { allow: false, reason: "scheme_not_allowed" };
    url.protocol = "https:";
    // An explicit :80 would survive as https://host:80; the default port moves with the scheme.
    if (url.port === "80") url.port = "";
    return { allow: true, url: url.toString(), upgraded: true };
  }
  if (policy.allowedSchemes.includes("http"))
    return { allow: true, url: url.toString(), upgraded: false };
  return { allow: false, reason: "insecure_blocked" };
}

export type OmniboxResult =
  { kind: "navigate"; url: string } | { kind: "search"; url: string; query: string };

/** Search provider template; `{query}` is replaced with the URL-encoded text. */
export const DEFAULT_SEARCH_TEMPLATE = "https://duckduckgo.com/?q={query}";

/**
 * Turn address-bar text into something to navigate to. Text that looks like a host becomes
 * `https://host`; anything else is a search query, so a typo never becomes a request to an
 * unintended host. The result still has to pass {@link decideNavigation}.
 */
export function resolveOmnibox(
  text: string,
  searchTemplate: string = DEFAULT_SEARCH_TEMPLATE,
): OmniboxResult | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^[^/\s]+:\d+(\/|$)/.test(trimmed)) {
    return { kind: "navigate", url: trimmed };
  }
  const hostLike =
    !/\s/.test(trimmed) &&
    /^(?:\[[0-9a-f:.]+\]|[^\s/:?#]+\.[^\s/:?#]+|localhost)(?::\d+)?(?:[/?#].*)?$/i.test(trimmed);
  if (hostLike) return { kind: "navigate", url: "https://" + trimmed };
  return {
    kind: "search",
    query: trimmed,
    url: searchTemplate.replace("{query}", encodeURIComponent(trimmed)),
  };
}
