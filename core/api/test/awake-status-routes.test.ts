// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  awakeStatusRoutes,
  type AwakeStatusApi,
  type AwakeTrayView,
} from "../src/awake-status-routes";
import type { RequestContext } from "../src/http";

const context = (search = ""): RequestContext => ({
  req: {} as IncomingMessage,
  res: {} as ServerResponse,
  url: new URL(`http://localhost/api/awake/status${search}`),
  params: {},
  body: async () => ({}),
});

describe("awake status routes", () => {
  it("registers one authenticated GET returning the service view unchanged", async () => {
    const view: AwakeTrayView = {
      available: true,
      active: true,
      mode: "timed",
      remaining_seconds: 90,
    };
    const service: AwakeStatusApi = { status: vi.fn(() => view) };
    const routes = awakeStatusRoutes(service);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ method: "GET" });
    expect(routes[0]!.public).toBeUndefined();
    expect(routes[0]!.pattern.test("/api/awake/status")).toBe(true);
    expect(await routes[0]!.handler(context())).toEqual(view);
  });

  it("rejects query parameters without asking the service", async () => {
    const service: AwakeStatusApi = { status: vi.fn() };
    await expect(awakeStatusRoutes(service)[0]!.handler(context("?x=1"))).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(service.status).not.toHaveBeenCalled();
  });
});
