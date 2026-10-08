// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Linear provider (GraphQL, https://linear.app/developers/graphql). Request and response
// shapes are taken from Linear's documentation; they have not been run against the real
// service (no credentials were available when this was written).
import { resolveBase, statusError } from "./http";
import { PAGE_SIZE, ProviderBase, type ProviderOptions } from "./provider-base";
import { TrackerError, type IssueCategory, type IssueProvider, type RawIssueChange } from "./types";
import {
  MAX_STATUS,
  MAX_TITLE,
  isRecord,
  parseJson,
  safeUrl,
  sanitiseText,
  toIso,
} from "./validate";

export const LINEAR_API = "https://api.linear.app/graphql";
/** Most issue ids sent in one query; more tracked issues than this are still found by assignee. */
export const MAX_TRACKED_IDS = 100;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]{0,15}-\d{1,9}$/;
const NODE_ID = /^[A-Za-z0-9-]{1,64}$/;

export interface LinearConfig {
  apiUrl?: string;
}

export const LINEAR_QUERY = `query PhoenixIssues($filter: IssueFilter, $first: Int, $after: String) {
  viewer { id }
  issues(filter: $filter, first: $first, after: $after, orderBy: updatedAt) {
    nodes { id identifier title url updatedAt state { name type } assignee { id } }
    pageInfo { hasNextPage endCursor }
  }
}`;

/** Linear workflow state type → category. Unknown types are treated as open. */
export function normaliseLinearStatus(type: string | undefined): IssueCategory {
  switch (type) {
    case "started":
      return "in_progress";
    case "completed":
      return "done";
    case "canceled":
      return "cancelled";
    default:
      return "open";
  }
}

/** The IssueFilter for a poll: my open issues (baseline) or anything of mine touched since. */
export function linearFilter(
  since: string | undefined,
  tracked: readonly string[],
): Record<string, unknown> {
  const mine = { assignee: { isMe: { eq: true } } };
  if (since === undefined) {
    return { ...mine, state: { type: { nin: ["completed", "canceled"] } } };
  }
  const ids = tracked.filter((id) => NODE_ID.test(id)).slice(0, MAX_TRACKED_IDS);
  return {
    updatedAt: { gte: since },
    or: ids.length ? [mine, { id: { in: ids } }] : [mine],
  };
}

export interface LinearPage {
  changes: RawIssueChange[];
  skipped: number;
  hasNext: boolean;
  endCursor: string | undefined;
}

/** Turns a GraphQL `errors` array (or a bad HTTP status) into the right TrackerError. */
export function linearError(status: number, body: unknown): TrackerError | undefined {
  const errors = isRecord(body) && Array.isArray(body.errors) ? body.errors : undefined;
  if (errors?.length) {
    const first = errors[0];
    const ext = isRecord(first) && isRecord(first.extensions) ? first.extensions : {};
    const code = typeof ext.code === "string" ? ext.code.toUpperCase() : "";
    if (code === "RATELIMITED") {
      return new TrackerError("rate_limit", "Linear rate limit reached", 60_000);
    }
    if (code.includes("AUTHENTICATION") || code === "FORBIDDEN" || status === 401) {
      return new TrackerError("auth", "Linear rejected the API key");
    }
    const message = isRecord(first) ? sanitiseText(first.message, 120) : undefined;
    return new TrackerError(
      "unavailable",
      `Linear reported an error${message ? `: ${message}` : ""}`,
    );
  }
  return undefined;
}

