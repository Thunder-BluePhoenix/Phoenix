// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { route, type Route } from "./http";

/**
 * Session-token routes for pages sent from the browser extension (Phase 89). The body is untrusted
 * website text: it is validated and stored as a bounded record for the person to review. No route
 * here reads a note into a model, a command or a capability.
 */
export interface PageNotesApi {
  list(): unknown[];
  receive(input: unknown): unknown;
  remove(id: string): unknown;
}

/** The default 256 KiB body limit applies; every field has its own much smaller limit in the service. */
export function pageNoteRoutes(service: PageNotesApi): Route[] {
  return [
    route("GET", "/api/companion/pages", () => ({ pages: service.list() })),
    route("POST", "/api/companion/page", async ({ body }) => ({
      page: service.receive(await body()),
    })),
    route("DELETE", "/api/companion/pages/:id", ({ params }) => service.remove(params.id ?? "")),
  ];
}
