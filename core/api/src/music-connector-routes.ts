// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { expectObject, route, type Route } from "./http";

/** Session-token routes: which music sites are allowed, and a site's own search address. */
export interface MusicConnectorsApi {
  sites(): unknown[];
  setEnabled(site: string, input: unknown): unknown[];
  search(site: string, input: unknown): { url: string };
}

export function musicConnectorRoutes(service: MusicConnectorsApi): Route[] {
  return [
    route("GET", "/api/music/connectors", () => ({ sites: service.sites() })),
    route("PUT", "/api/music/connectors/:site", async ({ params, body }) => ({
      sites: service.setEnabled(params.site ?? "", expectObject(await body())),
    })),
    route("POST", "/api/music/connectors/:site/search", async ({ params, body }) =>
      service.search(params.site ?? "", expectObject(await body())),
    ),
  ];
}
