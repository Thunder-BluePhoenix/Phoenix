// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 93: what the address bar does with typed text, and how a port-radar request is vetted.
// This is feedback for the person typing: the Rust shell decides again on every navigation, so
// nothing here is a security boundary.
import {
  DEFAULT_NAVIGATION_POLICY,
  DEFAULT_SEARCH_TEMPLATE,
  decideNavigation,
  resolveOmnibox,
} from "../core/browser/navigation";

export interface SearchProvider {
  id: string;
  /** The brand name, shown as written. */
  name: string;
  /** `{query}` is replaced with the URL-encoded text. */
  template: string;
}

/** The only provider today. Phoenix's web-search settings are not read: they configure Core's own search tool, not this bar. */
export const DEFAULT_SEARCH_PROVIDER: SearchProvider = {
  id: "duckduckgo",
  name: "DuckDuckGo",
  template: DEFAULT_SEARCH_TEMPLATE,
};

export type AddressVerdict =
  | { kind: "empty" }
  | { kind: "open"; url: string; search: boolean; upgraded: boolean }
  | { kind: "blocked"; reason: string; text: string };

/**
 * Typed text becomes a page, a search or a refusal. Host-like text is `https://host`, anything
 * else a search; the result then passes the same navigation policy the shell enforces, with the
 * intent `typed` and no private-network exception (a loopback page is opened from the port radar).
 */
export function classifyAddress(
  text: string,
  provider: SearchProvider = DEFAULT_SEARCH_PROVIDER,
): AddressVerdict {
  const resolved = resolveOmnibox(text, provider.template);
  if (resolved === null) return { kind: "empty" };
  const decision = decideNavigation(resolved.url, DEFAULT_NAVIGATION_POLICY, "typed");
  if (!decision.allow) return { kind: "blocked", reason: decision.reason, text: text.trim() };
  return {
    kind: "open",
    url: decision.url,
    search: resolved.kind === "search",
    upgraded: decision.upgraded,
  };
}

export type PortRadarVerdict = { ok: true; url: string; port: number } | { ok: false };

/**
 * A request to open a program's page from the port radar. Only `http://127.0.0.1:<port>/` or
 * `http://localhost:<port>/` qualifies (what the radar builds, see `localhostUrl`): any other host,
 * a credential, a bad port or a path outside `/` is ignored. The returned URL is rebuilt from the
 * port number, never copied from the request.
 */
export function classifyPortRadarUrl(input: string): PortRadarVerdict {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false };
  }
  if (url.protocol !== "http:" || url.username !== "" || url.password !== "") return { ok: false };
  const host = url.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost") return { ok: false };
  if (!/^[1-9]\d{0,4}$/.test(url.port)) return { ok: false };
  const port = Number(url.port);
  if (port > 65535) return { ok: false };
  const rebuilt = `http://127.0.0.1:${port}/`;
  const decision = decideNavigation(
    rebuilt,
    {
      ...DEFAULT_NAVIGATION_POLICY,
      privateNetworkAllowedSites: ["127.0.0.1"],
      insecureAllowedSites: ["127.0.0.1"],
    },
    "typed",
  );
  return decision.allow ? { ok: true, url: decision.url, port } : { ok: false };
}
