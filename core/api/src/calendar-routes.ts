// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { route, type Route } from "./http";
import type { CalendarUpcomingView } from "../../runtime/src/calendar/service";

export interface CalendarApi {
  upcoming(): Promise<CalendarUpcomingView>;
}

/** Authenticated, read-only. The service gates on the calendar capability being enabled. */
export function calendarRoutes(service: CalendarApi): Route[] {
  return [
    route("GET", "/api/calendar/upcoming", async ({ url }) => {
      for (const _key of url.searchParams.keys())
        throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Unknown calendar parameter");
      return service.upcoming();
    }),
  ];
}
