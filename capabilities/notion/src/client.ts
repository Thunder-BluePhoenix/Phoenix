// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Only GET endpoints are used (users/me, pages/{id}, databases/{id}). Notion's search and database
// query endpoints are POST, so this capability cannot use them: it reads only the pages and
// databases the user lists by id. A ReadOnlyClient has no method that sends a body.
import { ReadOnlyClient, seg } from "@phoenix/service-kit";
import type { NotionKind } from "./parse";

export const SERVICE = "Notion";
export const DEFAULT_BASE_URL = "https://api.notion.com";
export const SECRET_NAME = "integration_token";
/** Fixed: a newer version could change the shape of what the parsers expect. */
export const NOTION_VERSION = "2022-06-28";

export function notionClient(baseUrl: string, token: string, signal: AbortSignal): ReadOnlyClient {
  return new ReadOnlyClient({
    service: SERVICE,
    baseUrl,
    secret: token,
    auth: (secret) => ({ authorization: `Bearer ${secret}` }),
    headers: { "notion-version": NOTION_VERSION },
    signal,
  });
}

export const BOT_PATH = "/v1/users/me";

export function objectPath(kind: NotionKind, id: string): string {
  return `/v1/${kind === "page" ? "pages" : "databases"}/${seg(id)}`;
}
