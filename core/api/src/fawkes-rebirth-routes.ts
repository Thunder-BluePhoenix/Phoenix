// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { RebirthSettings } from "../../runtime/src/fawkes-rebirth/service";
import { route, type Route } from "./http";

/** Session-token routes: whether milestones show and whether Fawkes is drawn in high contrast. */
export interface FawkesRebirthApi {
  settings(): RebirthSettings;
  set(input: unknown): RebirthSettings;
}

export function fawkesRebirthRoutes(service: FawkesRebirthApi): Route[] {
  return [
    route("GET", "/api/fawkes/rebirth", () => service.settings()),
    route("PUT", "/api/fawkes/rebirth", async ({ body }) => service.set(await body())),
  ];
}
