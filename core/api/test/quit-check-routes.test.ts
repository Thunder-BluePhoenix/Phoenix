// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { RequestContext } from "../src/http";
import { quitCheckRoutes, type QuitCheckApi, type QuitCheckView } from "../src/quit-check-routes";

const context = (search = ""): RequestContext => ({
  req: {} as IncomingMessage,
  res: {} as ServerResponse,
  url: new URL(`http://localhost/api/awake/quit-check${search}`),
  params: {},
  body: async () => ({}),
});

describe("quit-check routes", () => {
  it("registers one authenticated GET returning the service view unchanged", async () => {
    const view: QuitCheckView = {
      available: true,
      can_quit: false,
      count: 1,
      pending: [{ kind: "pmset.disablesleep", at: 1 }],
    };
    const service: QuitCheckApi = { status: vi.fn(() => view) };
    const routes = quitCheckRoutes(service);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ method: "GET" });
    expect(routes[0]!.public).toBeUndefined();
    expect(routes[0]!.pattern.test("/api/awake/quit-check")).toBe(true);
    expect(await routes[0]!.handler(context())).toBe(view);
    expect(service.status).toHaveBeenCalledTimes(1);
  });

  it("rejects query parameters without asking the service", async () => {
    const service: QuitCheckApi = { status: vi.fn() };
    await expect(quitCheckRoutes(service)[0]!.handler(context("?x=1"))).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(service.status).not.toHaveBeenCalled();
  });
});
