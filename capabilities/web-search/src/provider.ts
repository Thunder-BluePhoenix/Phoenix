// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The provider seam. A provider says WHERE (a host fixed in code, never from config, a response or a
// result link), HOW to ask (a GET path built from the already-checked query) and how to read the
// answer into raw `{ title, url, snippet }` entries that `results.ts` then cleans. It never sees the
// key: the capability sends the key, as a header, only to `host`.
//
// The one provider built is Brave Search, which has NO keyless endpoint: its documented web search
// (GET /res/v1/web/search, `X-Subscription-Token` header) needs a subscription token the owner
// supplies as a write-only secret. The response shape below (`web.results[].title|url|description`)
// was written from Brave's public API documentation; it was never confirmed against the live service.
import { expectObject, isObject } from "@phoenix/service-kit";

export interface SearchProvider {
  id: string;
  /** Shown in the approval text and the docs. */
  label: string;
  /** The only origin a request (and the key) is ever sent to. Https. */
  host: string;
  /** Name of the write-only capability secret holding the owner's key. */
  secretName: string;
  /** Header that carries the key. */
  keyHeader: string;
  /** GET path (and query string) for an already-cleaned query. */
  path(query: string, limit: number): string;
  /** Raw result entries from the parsed JSON body; throws when the body is not the expected shape. */
  parse(body: unknown): { title: unknown; url: unknown; snippet: unknown }[];
}

export const BRAVE: SearchProvider = {
  id: "brave",
  label: "Brave Search",
  host: "https://api.search.brave.com",
  secretName: "api_key",
  keyHeader: ["x", "subscription", "token"].join("-"),
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
      .filter(isObject)
      .map((r) => ({ title: r.title, url: r.url, snippet: r.description }));
  },
};
