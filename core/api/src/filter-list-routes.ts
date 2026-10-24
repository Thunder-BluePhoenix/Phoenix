// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { expectObject, route, type Route } from "./http";

/**
 * Session-token routes for the ad and tracker filter lists (Phase 93) and the shields settings.
 * `POST .../update` is the only thing that contacts the list server, and only when called.
 */
export interface FilterListsApi {
  lists(): unknown[];
  update(id: string): Promise<unknown>;
  setEnabled(id: string, input: unknown): unknown[];
  remove(id: string): unknown[];
  /** The stored, verified list text (at most 8 MiB) for the web app's matcher. */
  text(id: string): unknown;
  shields(): unknown;
  setShieldsEnabled(input: unknown): unknown;
  setSiteBlocking(site: string, input: unknown): unknown;
}

export function filterListRoutes(service: FilterListsApi): Route[] {
  return [
    route("GET", "/api/browser/filter-lists", () => ({
      lists: service.lists(),
      shields: service.shields(),
    })),
    route("POST", "/api/browser/filter-lists/:id/update", async ({ params }) => ({
      list: await service.update(params.id ?? ""),
    })),
    route("PUT", "/api/browser/filter-lists/:id", async ({ params, body }) => ({
      lists: service.setEnabled(params.id ?? "", expectObject(await body())),
    })),
    route("DELETE", "/api/browser/filter-lists/:id", ({ params }) => ({
      lists: service.remove(params.id ?? ""),
    })),
    route("GET", "/api/browser/filter-lists/:id/text", ({ params }) =>
      service.text(params.id ?? ""),
    ),
    route("GET", "/api/browser/shields", () => ({ shields: service.shields() })),
    route("PUT", "/api/browser/shields", async ({ body }) => ({
      shields: service.setShieldsEnabled(expectObject(await body())),
    })),
    route("PUT", "/api/browser/shields/sites/:site", async ({ params, body }) => ({
      shields: service.setSiteBlocking(params.site ?? "", expectObject(await body())),
    })),
  ];
}
