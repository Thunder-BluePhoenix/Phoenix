// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Notion page and database objects (GET /v1/pages/{id}, GET /v1/databases/{id}), read defensively:
// every field is untrusted text, and a page title is whatever any editor typed into it.
import { redact } from "@phoenix/logging";
import { epochMs, expectObject, httpsUrl, isObject, str, type Json } from "@phoenix/service-kit";

export const MAX_TEXT = 200;
/** Rich-text fragments joined into a title; a title is clipped long before this. */
const MAX_TITLE_PARTS = 20;
const MAX_PROPERTIES = 200;
/** A Notion id: a UUID with or without dashes. Nothing else may reach a request path. */
export const NOTION_ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

export type NotionKind = "page" | "database";

export interface NotionObject {
  kind: NotionKind;
  /** Canonical lower-case UUID with dashes. */
  id: string;
  title: string;
  /** https link to the object in Notion, when the response carried one. */
  url?: string;
  /** Epoch ms of Notion's `last_edited_time`. */
  editedAt: number;
  archived: boolean;
}

/** Free text from Notion: clipped, control characters removed, secret-looking values redacted. */
export function text(value: unknown, max = MAX_TEXT): string | undefined {
  const clipped = str(value, max * 4);
  if (clipped === undefined) return undefined;
  const clean = String(redact(clipped));
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

/** The same id in one spelling, so "…-…" and 32-hex forms of one page are one page. */
export function canonicalId(id: string): string | undefined {
  if (!NOTION_ID.test(id)) return undefined;
  const hex = id.replaceAll("-", "").toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function richText(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts: string[] = [];
  for (const part of value.slice(0, MAX_TITLE_PARTS)) {
    if (isObject(part) && typeof part.plain_text === "string") parts.push(part.plain_text);
  }
  return text(parts.join(""));
}

function pageTitle(properties: unknown): string | undefined {
  if (!isObject(properties)) return undefined;
  for (const property of Object.values(properties).slice(0, MAX_PROPERTIES)) {
    if (isObject(property) && property.type === "title") return richText(property.title);
  }
  return undefined;
}

function parseObject(raw: Json, kind: NotionKind): NotionObject {
  if (raw.object !== kind) throw new TypeError("unexpected object type");
  const id = typeof raw.id === "string" ? canonicalId(raw.id) : undefined;
  const editedAt = epochMs(raw.last_edited_time);
  if (id === undefined || editedAt === undefined) throw new TypeError("missing id or time");
  const title = (kind === "page" ? pageTitle(raw.properties) : richText(raw.title)) ?? "Untitled";
  const url = httpsUrl(raw.url);
  return {
    kind,
    id,
    title,
    ...(url ? { url } : {}),
    editedAt,
    archived: raw.archived === true || raw.in_trash === true,
  };
}

export function parsePage(body: unknown): NotionObject {
  return parseObject(expectObject(body), "page");
}

export function parseDatabase(body: unknown): NotionObject {
  return parseObject(expectObject(body), "database");
}

/** GET /v1/users/me: only checks that the token works; returns the bot's display name if any. */
export function parseBot(body: unknown): string | undefined {
  const user = expectObject(body);
  if (user.object !== "user") throw new TypeError("unexpected object type");
  return text(user.name, 80);
}
