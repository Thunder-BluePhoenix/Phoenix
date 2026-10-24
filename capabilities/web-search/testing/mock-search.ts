// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Loopback stand-ins for the three search providers, each shaped from its public documentation (or,
// for DuckDuckGo, from one manual single-request probe, not a test):
//   * Brave: GET /res/v1/web/search, `X-Subscription-Token` header, `{ web: { results: [{ title, url,
//     description }] } }`.
//   * SearXNG: GET <prefix>/search?q=…&format=json, `{ results: [{ title, url, content, engine }] }`;
//     `format=json` answers 403 when the instance has not enabled json.
//   * DuckDuckGo Instant Answer: GET /?q=…&format=json…, `{ Abstract…, RelatedTopics: [...] }`.
// Nothing here was recorded from a real service, and no test contacts one.
import { startMockService, type MockReply, type MockService } from "@phoenix/service-kit/testing";

/** Built at runtime so no key-shaped literal sits in the tree. */
export const MOCK_API_KEY = ["fake", "search", "key", "0001"].join("-");

export function rawResult(n: number, over: Record<string, unknown> = {}) {
  return {
    title: `Result ${n}`,
    url: `https://example.org/page-${n}`,
    description: `Snippet ${n}`,
    ...over,
  };
}

/** A SearXNG result entry (`content` is its snippet). */
export function searxResult(n: number, over: Record<string, unknown> = {}) {
  return {
    title: `Searx ${n}`,
    url: `https://example.net/searx-${n}`,
    content: `Searx snippet ${n}`,
    engine: "mock",
    ...over,
  };
}

/** A DuckDuckGo related topic entry. */
export function ddgTopic(n: number, over: Record<string, unknown> = {}) {
  return {
    FirstURL: `https://duckduckgo.com/Topic_${n}`,
    Icon: { URL: "", Height: "", Width: "" },
    Result: `<a href="https://duckduckgo.com/Topic_${n}">Topic ${n}</a>Summary ${n}`,
    Text: `Topic ${n} - Summary ${n}`,
    ...over,
  };
}

/** A full DuckDuckGo Instant Answer body with every documented key present and empty. */
export function ddgBody(over: Record<string, unknown> = {}) {
  return {
    Abstract: "",
    AbstractSource: "",
    AbstractText: "",
    AbstractURL: "",
    Answer: "",
    AnswerType: "",
    Definition: "",
    DefinitionSource: "",
    DefinitionURL: "",
    Entity: "",
    Heading: "",
    Image: "",
    ImageHeight: 0,
    ImageIsLogo: 0,
    ImageWidth: 0,
    Infobox: "",
    Redirect: "",
    RelatedTopics: [],
    Results: [],
    Type: "",
    meta: {},
    ...over,
  };
}

export interface MockSearch extends MockService {
  /** What the provider answers with: Brave `web.results`, SearXNG `results`. DuckDuckGo: use `body`. */
  results: unknown[];
  /** DuckDuckGo only: the whole JSON body. */
  body: unknown;
  /** Replaces the whole reply (status, body, headers). */
  override: MockReply | undefined;
  /** Paths requested. */
  paths(): string[];
}

type Kind = "brave" | "searxng" | "duckduckgo";

async function startMock(kind: Kind, prefix = ""): Promise<MockSearch> {
  const state = {
    results: [] as unknown[],
    body: ddgBody() as unknown,
    override: undefined as MockReply | undefined,
  };
  const service = await startMockService((req) => {
    if (req.method !== "GET") return undefined;
    const url = new URL(req.path, "http://x");
    if (kind === "brave") {
      if (req.headers["x-subscription-token"] !== MOCK_API_KEY) {
        return { status: 401, body: { error: "bad token" } };
      }
      if (url.pathname !== "/res/v1/web/search") return undefined;
      if (state.override) return state.override;
      const count = Number(url.searchParams.get("count") ?? 20);
      return {
        body: { type: "search", web: { type: "search", results: state.results.slice(0, count) } },
      };
    }
    if (kind === "searxng") {
      if (url.pathname !== `${prefix}/search`) return undefined;
      if (state.override) return state.override;
      if (url.searchParams.get("format") !== "json")
        return { status: 403, body: "<html>no</html>" };
      return {
        body: { query: url.searchParams.get("q"), number_of_results: 0, results: state.results },
      };
    }
    if (url.pathname !== "/") return undefined;
    if (state.override) return state.override;
    // The one observed response was served as application/x-javascript, not application/json.
    return { body: state.body, headers: { "content-type": "application/x-javascript" } };
  });
  return {
    url: service.url,
    requests: service.requests,
    respond: service.respond,
    close: service.close,
    paths: () => service.requests.map((r) => r.path),
    get results() {
      return state.results;
    },
    set results(value: unknown[]) {
      state.results = value;
    },
    get body() {
      return state.body;
    },
    set body(value: unknown) {
      state.body = value;
    },
    get override() {
      return state.override;
    },
    set override(value: MockReply | undefined) {
      state.override = value;
    },
  };
}

/** A stand-in for api.search.brave.com. */
export const startMockSearch = () => startMock("brave");
/** A stand-in for the owner's SearXNG instance, served under `prefix` (default none). */
export const startMockSearxng = (prefix = "") => startMock("searxng", prefix);
/** A stand-in for api.duckduckgo.com. */
export const startMockDuckDuckGo = () => startMock("duckduckgo");
