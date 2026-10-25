// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { expectObject, route, type Route } from "./http";

/**
 * Session-token routes only. Nothing here returns a stored credential value, and nothing runs an
 * extension: this is the record of profiles, their bookmarks, sync choices and approved extensions.
 */
export interface BrowserProfilesApi {
  list(): unknown[];
  get(id: string): unknown;
  create(input: unknown): unknown;
  remove(id: string): Promise<unknown>;
  setSync(id: string, input: unknown): unknown;
  addBookmark(id: string, input: unknown): unknown;
  importBookmarks(id: string, input: unknown): unknown;
  recordVisit(id: string, input: unknown): void;
  putCredential(id: string, name: string, input: unknown): Promise<unknown>;
  deleteCredential(id: string, name: string): Promise<unknown>;
  publish(id: string): Promise<unknown>;
  pull(): Promise<unknown>;
  preview(id: string): unknown;
  accept(id: string, input: unknown): unknown;
  adopt(id: string, input: unknown): unknown;
  extensions(id: string): unknown;
  install(id: string, input: unknown): unknown;
  approve(id: string, extensionId: string, input: unknown): Promise<unknown>;
  uninstall(id: string, extensionId: string): unknown;
  /** Removed profiles whose saved web data the Phoenix browser window has not yet deleted. */
  pendingPurges(): string[];
  purgeDone(id: string): string[];
  /** Scripts the shell may inject on one exact https origin; only after the gateway agreed. */
  contentScriptsFor(id: string, origin: string): Promise<unknown>;
}

const ID = /^[a-zA-Z0-9_-]{1,80}$/;

function id(raw: string | undefined, what: string): string {
  if (raw === undefined || !ID.test(raw))
    throw new PhoenixError(ErrorCode.INVALID_REQUEST, `Not ${what}`);
  return raw;
}

export function browserProfileRoutes(service: BrowserProfilesApi): Route[] {
  const body = async (read: () => Promise<unknown>) => expectObject(await read());
  return [
    route("GET", "/api/browser/profiles", () => ({ profiles: service.list() })),
    route("POST", "/api/browser/profiles", async (ctx) => service.create(await body(ctx.body))),
    route("GET", "/api/browser/profiles/:id", ({ params }) =>
      service.get(id(params.id, "a profile id")),
    ),
    route("DELETE", "/api/browser/profiles/:id", ({ params }) =>
      service.remove(id(params.id, "a profile id")),
    ),
    route("PUT", "/api/browser/profiles/:id/sync", async (ctx) =>
      service.setSync(id(ctx.params.id, "a profile id"), await body(ctx.body)),
    ),
    route("POST", "/api/browser/profiles/:id/bookmarks", async (ctx) =>
      service.addBookmark(id(ctx.params.id, "a profile id"), await body(ctx.body)),
    ),
    // The default 256 KiB body limit applies: a larger export has to be split by the user.
    route("POST", "/api/browser/profiles/:id/bookmarks/import", async (ctx) =>
      service.importBookmarks(id(ctx.params.id, "a profile id"), await body(ctx.body)),
    ),
    route("POST", "/api/browser/profiles/:id/history", async (ctx) => {
      service.recordVisit(id(ctx.params.id, "a profile id"), await body(ctx.body));
      return { recorded: true };
    }),
    route("PUT", "/api/browser/profiles/:id/credentials/:name", async (ctx) =>
      service.putCredential(
        id(ctx.params.id, "a profile id"),
        id(ctx.params.name, "a credential name"),
        await body(ctx.body),
      ),
    ),
    route("DELETE", "/api/browser/profiles/:id/credentials/:name", ({ params }) =>
      service.deleteCredential(id(params.id, "a profile id"), id(params.name, "a credential name")),
    ),
    route("POST", "/api/browser/profiles/:id/publish", ({ params }) =>
      service.publish(id(params.id, "a profile id")),
    ),
    route("POST", "/api/browser/sync/pull", () => service.pull()),
    route("GET", "/api/browser/profiles/:id/sync-preview", ({ params }) => ({
      item: service.preview(id(params.id, "a profile id")),
    })),
    route("POST", "/api/browser/profiles/:id/sync-accept", async (ctx) =>
      service.accept(id(ctx.params.id, "a profile id"), await body(ctx.body)),
    ),
    route("POST", "/api/browser/profiles/:id/adopt", async (ctx) =>
      service.adopt(id(ctx.params.id, "a profile id"), await body(ctx.body)),
    ),
    route("GET", "/api/browser/profiles/:id/extensions", ({ params }) => ({
      extensions: service.extensions(id(params.id, "a profile id")),
    })),
    route("POST", "/api/browser/profiles/:id/extensions", async (ctx) =>
      service.install(id(ctx.params.id, "a profile id"), await body(ctx.body)),
    ),
    route("PUT", "/api/browser/profiles/:id/extensions/:extension/approval", async (ctx) => ({
      extensions: await service.approve(
        id(ctx.params.id, "a profile id"),
        id(ctx.params.extension, "an extension id"),
        await body(ctx.body),
      ),
    })),
    route("DELETE", "/api/browser/profiles/:id/extensions/:extension", ({ params }) => ({
      extensions: service.uninstall(
        id(params.id, "a profile id"),
        id(params.extension, "an extension id"),
      ),
    })),
    // Web data purges: Core only keeps the queue; the browser window deletes and acknowledges.
    route("GET", "/api/browser/profile-purges", () => ({ pending: service.pendingPurges() })),
    route("POST", "/api/browser/profile-purges/:id/done", ({ params }) => ({
      pending: service.purgeDone(id(params.id, "a profile id")),
    })),
    // `:origin` is one percent-encoded segment, e.g. https%3A%2F%2Fexample.com.
    route("GET", "/api/browser/profiles/:id/content-scripts/:origin", ({ params }) =>
      service.contentScriptsFor(id(params.id, "a profile id"), params.origin ?? ""),
    ),
  ];
}