/** Validates one GraphQL reply. Throws on a wrong overall shape; bad nodes are skipped. */
export function parseLinearPage(body: unknown): LinearPage & { viewerId: string } {
  const data = isRecord(body) ? body.data : undefined;
  const viewer = isRecord(data) ? data.viewer : undefined;
  const issues = isRecord(data) ? data.issues : undefined;
  const viewerId = isRecord(viewer) ? viewer.id : undefined;
  if (typeof viewerId !== "string" || !NODE_ID.test(viewerId) || !isRecord(issues)) {
    throw new TrackerError("invalid_response", "Linear returned an unexpected reply");
  }
  const nodes = Array.isArray(issues.nodes) ? issues.nodes : undefined;
  if (nodes === undefined) {
    throw new TrackerError("invalid_response", "Linear returned an unexpected issue list");
  }
  const changes: RawIssueChange[] = [];
  let skipped = 0;
  for (const node of nodes) {
    const change = parseLinearIssue(node, viewerId);
    if (change) changes.push(change);
    else skipped++;
  }
  const info = isRecord(issues.pageInfo) ? issues.pageInfo : {};
  const cursor = info.endCursor;
  return {
    viewerId,
    changes,
    skipped,
    hasNext: info.hasNextPage === true && typeof cursor === "string" && cursor.length <= 200,
    endCursor: typeof cursor === "string" ? cursor : undefined,
  };
}

export function parseLinearIssue(node: unknown, viewerId: string): RawIssueChange | undefined {
  if (!isRecord(node)) return undefined;
  const { id, identifier } = node;
  const state = isRecord(node.state) ? node.state : undefined;
  const title = sanitiseText(node.title, MAX_TITLE);
  const url = safeUrl(node.url);
  const updatedAt = toIso(node.updatedAt);
  const status = sanitiseText(state?.name, MAX_STATUS);
  if (typeof id !== "string" || !NODE_ID.test(id)) return undefined;
  if (typeof identifier !== "string" || !IDENTIFIER.test(identifier)) return undefined;
  if (title === undefined || url === undefined || updatedAt === undefined) return undefined;
  if (status === undefined) return undefined;
  const type = typeof state?.type === "string" ? state.type : undefined;
  const assignee = isRecord(node.assignee) ? node.assignee.id : undefined;
  return {
    tracker: "linear",
    key: identifier,
    title,
    url,
    status,
    category: normaliseLinearStatus(type),
    assignedToMe: assignee === viewerId,
    updatedAt,
    ref: id,
  };
}

export class LinearProvider extends ProviderBase implements IssueProvider {
  readonly id = "linear";

  constructor(
    private readonly config: LinearConfig,
    options: ProviderOptions,
  ) {
    super(options);
  }

  async poll(
    since: string | undefined,
    signal: AbortSignal,
    tracked: readonly string[],
  ): Promise<RawIssueChange[]> {
    const key = await this.secret("linear_api_key");
    if (!key) throw new TrackerError("config", "Set the Linear API key (secret linear_api_key)");
    const endpoint = this.config.apiUrl
      ? resolveBase(this.config.apiUrl, "Linear api_url")
      : LINEAR_API;
    const filter = linearFilter(since, tracked);
    const changes: RawIssueChange[] = [];
    let after: string | undefined;
    let truncated = false;
    let skipped = 0;
    for (let page = 0; ; page++) {
      const res = await this.send(
        endpoint,
        {
          method: "POST",
          headers: {
            // Personal API keys go in the header as-is, without a "Bearer" prefix.
            authorization: key,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            query: LINEAR_QUERY,
            variables: { filter, first: PAGE_SIZE, after: after ?? null },
          }),
        },
        signal,
      );
      let body: unknown;
      try {
        body = parseJson(res.body, "Linear");
      } catch (err) {
        if (res.status >= 200 && res.status < 300) throw err;
        throw statusError("Linear", res);
      }
      const failure = linearError(res.status, body);
      if (failure) throw failure;
      if (res.status < 200 || res.status >= 300) throw statusError("Linear", res);
      const parsed = parseLinearPage(body);
      changes.push(...parsed.changes);
      skipped += parsed.skipped;
      if (!parsed.hasNext) break;
      if (page + 1 >= this.maxPages) {
        truncated = true;
        break;
      }
      after = parsed.endCursor;
    }
    const notes: string[] = [];
    if (truncated) notes.push(`more than ${this.maxPages} pages; older changes were not read`);
    if (skipped > 0) notes.push(`${skipped} malformed issue(s) ignored`);
    this.setNote(notes.length ? notes.join("; ") : undefined);
    return changes;
  }
}
