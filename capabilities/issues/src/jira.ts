// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Jira Cloud provider (REST API v3: /myself and /search/jql). Request and response shapes
// are taken from Atlassian's documentation; they have not been run against a real Jira site
// (no credentials were available when this was written).
import { resolveBase, statusError } from "./http";
import { PAGE_SIZE, ProviderBase, type ProviderOptions } from "./provider-base";
import { TrackerError, type IssueCategory, type IssueProvider, type RawIssueChange } from "./types";
import { MAX_STATUS, MAX_TITLE, isRecord, parseJson, sanitiseText, toIso } from "./validate";

export const MAX_TRACKED_KEYS = 100;
export const ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,49}-\d{1,9}$/;
const ACCOUNT_ID = /^[A-Za-z0-9:_-]{1,128}$/;
/** JQL dates carry no zone and are read in the user's profile timezone, so look back a day more. */
const JQL_ZONE_SLACK_MS = 26 * 3_600_000;
/** Resolutions that mean "will not be done" rather than "done". */
const CANCELLED_RESOLUTIONS =
  /won'?t|not planned|declined|duplicate|cannot reproduce|invalid|rejected/i;

export interface JiraConfig {
  site: string;
}

/** Jira status category key (+ resolution) → category. Unknown keys are treated as open. */
export function normaliseJiraStatus(
  categoryKey: string | undefined,
  resolution: string | undefined,
): IssueCategory {
  switch (categoryKey) {
    case "indeterminate":
      return "in_progress";
    case "done":
      return resolution !== undefined && CANCELLED_RESOLUTIONS.test(resolution)
        ? "cancelled"
        : "done";
    default:
      return "open";
  }
}

/** `yyyy/MM/dd HH:mm` in UTC, the JQL date-time format. */
export function jqlDate(iso: string): string {
  const d = new Date(Date.parse(iso) - JQL_ZONE_SLACK_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** The JQL for a poll. Only validated issue keys are ever interpolated. */
export function jiraJql(since: string | undefined, tracked: readonly string[]): string {
  if (since === undefined) {
    return "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC";
  }
  const keys = tracked.filter((k) => ISSUE_KEY.test(k)).slice(0, MAX_TRACKED_KEYS);
  const who = keys.length
    ? `(assignee = currentUser() OR key in (${keys.join(",")}))`
    : "assignee = currentUser()";
  return `${who} AND updated >= "${jqlDate(since)}" ORDER BY updated ASC`;
}

export function parseJiraIssue(
  node: unknown,
  site: string,
  accountId: string,
): RawIssueChange | undefined {
  if (!isRecord(node) || !isRecord(node.fields)) return undefined;
  const fields = node.fields;
  const key = node.key;
  if (typeof key !== "string" || !ISSUE_KEY.test(key)) return undefined;
  const title = sanitiseText(fields.summary, MAX_TITLE);
  const updatedAt = toIso(fields.updated);
  const status = isRecord(fields.status) ? fields.status : undefined;
  const statusName = sanitiseText(status?.name, MAX_STATUS);
  if (title === undefined || updatedAt === undefined || statusName === undefined) return undefined;
  const category = isRecord(status?.statusCategory) ? status.statusCategory.key : undefined;
  const resolution = isRecord(fields.resolution)
    ? sanitiseText(fields.resolution.name, MAX_STATUS)
    : undefined;
  const assignee = isRecord(fields.assignee) ? fields.assignee.accountId : undefined;
  return {
    tracker: "jira",
    key,
    title,
    url: `${site}/browse/${key}`,
    status: statusName,
    category: normaliseJiraStatus(typeof category === "string" ? category : undefined, resolution),
    assignedToMe: assignee === accountId,
    updatedAt,
    ref: key,
  };
}

export interface JiraPage {
  changes: RawIssueChange[];
  skipped: number;
  nextPageToken: string | undefined;
}

export function parseJiraPage(body: unknown, site: string, accountId: string): JiraPage {
  const issues = isRecord(body) ? body.issues : undefined;
  if (!Array.isArray(issues)) {
    throw new TrackerError("invalid_response", "Jira returned an unexpected issue list");
  }
  const changes: RawIssueChange[] = [];
  let skipped = 0;
  for (const node of issues) {
    const change = parseJiraIssue(node, site, accountId);
    if (change) changes.push(change);
    else skipped++;
  }
  const token = isRecord(body) ? body.nextPageToken : undefined;
  const more = isRecord(body) && body.isLast !== true;
  return {
    changes,
    skipped,
    nextPageToken: more && typeof token === "string" && token.length <= 500 ? token : undefined,
  };
}

export class JiraProvider extends ProviderBase implements IssueProvider {
  readonly id = "jira";
  private accountId: string | undefined;

  constructor(
    private readonly config: JiraConfig,
    options: ProviderOptions,
  ) {
    super(options);
  }

  private async get(path: string, auth: string, signal: AbortSignal): Promise<unknown> {
    const site = resolveBase(this.config.site, "Jira site");
    const res = await this.send(
      `${site}${path}`,
      { headers: { authorization: auth, accept: "application/json" } },
      signal,
    );
    if (res.status < 200 || res.status >= 300) throw statusError("Jira", res);
    return parseJson(res.body, "Jira");
  }

  async poll(
    since: string | undefined,
    signal: AbortSignal,
    tracked: readonly string[],
  ): Promise<RawIssueChange[]> {
    const email = await this.secret("jira_email");
    const apiToken = await this.secret("jira_api_token");
    if (!email || !apiToken) {
      throw new TrackerError(
        "config",
        "Set the Jira email and API token (secrets jira_email, jira_api_token)",
      );
    }
    const site = resolveBase(this.config.site, "Jira site");
    const auth = `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
    if (this.accountId === undefined) {
      const me = await this.get("/rest/api/3/myself", auth, signal);
      const id = isRecord(me) ? me.accountId : undefined;
      if (typeof id !== "string" || !ACCOUNT_ID.test(id)) {
        throw new TrackerError("invalid_response", "Jira /myself returned no account id");
      }
      this.accountId = id;
    }
    const jql = jiraJql(since, tracked);
    const changes: RawIssueChange[] = [];
    let skipped = 0;
    let truncated = false;
    let pageToken: string | undefined;
    for (let page = 0; ; page++) {
      const query = new URLSearchParams({
        jql,
        fields: "summary,status,assignee,updated,resolution",
        maxResults: String(PAGE_SIZE),
      });
      if (pageToken !== undefined) query.set("nextPageToken", pageToken);
      const body = await this.get(`/rest/api/3/search/jql?${query.toString()}`, auth, signal);
      const parsed = parseJiraPage(body, site, this.accountId);
      changes.push(...parsed.changes);
      skipped += parsed.skipped;
      if (parsed.nextPageToken === undefined) break;
      if (page + 1 >= this.maxPages) {
        truncated = true;
        break;
      }
      pageToken = parsed.nextPageToken;
    }
    // JQL only has minute precision and a timezone guess, so trim to the real cursor here.
    const result = since === undefined ? changes : changes.filter((c) => c.updatedAt >= since);
    const notes: string[] = [];
    if (truncated)
      notes.push(`more than ${this.maxPages} pages; the rest follows on the next poll`);
    if (skipped > 0) notes.push(`${skipped} malformed issue(s) ignored`);
    this.setNote(notes.length ? notes.join("; ") : undefined);
    return result;
  }
}
