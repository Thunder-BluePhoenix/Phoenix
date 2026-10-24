// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Web search capability (Phase 66 gap): one read command, `search`, that sends a short text query to
// a chain of search providers and returns a few cleaned results. What it guarantees, each pinned by a
// test:
//   * The query is the only thing that leaves this computer. It is cleaned, length-capped and
//     refused (before any request) when the agent secret detector recognises a secret in it.
//   * The providers, in order: the owner's SearXNG instance (only when `searxng_url` is set), Brave
//     Search (only when the owner stored an API key), DuckDuckGo's Instant Answer API (always; it
//     needs no setup). So once the owner enables this capability a query CAN reach duckduckgo.com
//     with nothing configured; the capability is installed but never auto-enabled.
//   * The next provider is asked ONLY when the one before it failed (network error, timeout, any
//     non-2xx answer, 403 because SearXNG's json format is off, a malformed body). Never on an empty
//     successful answer, never after the capability's own refusal of a query or its rate cap. One
//     attempt per provider, so at most 3 requests per search, and one rate slot per search. The query
//     therefore reaches every provider that is attempted, and the approval text names them all.
//   * Hosts: Brave and DuckDuckGo are constants in code; SearXNG is the one address the owner set,
//     checked when saved and again on every search. A response field or result link can never change
//     where a request goes; redirects are refused; nothing in a result is ever fetched.
//   * The Brave key is sent only to Brave's host. SearXNG and DuckDuckGo are sent no credential.
//   * Results are untrusted text: every field is clipped and stripped of markup and control
//     characters, links must be https without credentials or fragments, and the answer is marked
//     `untrusted: true` with a fixed notice. Nothing in it is interpreted.
//   * 15 s timeout per attempt, 1 MiB response cap, a per-minute search cap, fixed secret-free errors
//     that repeat nothing a provider said.
//   * `search_confirmed` is the same search as an `external` command: Core asks a person before every
//     call and the prompt shows the exact query and names every provider that may receive it. It is
//     the only search « OK Fawkes » can start.
import { defineCapability, type CapabilityContext, type HealthResult } from "@phoenix/sdk";
import { ReadOnlyClient, ServiceError, isObject, safeBaseUrl } from "@phoenix/service-kit";
import {
  BRAVE,
  DUCKDUCKGO,
  SEARXNG_URL_PATTERN,
  searxng,
  searxngBase,
  type RawHit,
  type SearchProvider,
} from "./provider";
import {
  MAX_CONFIRMED_QUERY_CHARS,
  MAX_QUERY_CHARS,
  SERVICE,
  cleanQuery,
  type QueryOptions,
} from "./query";
import { cleanHits, searchOutput, type SearchOutput } from "./results";

export * from "./provider";
export * from "./query";
export * from "./results";

/** The one command voice may start (see ai/multimodal/src/voice/intent.ts). */
export const CONFIRMED_COMMAND = "search_confirmed";
export const DEFAULT_RESULTS = 5;
export const MAX_RESULTS = 10;
/** Searches a minute at most, however they were asked for. */
export const SEARCHES_PER_MINUTE = 6;
export const RATE_WINDOW_MS = 60_000;
/** Largest provider response read: 1 MiB. */
export const MAX_RESPONSE_BYTES = 1024 * 1024;
/** Per attempt. */
export const TIMEOUT_MS = 15_000;
/** One attempt per provider and three providers: the most requests one `search` can make. */
export const MAX_ATTEMPTS = 3;
const BAD_SEARXNG_URL =
  "The search was not sent: the searxng_url setting is not an allowed address (https, or http to this computer only, no user name, query or odd path); fix or remove it";

export interface WebSearchOptions {
  /** Epoch ms clock for the rate cap; tests pin it. */
  now?: () => number;
  /**
   * Addresses of the two built-in providers. Code only, deliberately NOT a config setting: the
   * Brave key may only ever be sent to Brave's own origin. Tests pass loopback mocks here. (The
   * SearXNG address is the one setting an owner may change: `searxng_url`.)
   */
  hosts?: { brave?: string; duckduckgo?: string };
  /** Request timeout per attempt; tests shorten it. */
  timeoutMs?: number;
}

function limitOf(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.min(Math.max(value, 1), MAX_RESULTS)
    : DEFAULT_RESULTS;
}

/** One provider in this search's chain, with the only address and (Brave only) key it is sent. */
interface Link {
  provider: SearchProvider;
  baseUrl: string;
  secret?: string;
}

interface Failure {
  link: Link;
  /** A fixed sentence from this file; nothing the provider said. */
  reason: string;
  kind: ServiceError["kind"];
}

function reasonOf(provider: SearchProvider, err: unknown): Failure["reason"] {
  const kind = err instanceof ServiceError ? err.kind : "invalid";
  if (kind === "network") return "was unreachable or timed out";
  if (kind === "rate_limit") return "reached its rate limit";
  if (kind === "auth") return "rejected the request (401)";
  if (kind === "forbidden") {
    return provider.id === "searxng"
      ? "refused the request (403): its json format is probably not enabled (its owner must list json under search.formats)"
      : "refused the request (403)";
  }
  if (kind === "http" || kind === "not_found") return "answered with an error status";
  return "sent an unexpected, malformed or oversized answer";
}

