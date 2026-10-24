// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The provider seam. A provider says WHERE (a host fixed in code, or for SearXNG the one address the
// owner set in `searxng_url`; never a response field or a result link), HOW to ask (a GET path built
// from the already-checked query) and how to read the answer into raw `{ title, url, snippet }`
// entries that `results.ts` then cleans. It never sees a key: only a provider that declares `key`
// is sent one, by the capability, as a header, only to its own `host`.
//
// Three providers are built, tried in this order (see index.ts):
//   * SearXNG: keyless, a metasearch engine the owner runs or trusts. Documented `GET /search?q=…&
//     format=json` and `results[].title|url|content`. A public instance answers 403 when its owner has
//     not enabled `json` under `search.formats`.
//   * Brave Search: has NO keyless endpoint; its documented web search (GET /res/v1/web/search,
//     `X-Subscription-Token` header) needs a subscription token the owner supplies as a write-only
//     secret. Shape `web.results[].title|url|description`.
//   * DuckDuckGo Instant Answer API: keyless and pinned, but NOT a ranked web search: it returns
//     topic and entity summaries (`Abstract…`, `RelatedTopics[]`) and nothing for most queries.
// The SearXNG and Brave shapes were written from public documentation and never confirmed against a
// live service. The DuckDuckGo shape was observed once in a manual single-request probe (not a test).
import { expectObject, isObject, safeBaseUrl } from "@phoenix/service-kit";

export interface RawHit {
  title: unknown;
  url: unknown;
  snippet: unknown;
}

export interface SearchProvider {
  id: string;
  /** Shown in the approval text and the docs. */
  label: string;
  /** The only origin a request (and a key, if any) is ever sent to. Https, or loopback for SearXNG. */
  host: string;
  /** Present only for a provider that needs the owner's key; no other provider is ever sent it. */
  key?: {
    /** Name of the write-only capability secret holding the owner's key. */
    secretName: string;
    /** Header that carries the key. */
    header: string;
  };
  /** GET path (and query string) for an already-cleaned query. */
  path(query: string, limit: number): string;
  /** Raw result entries from the parsed JSON body; throws when the body is not the expected shape. */
  parse(body: unknown): RawHit[];
  /** A fixed sentence returned beside the results, given how many were found. */
  note?(found: number): string;
}

/** Entries taken from a provider's body at most, so a huge answer cannot cost unbounded work. */
const MAX_RAW_ENTRIES = 100;

export const BRAVE: SearchProvider = {
  id: "brave",
  label: "Brave Search",
  host: "https://api.search.brave.com",
  key: { secretName: "api_key", header: ["x", "subscription", "token"].join("-") },
  path: (query, limit) =>
    `/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}&safesearch=moderate&text_decorations=false`,
  parse(body) {
    const root = expectObject(body);
    // No `web` section means the provider found no web results.
    if (root.web === undefined) return [];
    const results = expectObject(root.web).results;
    if (results === undefined) return [];
    if (!Array.isArray(results)) throw new TypeError("expected an array");
    return results
      .slice(0, MAX_RAW_ENTRIES)
      .filter(isObject)
      .map((r) => ({ title: r.title, url: r.url, snippet: r.description }));
  },
};

/**
 * A related topic `{ Text, FirstURL }`. The title is the text before the first " - " when there is
 * one, otherwise the whole text (clipped later); the snippet is the whole text. How DuckDuckGo joins
 * a topic's name and summary was not confirmed beyond the one probe, so no split is relied on.
 */
function topic(entry: Record<string, unknown>): RawHit {
  const text = entry.Text;
  const head = typeof text === "string" ? text.split(" - ", 1)[0] : undefined;
  return { title: head ? head : text, url: entry.FirstURL, snippet: text };
}

export const DUCKDUCKGO: SearchProvider = {
  id: "duckduckgo",
  label: "DuckDuckGo",
  host: "https://api.duckduckgo.com",
  path: (query) =>
    `/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&no_redirect=1`,
  parse(body) {
    const root = expectObject(body);
    const hits: RawHit[] = [];
    if (typeof root.AbstractText === "string" && root.AbstractText !== "") {
      hits.push({ title: root.Heading, url: root.AbstractURL, snippet: root.AbstractText });
    }
    // A related topic is `{ FirstURL, Text, Result, Icon }`; it may also be a group
    // `{ Name, Topics: [...] }` (documented, not seen in the one live probe). Only `Text` and
    // `FirstURL` are read: the `Result` HTML string and the icon are never used.
    const related = root.RelatedTopics;
    if (related === undefined) return hits;
    if (!Array.isArray(related)) throw new TypeError("expected an array");
    for (const item of related.slice(0, MAX_RAW_ENTRIES)) {
      if (!isObject(item)) continue;
      if (Array.isArray(item.Topics)) {
        for (const inner of item.Topics.slice(0, MAX_RAW_ENTRIES)) {
          if (isObject(inner)) hits.push(topic(inner));
        }
      } else {
        hits.push(topic(item));
      }
    }
    return hits;
  },
  note: (found) =>
    found === 0
      ? "DuckDuckGo had no topic summary for this query. Its Instant Answer service is not a web search, so an empty answer does not mean the web has nothing."
      : "DuckDuckGo's Instant Answer service returns topic and entity summaries, not ranked web results.",
};

/**
 * The `searxng_url` pattern, also the config schema's `pattern`, so the setting is refused when it is
 * saved. https to an ASCII host, or http only to this computer (127.0.0.1, localhost, [::1]); an
 * optional port (1 to 65535); a path that is nothing or plain prefix segments (`/searx`). No user name, password,
 * query, fragment, backslash, percent escape, `.` or `..` segment, or non-ASCII host (a look-alike
 * name must be written as its ASCII punycode form).
 */
export const SEARXNG_URL_PATTERN = String.raw`^(?!.*\.\.)(?!.*/\.(/|$))(https://[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|http://(127\.0\.0\.1|localhost|\[::1\]))(:(6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[1-9][0-9]{0,3}))?(/[A-Za-z0-9._~-]+)*/?$`;
const SEARXNG_URL = new RegExp(SEARXNG_URL_PATTERN, "u");

/**
 * The checked base address of the owner's SearXNG instance, without a trailing slash, or undefined.
 * Run both when the capability is enabled and again on every search.
 */
export function searxngBase(value: unknown): string | undefined {
  if (typeof value !== "string" || !SEARXNG_URL.test(value)) return undefined;
  const checked = safeBaseUrl(value);
  if (checked === undefined || !URL.canParse(checked)) return undefined;
  const url = new URL(checked);
  return url.origin + url.pathname.replace(/\/+$/u, "");
}

/** SearXNG at `base` (a value `searxngBase` returned). No key exists for it and none is ever sent. */
export function searxng(base: string): SearchProvider {
  return {
    id: "searxng",
    label: "SearXNG",
    host: base,
    path: (query) => `/search?q=${encodeURIComponent(query)}&format=json&safesearch=1`,
    parse(body) {
      const results = expectObject(body).results;
      if (!Array.isArray(results)) throw new TypeError("expected an array");
      return results
        .slice(0, MAX_RAW_ENTRIES)
        .filter(isObject)
        .map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
    },
  };
}
