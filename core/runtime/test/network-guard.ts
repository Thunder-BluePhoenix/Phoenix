// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { vi } from "vitest";

/** Every URL a test tried to reach through the global `fetch`. */
export interface NetworkGuard {
  requests: string[];
}

/** The real fetch, captured once at load: a second guard in one test must not wrap the first. */
const realFetch = globalThis.fetch;

const LOCAL_HOSTS: Record<string, true> = { "127.0.0.1": true, localhost: true };
/** The real Ollama port: tests use fake providers, never the real daemon. */
const OLLAMA_PORT = "11434";

/**
 * Makes the global `fetch` refuse every request that is not to a local mock server on 127.0.0.1
 * (and never to port 11434, where a real Ollama listens). Nothing can reach GitHub, Frappe,
 * api.anthropic.com or any other service: such a request throws, so the test fails loudly.
 * Call `vi.restoreAllMocks()` (or `release()`) after the test.
 */
export function guardNetwork(): NetworkGuard & { release(): void } {
  const requests: string[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    requests.push(url.href);
    if (LOCAL_HOSTS[url.hostname] !== true || url.port === OLLAMA_PORT) {
      throw new TypeError(`network guard: blocked a request to ${url.origin}`);
    }
    return realFetch(input, init);
  });
  return { requests, release: () => spy.mockRestore() };
}
