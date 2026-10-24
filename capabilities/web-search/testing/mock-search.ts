// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A stand-in for api.search.brave.com shaped from Brave's public documentation (GET
// /res/v1/web/search, `X-Subscription-Token` header, `{ web: { results: [{ title, url,
// description }] } }`). Nothing here was recorded from the real service.
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

export interface MockSearch extends MockService {
  /** What `web.results` holds. */
  results: unknown[];
  /** Replaces the whole reply (status, body, headers). */
  override: MockReply | undefined;
  /** Paths requested. */
  paths(): string[];
}

export async function startMockSearch(): Promise<MockSearch> {
  const state = { results: [] as unknown[], override: undefined as MockReply | undefined };
  const service = await startMockService((req) => {
    if (req.headers["x-subscription-token"] !== MOCK_API_KEY) {
      return { status: 401, body: { error: "bad token" } };
    }
    if (req.method === "GET" && req.path.split("?")[0] === "/res/v1/web/search") {
      if (state.override) return state.override;
      const count = Number(new URL(req.path, "http://x").searchParams.get("count") ?? 20);
      return {
        body: { type: "search", web: { type: "search", results: state.results.slice(0, count) } },
      };
    }
    return undefined;
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
    get override() {
      return state.override;
    },
    set override(value: MockReply | undefined) {
      state.override = value;
    },
  };
}
