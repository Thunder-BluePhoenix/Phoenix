// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { expectBoolean, expectObject, intParam, route, type Route } from "./http";
import type { CoreServices } from "./services";

/** Longest question or search text accepted. */
export const MAX_QUESTION_CHARS = 500;
/** Longest value of a secret accepted (same bound as capability secrets). */
export const MAX_SECRET_CHARS = 8192;
const MAX_PAGE = 200;
const MAX_SEARCH_RESULTS = 100;
const MAX_OFFSET = 1_000_000;
/** Longest domain/layer filter read before the service checks it against its list. */
const MAX_FILTER_CHARS = 32;

const invalid = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);

function ranged(url: URL, key: string, fallback: number, min: number, max: number): number {
  const n = intParam(url, key, fallback)!;
  if (n < min || n > max) throw invalid(`"${key}" must be between ${min} and ${max}`);
  return n;
}

function optionalFilter(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key);
  if (value === null || value === "") return undefined;
  if (value.length > MAX_FILTER_CHARS) throw invalid(`"${key}" is not a known value`);
  return value;
}

function text(value: unknown, key: string, max: number): string {
  if (typeof value !== "string") throw invalid(`"${key}" must be a string`);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw invalid(`"${key}" must not be empty`);
  if (trimmed.length > max) throw invalid(`"${key}" must be at most ${max} characters`);
  return trimmed;
}

/** Memory browsing/governance and AI settings. Everything here is behind the session token. */
export function memoryRoutes(s: CoreServices): Route[] {
  const memory = () => {
    if (!s.memory) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Memory not found");
    return s.memory;
  };
  const retrieval = () => {
    if (!s.retrieval) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Retrieval not found");
    return s.retrieval;
  };
  const ai = () => {
    if (!s.ai) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "AI settings not found");
    return s.ai;
  };

  return [
    route("GET", "/api/memory", ({ url }) => {
      const include = url.searchParams.get("include");
      if (include !== null && include !== "live") throw invalid('"include" must be "live"');
      const domain = optionalFilter(url, "domain");
      const layer = optionalFilter(url, "layer");
      return memory().browse({
        ...(domain ? { domain } : {}),
        ...(layer ? { layer } : {}),
        limit: ranged(url, "limit", 50, 1, MAX_PAGE),
        offset: ranged(url, "offset", 0, 0, MAX_OFFSET),
      });
    }),
    route("GET", "/api/memory/search", ({ url }) => {
      const domain = optionalFilter(url, "domain");
      return memory().search({
        text: text(url.searchParams.get("q") ?? undefined, "q", MAX_QUESTION_CHARS),
        ...(domain ? { domain } : {}),
        limit: ranged(url, "limit", 20, 1, MAX_SEARCH_RESULTS),
      });
    }),
    route("GET", "/api/retrieval/settings", () => retrieval().settings()),
    route("POST", "/api/retrieval/settings", async ({ body }) =>
      retrieval().setSettings(expectObject(await body())),
    ),
    route("GET", "/api/retrieval/status", () => retrieval().status()),
    route("GET", "/api/memory/settings", () => memory().settings()),
    route("POST", "/api/memory/settings", async ({ body }) =>
      memory().setSettings(expectObject(await body())),
    ),
    route("POST", "/api/memory/ask", async ({ body }) =>
      memory().ask(text(expectObject(await body()).question, "question", MAX_QUESTION_CHARS)),
    ),
    // Deleting is never undone, so the body must say so in so many words.
    route("POST", "/api/memory/delete", async ({ body }) => {
      const b = expectObject(await body());
      if (b.confirm !== true) throw invalid('Deleting memory needs {"confirm": true}');
      if (b.domain !== undefined && typeof b.domain !== "string") {
        throw invalid('"domain" must be a string');
      }
      return { deleted: memory().deleteAll(b.domain) };
    }),
    route("POST", "/api/memory/:id/forget", async ({ params, body }) => {
      expectObject(await body());
      if (!memory().forget(params.id!)) {
        throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Memory not found");
      }
      return { forgotten: true };
    }),

    route("GET", "/api/ai/status", () => ai().status()),
    route("POST", "/api/ai/settings", async ({ body }) =>
      ai().setSettings(expectObject(await body())),
    ),
    route("POST", "/api/ai/external-processing", async ({ body }) =>
      ai().setExternalProcessing(expectBoolean(expectObject(await body()), "granted")),
    ),
    // Write-only, like capability secrets: the value goes to OS secret storage, never back out.
    route("POST", "/api/ai/secret", async ({ body }) => {
      const value = expectObject(await body()).value;
      if (typeof value !== "string" || value.length === 0 || value.length > MAX_SECRET_CHARS) {
        throw invalid(`"value" must be a string of 1-${MAX_SECRET_CHARS} characters`);
      }
      await ai().setSecret(value);
      return { anthropic_key_set: true };
    }),
    route("DELETE", "/api/ai/secret", async () => {
      await ai().deleteSecret();
      return { anthropic_key_set: false };
    }),
  ];
}
