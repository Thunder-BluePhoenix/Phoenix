// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { expectObject, route, type Route } from "./http";
import type { CalendarUpcomingView } from "../../runtime/src/calendar/service";

export interface CalendarApi {
  upcoming(): Promise<CalendarUpcomingView>;
}

/** The desktop shell's EventKit snapshot door (Phase 83). Throws a PhoenixError for a bad snapshot. */
export interface CalendarMacosApi {
  submit(body: unknown): unknown;
  status(): unknown;
}

/** Authenticated, read-only. The service gates on the calendar capability being enabled. */
export function calendarRoutes(service: CalendarApi, macos?: CalendarMacosApi): Route[] {
  return [
    ...(macos
      ? [
          // Session token only (like every non-public route). The shell replaces the held snapshot
          // each minute; the body is bounded by the default 256 KiB limit and validated.
          route("POST", "/api/calendar/macos", async ({ body }) => ({
            accepted: true,
            feed: macos.submit(expectObject(await body())),
          })),
          route("GET", "/api/calendar/macos", () => macos.status()),
        ]
      : []),
    route("GET", "/api/calendar/upcoming", async ({ url }) => {
      for (const _key of url.searchParams.keys())
        throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Unknown calendar parameter");
      return service.upcoming();
    }),
  ];
}
