// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  engineeringSignalsRoutes,
  type EngineeringSignalsApi,
} from "../src/engineering-signals-routes";
import type { RequestContext } from "../src/http";

function context(body: unknown): RequestContext {
  return {
    req: {} as IncomingMessage,
    res: {} as ServerResponse,
    url: new URL("http://localhost/api/engineering-signals"),
    params: {},
    body: async () => body,
  };
}

describe("engineering signals routes", () => {
  it("registers authenticated read-only snapshot and validated root replacement", async () => {
    const snapshot = {
      watchedRoots: [],
      signals: [],
      availability: { advisories: { available: false }, history: { available: false } },
    };
    const service: EngineeringSignalsApi = {
      status: vi.fn(async () => snapshot),
      setWatchedRoots: vi.fn(async () => snapshot),
    };
    const routes = engineeringSignalsRoutes(service);
    expect(routes.map(({ method, public: isPublic }) => ({ method, isPublic }))).toEqual([
      { method: "GET", isPublic: undefined },
      { method: "PUT", isPublic: undefined },
    ]);
    expect(routes[0]!.pattern.test("/api/engineering-signals")).toBe(true);
    expect(routes[1]!.pattern.test("/api/engineering-signals/watched-roots")).toBe(true);
    expect(await routes[0]!.handler(context({}))).toEqual(snapshot);
    await expect(routes[1]!.handler(context({ watchedRoots: ["/absolute"] }))).resolves.toEqual(
      snapshot,
    );
    expect(service.setWatchedRoots).toHaveBeenCalledWith(["/absolute"]);
    for (const bad of [null, [], {}, { watchedRoots: [], extra: true }]) {
      await expect(routes[1]!.handler(context(bad))).rejects.toMatchObject({
        code: "INVALID_REQUEST",
      });
    }
    expect(service.setWatchedRoots).toHaveBeenCalledTimes(1);
  });
});
