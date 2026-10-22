// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/**
 * Two-label public suffixes the registrable-domain heuristic knows about. This is NOT the Public
 * Suffix List: a name under a suffix missing here is treated as one site with its siblings, which
 * under-blocks `$third-party` rules and over-shares between look-alike tenants. The Rust host
 * should use the `publicsuffix` crate for enforcement; this list keeps the TypeScript reference
 * implementation honest for the common cases.
 */
const TWO_LABEL_SUFFIXES: Readonly<Record<string, true>> = Object.fromEntries(
  [
    "co.uk",
    "org.uk",
    "ac.uk",
    "gov.uk",
    "me.uk",
    "com.au",
    "net.au",
    "org.au",
    "co.nz",
    "co.jp",
    "ne.jp",
    "or.jp",
    "co.in",
    "co.kr",
    "co.za",
    "com.br",
    "com.cn",
    "com.mx",
    "com.tr",
    "com.sg",
    "com.hk",
    "com.tw",
    "com.ar",
    // Hosting platforms where every tenant is a separate site.
    "github.io",
    "gitlab.io",
    "vercel.app",
    "netlify.app",
    "pages.dev",
    "workers.dev",
    "herokuapp.com",
    "web.app",
    "firebaseapp.com",
    "blogspot.com",
    "azurewebsites.net",
    "appspot.com",
    "fly.dev",
    "onrender.com",
  ].map((suffix) => [suffix, true] as const),
);

/** Host (no port) of a URL string, lower-cased; `null` when the text is not an absolute URL. */
export function hostOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "" ? null : host;
  } catch {
    return null;
  }
}

/** eTLD+1 for DNS names; IP literals and intranet names are their own site. */
export function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") || /^[\d.]+$/.test(host) || !host.includes(".")) return host;
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join(".");
  return Object.hasOwn(TWO_LABEL_SUFFIXES, lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

/** True when `host` is `site` or one of its subdomains. */
export function hostMatchesSite(host: string, site: string): boolean {
  const h = host.toLowerCase();
  const s = site.toLowerCase();
  return h === s || h.endsWith("." + s);
}

/** A request is third-party when its registrable domain differs from the document's. */
export function isThirdParty(requestHost: string, documentHost: string): boolean {
  return registrableDomain(requestHost) !== registrableDomain(documentHost);
}
