// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { expectObject, route, type Route } from "./http";
import type { CoreServices } from "./services";

export function syncRoutes(services: CoreServices): Route[] {
  const sync = () => {
    if (!services.sync) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Sync unavailable");
    return services.sync;
  };
  return [
    route("GET", "/api/sync", () => sync().inspect()),
    route("POST", "/api/sync/configure", async ({ body }) =>
      sync().configure(expectObject(await body())),
    ),
    route("POST", "/api/sync/disable", () => sync().disable()),
    route("POST", "/api/sync/exclusions", async ({ body }) =>
      sync().exclusions(expectObject(await body())),
    ),
    route("POST", "/api/sync/adapter", async ({ body }) =>
      sync().adapter(expectObject(await body())),
    ),
    route("POST", "/api/sync/adapter/apply", async ({ body }) =>
      sync().apply(expectObject(await body())),
    ),
    route("POST", "/api/sync/items", async ({ body }) => sync().upsert(expectObject(await body()))),
    route("POST", "/api/sync/items/delete", async ({ body }) => {
      const input = expectObject(await body());
      if (input.confirm !== true || typeof input.id !== "string" || typeof input.scope !== "string")
        throw new PhoenixError(
          ErrorCode.INVALID_REQUEST,
          "Deleting synced data needs id, scope, and confirm: true",
        );
      return sync().delete(input.id, input.scope);
    }),
    route("POST", "/api/sync/items/resolve", async ({ body }) => {
      const input = expectObject(await body());
      if (
        typeof input.id !== "string" ||
        typeof input.scope !== "string" ||
        (input.choice !== "local" && input.choice !== "remote")
      )
        throw new PhoenixError(
          ErrorCode.INVALID_REQUEST,
          "Conflict resolution needs id, scope and local or remote choice",
        );
      return sync().resolve(input.id, input.scope, input.choice);
    }),
    route("POST", "/api/sync/run", () => sync().sync()),
  ];
}
