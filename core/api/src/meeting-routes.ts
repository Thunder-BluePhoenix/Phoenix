// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { expectObject, intParam, route, type Route } from "./http";
import { MAX_QUESTION_CHARS } from "./memory-routes";
import type { CoreServices } from "./services";

const MAX_FILTER_CHARS = 32;
const MAX_ID_CHARS = 200;
const MAX_ITEM_TEXT = 500;
const MAX_SEARCH_RESULTS = 50;

const invalid = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);

function exactKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw invalid(`Unknown field "${key.slice(0, 40)}"`);
  }
}

function filter(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key);
  if (value === null || value === "") return undefined;
  if (value.length > MAX_FILTER_CHARS) throw invalid(`"${key}" is not a known value`);
  return value;
}

function text(value: unknown, key: string, max: number): string {
  if (typeof value !== "string") throw invalid(`"${key}" must be a string`);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw invalid(`"${key}" must not be empty`);
  if (trimmed.length > max) throw invalid(`"${key}" must be at most ${max} characters`);
  return trimmed;
}

/** `undefined` keeps the stored value, `null` clears it, a string sets it. */
function optionalText(body: Record<string, unknown>, key: string): string | null | undefined {
  const value = body[key];
  if (value === undefined || value === null) return value;
  if (typeof value !== "string") throw invalid(`"${key}" must be a string or null`);
  return value;
}

/** An id taken from the URL path. Overlong ids cannot exist, so they are 404 without a lookup. */
function pathId(value: string | undefined, what: string): string {
  if (value === undefined || value.length === 0 || value.length > MAX_ID_CHARS) {
    throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, `${what} not found`);
  }
  return value;
}

/**
 * Review of decisions and action items taken from meetings (Phase 35), plus meeting search and
 * questions. Everything is behind the session token. These routes MUST be registered before the
 * generic `/api/meetings/:id` routes: `search` and `ask` would otherwise be read as meeting ids.
 */
export function meetingReviewRoutes(s: CoreServices): Route[] {
  const review = () => {
    if (!s.meetingReview) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Review not found");
    return s.meetingReview;
  };
  const reviewAction = (action: "accept" | "reject" | "reopen") =>
    route("POST", `/api/meeting-items/:id/${action}`, async ({ params, body }) => {
      exactKeys(expectObject(await body()), []);
      return review()[action](pathId(params.id, "Item"));
    });

  return [
    route("GET", "/api/meetings/search", ({ url }) => {
      const limit = intParam(url, "limit", 20)!;
      if (limit < 1 || limit > MAX_SEARCH_RESULTS) {
        throw invalid(`"limit" must be between 1 and ${MAX_SEARCH_RESULTS}`);
      }
      return review().search(
        text(url.searchParams.get("q") ?? undefined, "q", MAX_QUESTION_CHARS),
        limit,
      );
    }),
    route("POST", "/api/meetings/ask", async ({ body }) => {
      const b = expectObject(await body());
      exactKeys(b, ["question"]);
      return review().ask(text(b.question, "question", MAX_QUESTION_CHARS));
    }),
    route("GET", "/api/meetings/:id/items", ({ params, url }) => {
      const status = filter(url, "status");
      const kind = filter(url, "kind");
      return review().list(pathId(params.id, "Meeting"), {
        ...(status ? { status } : {}),
        ...(kind ? { kind } : {}),
      });
    }),
    route("POST", "/api/meetings/:id/items/extract", async ({ params, body, res }) => {
      exactKeys(expectObject(await body()), []);
      const report = await review().extract(pathId(params.id, "Meeting"));
      res.statusCode = 202;
      return report;
    }),
    route("POST", "/api/meetings/:id/items", async ({ params, body, res }) => {
      const b = expectObject(await body());
      exactKeys(b, ["kind", "text", "owner", "due"]);
      const kind = text(b.kind, "kind", MAX_FILTER_CHARS);
      const owner = optionalText(b, "owner");
      const due = optionalText(b, "due");
      const result = review().add(pathId(params.id, "Meeting"), {
        kind,
        text: text(b.text, "text", MAX_ITEM_TEXT),
        ...(owner !== undefined ? { owner } : {}),
        ...(due !== undefined ? { due } : {}),
      });
      res.statusCode = 201;
      return result;
    }),
    reviewAction("accept"),
    reviewAction("reject"),
    reviewAction("reopen"),
    route("POST", "/api/meeting-items/:id/edit", async ({ params, body }) => {
      const b = expectObject(await body());
      exactKeys(b, ["text", "owner", "due"]);
      const owner = optionalText(b, "owner");
      const due = optionalText(b, "due");
      return review().edit(pathId(params.id, "Item"), {
        text: text(b.text, "text", MAX_ITEM_TEXT),
        ...(owner !== undefined ? { owner } : {}),
        ...(due !== undefined ? { due } : {}),
      });
    }),
  ];
}
