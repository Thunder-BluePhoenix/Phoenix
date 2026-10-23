// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { expectObject, route, type Route } from "./http";
import type { CoreServices } from "./services";

/** Phase 70: the interface language. Phase 59: the Fawkes sound switch and volume. Session-token routes only; not a capability command. */
export interface UiSettingsApi {
  get(): unknown;
  set(input: unknown): unknown;
  sounds(): unknown;
  setSounds(input: unknown): unknown;
}

export function uiRoutes(s: CoreServices): Route[] {
  const service = () => {
    if (!s.uiSettings)
      throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "UI settings not available");
    return s.uiSettings;
  };
  return [
    route("GET", "/api/ui/settings", () => service().get()),
    route("POST", "/api/ui/settings", async ({ body }) =>
      service().set(expectObject(await body())),
    ),
    route("GET", "/api/ui/sounds", () => service().sounds()),
    route("POST", "/api/ui/sounds", async ({ body }) =>
      service().setSounds(expectObject(await body())),
    ),
  ];
}
