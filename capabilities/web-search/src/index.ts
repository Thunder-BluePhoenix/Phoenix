// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Web search capability (Phase 66 gap): one read command, `search`, that sends a short text query to
// a search provider and returns a few cleaned results. What it guarantees, each pinned by a test:
//   * The query is the only thing that leaves this computer. It is cleaned, length-capped and
//     refused (before any request) when the agent secret detector recognises a secret in it.
//   * The provider host is a constant in code. No config value, response field or result link can
//     change where a request (or the owner's key) goes; redirects are refused; nothing in a result
//     is ever fetched.
//   * Results are untrusted text: every field is clipped and stripped of markup and control
//     characters, links must be https without credentials or fragments, and the answer is marked
//     `untrusted: true` with a fixed notice. Nothing in it is interpreted.
//   * 15 s timeout, 1 MiB response cap, a per-minute search cap, fixed secret-free errors.
//   * Without the owner's key nothing is sent anywhere.
//   * `search_confirmed` is the same search as an `external` command: Core asks a person before every
//     call and the prompt shows the exact query. It is the only search « OK Fawkes » can start.
import { defineCapability, type CapabilityContext, type HealthResult } from "@phoenix/sdk";
import { ReadOnlyClient, ServiceError, isObject, safeBaseUrl } from "@phoenix/service-kit";
import { BRAVE, type SearchProvider } from "./provider";
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
export const TIMEOUT_MS = 15_000;
const NO_KEY_NOTE = `Add a ${BRAVE.label} API key in the capability's secrets`;

export interface WebSearchOptions {
  /** Epoch ms clock for the rate cap; tests pin it. */
  now?: () => number;
  /**
   * Address of the provider. Code only, deliberately NOT a config setting: the key may only ever be
   * sent to the provider's own origin. Tests pass a loopback mock here.
   */
  apiUrl?: string;
  /** Request timeout; tests shorten it. */
  timeoutMs?: number;
}

function limitOf(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.min(Math.max(value, 1), MAX_RESULTS)
    : DEFAULT_RESULTS;
}

/** A fresh capability instance (its own rate window). Phoenix Core uses `createWebSearchCapability()`. */
export function createWebSearchCapability(options: WebSearchOptions = {}) {
  const now = options.now ?? Date.now;
  const provider: SearchProvider = BRAVE;
  const checkedUrl = safeBaseUrl(options.apiUrl ?? provider.host);
  if (checkedUrl === undefined) throw new TypeError("apiUrl must be https, or http to loopback");
  const apiUrl: string = checkedUrl;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
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

  async function search(
    input: unknown,
    ctx: CapabilityContext,
    queryOptions: QueryOptions = {},
  ): Promise<SearchOutput> {
    const args = isObject(input) ? input : {};
    // 1. The query is checked before anything else exists: no key read, no request, no rate slot.
    const cleaned = cleanQuery(args.query, queryOptions);
    if (!cleaned.ok) throw cleaned.error;
    // 2. Without the owner's key nothing is sent.
    const key = await ctx.secret(provider.secretName);
    if (!key) throw new ServiceError(SERVICE, "auth", NO_KEY_NOTE);
    // 3. The per-minute cap.
    takeRateSlot();
    const limit = limitOf(args.limit);
    const client = new ReadOnlyClient({
      service: SERVICE,
      baseUrl: apiUrl,
      secret: key,
      auth: (secret) => ({ [provider.keyHeader]: secret }),
      maxBytes: MAX_RESPONSE_BYTES,
      timeoutMs,
      signal: ctx.signal,
    });
    let raw: ReturnType<SearchProvider["parse"]>;
    try {
      raw = await client.get(provider.path(cleaned.query, limit), (body) => provider.parse(body));
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      throw new ServiceError(SERVICE, "invalid", `${SERVICE} could not be read`);
    }
    return searchOutput(provider.id, cleaned.query, cleanHits(raw, limit));
  }

  return defineCapability({
    manifest: {
      id: "web-search",
      name: "Web search",
      version: "0.1.0",
      description: `Search the web through ${provider.label}: one read command that sends a short text query to ${provider.host} and returns a few titles, links and snippets as untrusted text. The query leaves this computer; nothing else does. Needs a ${provider.label} API key (write-only secret).`,
      license: "GPL-3.0-or-later",
      homepage: "https://github.com/Thunder-BluePhoenix/Phoenix",
      events: [],
      permissions: ["network", "external_api"],
      data_categories: [
        `search query text (sent to ${provider.label}, ${provider.host})`,
        "search result titles, links and snippets (untrusted text from the web; returned to the caller, not stored)",
      ],
      healthcheck: { interval_ms: 60_000 },
      secrets: [
        {
          name: provider.secretName,
          description: `${provider.label} API key (subscription token). Sent only to ${provider.host}, in the ${provider.keyHeader} header, with a search query. Use a key you can revoke.`,
        },
      ],
      commands: [
        {
          name: "search",
          description: `Search the web (sends the query text to ${provider.label}); returns at most ${MAX_RESULTS} untrusted results`,
          side_effect: "read",
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
                maxLength: MAX_QUERY_CHARS,
                description: `What to search for (at most ${MAX_QUERY_CHARS} characters). Sent to ${provider.label}; refused if it looks like it contains a secret.`,
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
          description: `Search the web, but only after you approve the exact query that is sent to ${provider.label}`,
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
                description: `What to search for (at most ${MAX_CONFIRMED_QUERY_CHARS} characters, no hidden characters). Shown in full in the approval prompt, then sent to ${provider.label}.`,
                // Shown in the approval prompt, so the person reads exactly what would leave.
                "x-phoenix-confirm": true,
              },
            },
          },
        },
      ],
      config_schema: { type: "object", additionalProperties: false, properties: {} },
    },
    commands: {
      search: (input, ctx) => search(input, ctx),
      search_confirmed: (input, ctx) =>
        search(input, ctx, { maxChars: MAX_CONFIRMED_QUERY_CHARS, exact: true }),
    },
    async health(ctx): Promise<HealthResult> {
      if (!(await ctx.secret(provider.secretName))) {
        return { status: "degraded", message: NO_KEY_NOTE };
      }
      return { status: "healthy", message: `Ready to search with ${provider.label}` };
    },
  });
}
