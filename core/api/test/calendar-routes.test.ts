// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { calendarRoutes, type CalendarApi } from "../src/calendar-routes";
import type { RequestContext } from "../src/http";

const context = (search = ""): RequestContext => ({
  req: {} as IncomingMessage,
  res: {} as ServerResponse,
  url: new URL(`http://localhost/api/calendar/upcoming${search}`),
  params: {},
  body: async () => ({}),
});

describe("calendar routes", () => {
  it("registers one authenticated GET returning the service view unchanged", async () => {
    const view = {
      enabled: false,
      events: [],
      prep: {},
      status: "unconfigured" as const,
      checkedAt: null,
      prepComplete: true,
    };
    const service: CalendarApi = { upcoming: vi.fn(async () => view) };
    const routes = calendarRoutes(service);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ method: "GET" });
    expect(routes[0]!.public).toBeUndefined();
    expect(routes[0]!.pattern.test("/api/calendar/upcoming")).toBe(true);
    expect(await routes[0]!.handler(context())).toBe(view);
    expect(service.upcoming).toHaveBeenCalledTimes(1);
  });

  it("rejects query parameters without reading the calendar", async () => {
    const service: CalendarApi = { upcoming: vi.fn() };
    await expect(calendarRoutes(service)[0]!.handler(context("?x=1"))).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(service.upcoming).not.toHaveBeenCalled();
  });
});