function allFailed(failures: readonly Failure[], alone: boolean): ServiceError {
  const detail = failures.map((f) => `${f.link.provider.label} ${f.reason}`).join("; ");
  const tail = alone ? "; no other provider was asked" : "";
  return new ServiceError(
    SERVICE,
    failures[0]?.kind ?? "network",
    `The search failed: ${detail}${tail}`,
  );
}

/** A fresh capability instance (its own rate window). Phoenix Core uses `createWebSearchCapability()`. */
export function createWebSearchCapability(options: WebSearchOptions = {}) {
  const now = options.now ?? Date.now;
  const braveUrl = safeBaseUrl(options.hosts?.brave ?? BRAVE.host);
  const duckUrl = safeBaseUrl(options.hosts?.duckduckgo ?? DUCKDUCKGO.host);
  if (braveUrl === undefined || duckUrl === undefined) {
    throw new TypeError("hosts must be https, or http to loopback");
  }
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const braveKey = BRAVE.key!;
  /** Start times of the searches sent in the last minute. */
  let sent: number[] = [];

  function takeRateSlot(): void {
    const at = now();
    sent = sent.filter((t) => at - t < RATE_WINDOW_MS);
    if (sent.length >= SEARCHES_PER_MINUTE) {
      throw new ServiceError(
        SERVICE,
        "rate_limit",
        `The search was not sent: at most ${SEARCHES_PER_MINUTE} searches a minute, try again shortly`,
      );
    }
    sent.push(at);
  }

  /**
   * The providers this search may use, in order: SearXNG when `searxng_url` is set, Brave when a key is
   * stored, DuckDuckGo always. A `searxng_url` that fails the check again here (config read back
   * from storage) refuses the search outright: it is never skipped, so the query never goes
   * somewhere the owner did not choose.
   */
  async function chainOf(ctx: CapabilityContext): Promise<Link[]> {
    const chain: Link[] = [];
    const configured = ctx.config.searxng_url;
    if (configured !== undefined) {
      const base = searxngBase(configured);
      if (base === undefined) throw new ServiceError(SERVICE, "invalid", BAD_SEARXNG_URL);
      chain.push({ provider: searxng(base), baseUrl: base });
    }
    const key = await ctx.secret(braveKey.secretName);
    if (key) chain.push({ provider: BRAVE, baseUrl: braveUrl!, secret: key });
    chain.push({ provider: DUCKDUCKGO, baseUrl: duckUrl! });
    return chain;
  }

  async function attempt(
    link: Link,
    query: string,
    limit: number,
    ctx: CapabilityContext,
  ): Promise<RawHit[]> {
    const { provider } = link;
    // The key header exists only for a link that carries a key, i.e. Brave, sent to Brave's host.
    const client = new ReadOnlyClient({
      service: SERVICE,
      baseUrl: link.baseUrl,
      ...(link.secret !== undefined && provider.key
        ? { secret: link.secret, auth: (secret) => ({ [provider.key!.header]: secret }) }
        : {}),
      maxBytes: MAX_RESPONSE_BYTES,
      timeoutMs,
      signal: ctx.signal,
    });
    return client.get(provider.path(query, limit), (body) => provider.parse(body));
  }

  async function search(
    input: unknown,
    ctx: CapabilityContext,
    queryOptions: QueryOptions = {},
    /** `false`: ask the first provider only and never fall back (the approved search). */
    fallback = true,
  ): Promise<SearchOutput> {
    const args = isObject(input) ? input : {};
    // 1. The query is checked before anything else exists: no key read, no request, no rate slot.
    const cleaned = cleanQuery(args.query, queryOptions);
    if (!cleaned.ok) throw cleaned.error;
    // 2. The chain is read now (config, key) so an invalid address refuses before a rate slot is used.
    const chain = (await chainOf(ctx)).slice(0, fallback ? MAX_ATTEMPTS : 1);
    // 3. One rate slot per search, however many providers are asked.
    takeRateSlot();
    const limit = limitOf(args.limit);
    const failures: Failure[] = [];
    for (const link of chain) {
      try {
        const raw = await attempt(link, cleaned.query, limit, ctx);
        const hits = cleanHits(raw, limit);
        const note = link.provider.note?.(hits.length);
        return searchOutput(link.provider.id, cleaned.query, hits, {
          fallbackFrom: failures.map((f) => f.link.provider.id),
          ...(note ? { note } : {}),
        });
      } catch (err) {
        failures.push({
          link,
          reason: reasonOf(link.provider, err),
          kind: err instanceof ServiceError ? err.kind : "invalid",
        });
        // A cancelled or disabled search asks nobody else.
        if (ctx.signal.aborted) break;
      }
    }
    throw allFailed(failures, !fallback);
  }

  const searchTimeout = MAX_ATTEMPTS * timeoutMs + 5_000;

  return defineCapability({
    manifest: {
      id: "web-search",
      name: "Web search",
      version: "0.2.0",
      description: `Search the web: one read command that sends a short text query to a chain of search providers (your SearXNG instance if you set searxng_url, then Brave Search if you stored an API key, then DuckDuckGo's Instant Answer API, which needs no setup) and returns a few titles, links and snippets as untrusted text. The query leaves this computer; nothing else does.`,
      license: "GPL-3.0-or-later",
      homepage: "https://github.com/Thunder-BluePhoenix/Phoenix",
      events: [],
      permissions: ["network", "external_api"],
      data_categories: [
        `search query text (sent to the first search provider that is set up and, only if that one fails, to the next: the SearXNG instance at the address in searxng_url, ${BRAVE.label} at ${BRAVE.host} when an API key is stored, ${DUCKDUCKGO.label} at ${DUCKDUCKGO.host}; with no setup at all it goes to ${DUCKDUCKGO.label})`,
        "search result titles, links and snippets (untrusted text from the web; returned to the caller, not stored)",
      ],
      healthcheck: { interval_ms: 60_000 },
      secrets: [
        {
          name: braveKey.secretName,
          description: `Optional ${BRAVE.label} API key (subscription token). Sent only to ${BRAVE.host}, in the ${braveKey.header} header, with a search query; without it Brave is skipped. Use a key you can revoke.`,
        },
      ],
      commands: [
        {
          name: "search",
          description: `Search the web: sends the query text to your SearXNG instance (if searxng_url is set), then only if that fails to ${BRAVE.label} (if a key is stored), then only if that fails to ${DUCKDUCKGO.label} (always); returns at most ${MAX_RESULTS} untrusted results`,
          side_effect: "read",
          permissions: ["network", "external_api"],
          timeout_ms: searchTimeout,
          input_schema: {
            type: "object",
            additionalProperties: false,
            required: ["query"],
            properties: {
              query: {
                type: "string",
                minLength: 1,
                maxLength: MAX_QUERY_CHARS,
                description: `What to search for (at most ${MAX_QUERY_CHARS} characters). Sent to every provider that is asked; refused if it looks like it contains a secret.`,
              },
              limit: {
                type: "integer",
                minimum: 1,
                maximum: MAX_RESULTS,
                description: `How many results to return (default ${DEFAULT_RESULTS}).`,
              },
            },
          },
        },
        {
          name: "search_confirmed",
          // The approval prompt shows this text. It cannot show the owner's SearXNG address (the
          // manifest is fixed; only the query is shown from the input), so the search asks ONE
          // provider and never falls back: what is named here is all that can receive the query.
          description: `Search the web, but only after you approve the exact query. It is sent to ONE provider and never to a second: your SearXNG instance if searxng_url is set, otherwise ${BRAVE.label} if an API key is stored, otherwise ${DUCKDUCKGO.label}`,
          // `external`: Core asks the person before every call, whoever asked. Voice uses this one.
          side_effect: "external",
          permissions: ["network", "external_api"],
          timeout_ms: timeoutMs + 5_000,
          input_schema: {
            type: "object",
            additionalProperties: false,
            required: ["query"],
            properties: {
              query: {
                type: "string",
                minLength: 1,
                maxLength: MAX_CONFIRMED_QUERY_CHARS,
                description: `What to search for (at most ${MAX_CONFIRMED_QUERY_CHARS} characters, no hidden characters). Shown in full in the approval prompt, then sent to one search provider.`,
                // Shown in the approval prompt, so the person reads exactly what would leave.
                "x-phoenix-confirm": true,
              },
            },
          },
        },
      ],
      config_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          searxng_url: {
            type: "string",
            minLength: 1,
            maxLength: 2048,
            pattern: SEARXNG_URL_PATTERN,
            description:
              "Address of a SearXNG instance whose JSON format is enabled, e.g. https://searx.example.org or http://127.0.0.1:8080/searx. https, or http only to this computer; no user name, query or fragment. Search queries are sent to it first. Changes apply when the capability is enabled.",
          },
        },
      },
    },
    commands: {
      search: (input, ctx) => search(input, ctx),
      search_confirmed: (input, ctx) =>
        search(input, ctx, { maxChars: MAX_CONFIRMED_QUERY_CHARS, exact: true }, false),
    },
    async health(ctx): Promise<HealthResult> {
      let chain: Link[];
      try {
        chain = await chainOf(ctx);
      } catch {
        return { status: "degraded", message: BAD_SEARXNG_URL };
      }
      return {
        status: "healthy",
        message: `Ready to search with ${chain[0]!.provider.label}${
          chain.length > 1
            ? ` (then ${chain
                .slice(1)
                .map((l) => l.provider.label)
                .join(", then ")})`
            : ""
        }`,
      };
    },
  });
}
