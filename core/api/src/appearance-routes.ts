// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { expectObject, route, type Route } from "./http";
import type { CoreServices } from "./services";

/** Phase 61: the user's Fawkes appearance. Session-token routes only; not a capability command. */
export interface AppearanceApi {
  get(): unknown;
  set(input: unknown): unknown;
  importPack(input: unknown): unknown;
  deletePack(id: string): unknown;
}

export function appearanceRoutes(s: CoreServices): Route[] {
  const service = () => {
    if (!s.appearance)
      throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Appearance not available");
    return s.appearance;
  };
  return [
    route("GET", "/api/fawkes/appearance", () => service().get()),
    route("POST", "/api/fawkes/appearance", async ({ body }) =>
      service().set(expectObject(await body())),
    ),
    route("POST", "/api/fawkes/packs", async ({ body }) =>
      service().importPack(expectObject(await body())),
    ),
    route("DELETE", "/api/fawkes/packs/:id", ({ params }) => service().deletePack(params.id!)),
  ];
}
