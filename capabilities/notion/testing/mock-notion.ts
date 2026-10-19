// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A stand-in for api.notion.com shaped from Notion's public API reference: Bearer authentication,
// a required `Notion-Version` header, GET /v1/users/me, GET /v1/pages/{id}, GET /v1/databases/{id},
// objects carrying `object`, `id`, `last_edited_time`, `archived`, `url` and (pages) `properties`
// with one `title` property of rich text, (databases) a top-level rich-text `title`; errors are
// `{ object: "error", status, code, message }`. Nothing here was recorded from the real service.
import { startMockService, type MockReply, type MockService } from "@phoenix/service-kit/testing";

/** Built at runtime so no token-shaped literal sits in the tree. */
export const MOCK_TOKEN = ["fake", "notion", "token", "0001"].join("-");
export const PAGE_ID = "59833787-2cf9-4fdf-8782-e53db20768a5";
export const DB_ID = "8a3b1c52-0d4e-4f6a-9b7c-1e2d3f4a5b6c";

const NOTION_URL = "https://www.notion.so/";

function rich(content: unknown) {
  return [{ type: "text", text: { content, link: null }, plain_text: content, href: null }];
}

export function rawPage(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    object: "page",
    id,
    created_time: "2026-09-01T08:00:00.000Z",
    last_edited_time: "2026-10-05T10:00:00.000Z",
    archived: false,
    in_trash: false,
    url: `${NOTION_URL}${id.replaceAll("-", "")}`,
    properties: { Name: { id: "title", type: "title", title: rich("Roadmap") } },
    ...over,
  };
}

export function rawDatabase(
  id: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    object: "database",
    id,
    created_time: "2026-09-01T08:00:00.000Z",
    last_edited_time: "2026-10-05T10:00:00.000Z",
    title: rich("Tasks"),
    archived: false,
    in_trash: false,
    url: `${NOTION_URL}${id.replaceAll("-", "")}`,
    properties: {},
    ...over,
  };
}

export interface MockNotion extends MockService {
  /** Objects by canonical id; a value of `null` answers 404 object_not_found. */
  objects: Map<string, unknown>;
  /** Replaces the whole reply to GET /v1/users/me (default: a bot user). */
  me: MockReply | undefined;
  /** Replaces every reply that would otherwise come from an object lookup. */
  override: MockReply | undefined;
  paths(): string[];
}

export async function startMockNotion(): Promise<MockNotion> {
  const state = {
    objects: new Map<string, unknown>(),
    me: undefined as MockReply | undefined,
    override: undefined as MockReply | undefined,
  };
  const notFound: MockReply = {
    status: 404,
    body: { object: "error", status: 404, code: "object_not_found", message: "Could not find" },
  };
  const service = await startMockService((req) => {
    if (req.headers.authorization !== `Bearer ${MOCK_TOKEN}`) {
      return {
        status: 401,
        body: {
          object: "error",
          status: 401,
          code: "unauthorized",
          message: "API token is invalid.",
        },
      };
    }
    if (!req.headers["notion-version"]) {
      return {
        status: 400,
        body: {
          object: "error",
          status: 400,
          code: "missing_version",
          message: "Notion-Version header",
        },
      };
    }
    if (req.method !== "GET") return undefined;
    const path = req.path.split("?")[0] ?? "";
    if (path === "/v1/users/me") {
      return (
        state.me ?? {
          body: { object: "user", id: "bot-1", type: "bot", name: "Phoenix watcher", bot: {} },
        }
      );
    }
    const match = /^\/v1\/(pages|databases)\/([^/]+)$/.exec(path);
    if (!match) return undefined;
    if (state.override) return state.override;
    const object = state.objects.get(decodeURIComponent(match[2]!));
    return object ? { body: object } : notFound;
  });
  return {
    url: service.url,
    requests: service.requests,
    respond: service.respond,
    close: service.close,
    objects: state.objects,
    get me() {
      return state.me;
    },
    set me(value: MockReply | undefined) {
      state.me = value;
    },
    get override() {
      return state.override;
    },
    set override(value: MockReply | undefined) {
      state.override = value;
    },
    paths: () => service.requests.map((r) => r.path),
  };
}
