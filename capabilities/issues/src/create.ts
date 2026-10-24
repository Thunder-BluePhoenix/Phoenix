// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// `linear.issue.create` and `jira.issue.create` (Phase 85): the only commands of this capability
// that WRITE to a tracker. Polling stays read-only. Text only: no image or file is ever sent.
//
// Safety properties, each pinned by a test in test/create.test.ts:
//   * Both commands are declared `external` in the manifest, so Core asks the user for
//     confirmation on every call (the card names the tracker, project/team, title and the start of
//     the description) and the permission gateway writes an audit row for the confirmation, the
//     authorisation and the outcome. Nothing here can create without that.
//   * Own write-only credentials (`linear_write_key`, `jira_write_email`, `jira_write_token`),
//     never the polling ones: a read-only key set for polling cannot enable writes, and a missing
//     write credential fails before any request. Credentials are only ever read into a header.
//   * The host is pinned. Linear: always https://api.linear.app/graphql (the polling `api_url`
//     override is ignored). Jira: only the https `*.atlassian.net` site the owner put in
//     `config.create.jira_site`, validated by the config schema when it is stored and again here;
//     nothing the agent or the remote side supplies can change it.
//   * Fixed queries and bodies: the Linear mutation is one constant string with variables, the
//     Jira body is built from validated fields only. Title and description are secret-redacted and
//     stripped of control and format characters before they leave the machine.
//   * No redirects, 15 s timeout, replies capped at 256 KiB. Only the created issue's id, key and
//     url are returned, and the url is rebuilt or checked against its host and path shape, so
//     nothing the tracker writes can reach the caller as a link, markdown or text.
//   * Every error message is fixed text: it never holds a credential, the request or anything the
//     remote side wrote. After the request was sent, a failure says the outcome is unknown.
//   * No idempotency key: neither tracker offers a cheap lookup like GitHub's, so a retry after an
//     unknown outcome can create a second issue. Look in the tracker first (the error says so).
import { redact } from "@phoenix/logging";
import { DEFAULT_TIMEOUT_MS, httpRequest, retryAfterMs, type HttpResult } from "./http";
import { TrackerError, type HttpLimits, type SecretReader } from "./types";
import { isRecord, parseJson } from "./validate";

export const LINEAR_WRITE_KEY_SECRET = "linear_write_key";
export const JIRA_WRITE_EMAIL_SECRET = "jira_write_email";
export const JIRA_WRITE_TOKEN_SECRET = "jira_write_token";

/** Linear and Jira cap a title at 255 characters. */
export const MAX_CREATE_TITLE = 255;
export const MAX_CREATE_BODY = 10_000;
export const MAX_CREATE_RESPONSE_BYTES = 256 * 1024;
export const DEFAULT_ISSUE_TYPE = "Task";

/** The only place Linear issues are created. The polling `api_url` override never applies. */
export const LINEAR_CREATE_ENDPOINT = "https://api.linear.app/graphql";
const LINEAR_WEB_HOST = "linear.app";

export const LINEAR_CREATE_MUTATION = `mutation PhoenixIssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue {
      id
      identifier
      url
    }
  }
}`;

export const TEAM_ID_PATTERN =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";
export const JIRA_PROJECT_PATTERN = "^[A-Z][A-Z0-9_]{1,49}$";
export const ISSUE_TYPE_PATTERN = "^[A-Za-z][A-Za-z0-9 _-]{0,39}$";
/** The Jira Cloud site: https, a lowercase `*.atlassian.net` host, nothing else. */
export const JIRA_CLOUD_SITE_PATTERN =
  "^https://[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.atlassian\\.net/?$";

const TEAM_ID_RE = new RegExp(TEAM_ID_PATTERN);
const JIRA_PROJECT_RE = new RegExp(JIRA_PROJECT_PATTERN);
const ISSUE_TYPE_RE = new RegExp(ISSUE_TYPE_PATTERN);
const JIRA_CLOUD_SITE_RE = new RegExp(JIRA_CLOUD_SITE_PATTERN);
const JIRA_CLOUD_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.atlassian\.net$/;
const LINEAR_NODE_ID = /^[A-Za-z0-9-]{1,64}$/;
const LINEAR_IDENTIFIER = /^[A-Za-z][A-Za-z0-9]{0,15}-\d{1,9}$/;
const LINEAR_WORKSPACE = /^[A-Za-z0-9_-]{1,64}$/;
const JIRA_ISSUE_ID = /^\d{1,18}$/;
const JIRA_ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,49}-\d{1,9}$/;
const SECRET_VALUE = /^[\x21-\x7e]{8,255}$/;
const EMAIL = /^[^\s:@\u0000-\u001f\u007f]{1,64}@[^\s:@\u0000-\u001f\u007f]{1,190}$/;
const HIDDEN_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu;
const HIDDEN_EXCEPT_NEWLINE_TAB = /(?![\n\t])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

export interface CreatedIssue {
  tracker: "linear" | "jira";
  /** The tracker's own id (Linear UUID, Jira numeric id). */
  id: string;
  /** Human key: `ENG-12` or `PROJ-45`. */
  key: string;
  /** Link to the issue on the tracker's own web host. */
  url: string;
}

export interface CreateOptions {
  secret: SecretReader;
  signal: AbortSignal;
  limits?: Partial<HttpLimits>;
}

export interface JiraCreateOptions extends CreateOptions {
  /** `config.create.jira_site`; validated again here. */
  site: unknown;
}

export interface LinearCreateInput {
  team_id: string;
  title: string;
  body?: string;
}

export interface JiraCreateInput {
  project: string;
  title: string;
  body?: string;
  issue_type?: string;
}

const invalid = (message: string) => new TrackerError("invalid", message);

/** Only these keys may be present; anything else is refused rather than ignored. */
function onlyKeys(input: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw invalid("Unknown input field");
  }
}

/** One line, secrets redacted, control/format characters gone; never empty, never over the cap. */
export function cleanTitle(value: unknown): string {
  if (typeof value !== "string") throw invalid("title must be text");
  const redacted = redact(value.slice(0, MAX_CREATE_TITLE * 4));
  const text = (typeof redacted === "string" ? redacted : "")
    .replace(HIDDEN_CHARS, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!text) throw invalid("title is empty");
  if ([...text].length > MAX_CREATE_TITLE) {
    throw invalid(`title is longer than ${MAX_CREATE_TITLE} characters`);
  }
  return text;
}

/** Multi-line text, secrets redacted, control/format characters gone (newline and tab kept). */
export function cleanBody(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw invalid("body must be text");
  const redacted = redact(value.slice(0, MAX_CREATE_BODY * 2));
  const text = (typeof redacted === "string" ? redacted : "")
    .replace(/\r\n?/g, "\n")
    .replace(HIDDEN_EXCEPT_NEWLINE_TAB, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return undefined;
  if ([...text].length > MAX_CREATE_BODY) {
    throw invalid(`body is longer than ${MAX_CREATE_BODY} characters`);
  }
  return text;
}

export function parseLinearInput(input: unknown): {
  teamId: string;
  title: string;
  body: string | undefined;
} {
  if (!isRecord(input)) throw invalid("Input must be an object");
  onlyKeys(input, ["team_id", "title", "body"]);
  const teamId = input.team_id;
  if (typeof teamId !== "string" || !TEAM_ID_RE.test(teamId)) {
    throw invalid("team_id must be a Linear team UUID");
  }
  return { teamId, title: cleanTitle(input.title), body: cleanBody(input.body) };
}

export function parseJiraInput(input: unknown): {
  project: string;
  issueType: string;
  title: string;
  body: string | undefined;
} {
  if (!isRecord(input)) throw invalid("Input must be an object");
  onlyKeys(input, ["project", "title", "body", "issue_type"]);
  const project = input.project;
  if (typeof project !== "string" || !JIRA_PROJECT_RE.test(project)) {
    throw invalid("project must be a Jira project key such as PROJ");
  }
  const issueType = input.issue_type ?? DEFAULT_ISSUE_TYPE;
  if (typeof issueType !== "string" || !ISSUE_TYPE_RE.test(issueType)) {
    throw invalid("issue_type must be a plain issue type name such as Task");
  }
  return {
    project,
    issueType,
    title: cleanTitle(input.title),
    body: cleanBody(input.body),
  };
}

/**
 * The Jira Cloud site Phoenix may write to: `https://<name>.atlassian.net`, no port, credentials,
 * path, query or fragment. Anything else (another host, a look-alike, http, an IP, loopback)
 * throws. The result carries no trailing slash.
 */
export function resolveJiraCloudSite(raw: unknown): string {
  const bad = () =>
    new TrackerError(
      "config",
      'Set config.create.jira_site to your Jira Cloud site, e.g. "https://yourcompany.atlassian.net" (https and *.atlassian.net only)',
    );
  if (typeof raw !== "string" || raw.length > 100 || !JIRA_CLOUD_SITE_RE.test(raw)) throw bad();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw bad();
  }
  if (
    url.protocol !== "https:" ||
    !JIRA_CLOUD_HOST.test(url.hostname) ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw bad();
  }
  return `https://${url.hostname}`;
}

/** `config.create.jira_site` of a stored configuration, or undefined when not set. */
export function createSiteFromConfig(config: Readonly<Record<string, unknown>>): unknown {
  const create = config.create;
  return isRecord(create) ? create.jira_site : undefined;
}

function checkSecret(value: string | undefined, name: string): string {
  if (value === undefined || value === "") {
    throw new TrackerError(
      "config",
      `No ${name} is set. Creating issues needs its own write credential; the polling credentials are never used for writing`,
    );
  }
  return value;
}

function unusable(name: string): TrackerError {
  return new TrackerError("config", `The ${name} is not a usable credential`);
}

/** A non-success reply with no usable body, as a fixed message. */
function statusFailure(tracker: string, res: HttpResult): TrackerError {
  const { status } = res;
  if (status === 401) {
    return new TrackerError(
      "auth",
      `${tracker} rejected the credentials (401); nothing was created`,
    );
  }
  if (status === 403) {
    return new TrackerError(
      "auth",
      `${tracker} refused the request (403); check the write credential's permissions. Nothing was created`,
    );
  }
  if (status === 429) {
    return new TrackerError(
      "rate_limit",
      `${tracker} rate limit reached; nothing was created`,
      retryAfterMs(res.headers),
    );
  }
  if (status >= 300 && status < 400) {
    return new TrackerError(
      "invalid_response",
      `${tracker} answered with a redirect, which is not followed; the issue may or may not have been created`,
    );
  }
  if (status >= 400 && status < 500) {
    return new TrackerError(
      "rejected",
      `${tracker} rejected the issue (HTTP ${status}); nothing was created`,
    );
  }
  return new TrackerError(
    "unavailable",
    `${tracker} answered HTTP ${status}; the issue may or may not have been created. Look in ${tracker} before trying again`,
  );
}

function unreadable(tracker: string): TrackerError {
  return new TrackerError(
    "invalid_response",
    `${tracker} answered with a reply Phoenix could not read; the issue may or may not have been created. Look in ${tracker} before trying again`,
  );
}

async function post(
  tracker: string,
  url: string,
  headers: Record<string, string>,
  body: string,
  options: CreateOptions,
): Promise<HttpResult> {
  const limits: HttpLimits = {
    timeoutMs: options.limits?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBytes: Math.min(
      options.limits?.maxBytes ?? MAX_CREATE_RESPONSE_BYTES,
      MAX_CREATE_RESPONSE_BYTES,
    ),
  };
  try {
    return await httpRequest(
      url,
      {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", ...headers },
        body,
      },
      limits,
      options.signal,
    );
  } catch {
    // Timeout, dropped connection, refused redirect, oversized reply, cancelled: the request may
    // have been processed. The transport's own text is dropped; only fixed text goes on.
    throw new TrackerError(
      "unavailable",
      `${tracker} did not answer in time, the connection dropped, or the reply was refused (redirect or too large); the issue may or may not have been created. Look in ${tracker} before trying again`,
    );
  }
}

/** `https://linear.app/<workspace>/issue/<IDENTIFIER>[/<slug>]`, rebuilt from its parts. */
function linearIssueUrl(raw: unknown, identifier: string): string | undefined {
  if (typeof raw !== "string" || raw.length > 500) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== LINEAR_WEB_HOST ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return undefined;
  }
  const parts = url.pathname.split("/");
  // ["", workspace, "issue", IDENTIFIER, slug?]
  if (parts.length < 4 || parts.length > 5 || parts[0] !== "") return undefined;
  const [, workspace, issue, id, slug] = parts;
  if (!LINEAR_WORKSPACE.test(workspace ?? "") || issue !== "issue") return undefined;
  if (id !== identifier) return undefined;
  if (slug !== undefined && !/^[A-Za-z0-9_-]{0,200}$/.test(slug)) return undefined;
  return `https://${LINEAR_WEB_HOST}/${workspace}/issue/${id}${slug ? `/${slug}` : ""}`;
}

function parseLinearCreated(body: unknown): CreatedIssue | undefined {
  const data = isRecord(body) ? body.data : undefined;
  const result = isRecord(data) ? data.issueCreate : undefined;
  if (!isRecord(result) || result.success !== true || !isRecord(result.issue)) return undefined;
  const { id, identifier, url } = result.issue;
  if (typeof id !== "string" || !LINEAR_NODE_ID.test(id)) return undefined;
  if (typeof identifier !== "string" || !LINEAR_IDENTIFIER.test(identifier)) return undefined;
  const link = linearIssueUrl(url, identifier);
  if (link === undefined) return undefined;
  return { tracker: "linear", id, key: identifier, url: link };
}

/** A GraphQL `errors` array as a fixed message; what Linear wrote in it is never shown. */
function linearErrors(status: number, errors: readonly unknown[]): TrackerError {
  const first = errors[0];
  const ext = isRecord(first) && isRecord(first.extensions) ? first.extensions : {};
  const code = typeof ext.code === "string" ? ext.code.toUpperCase() : "";
  if (code === "RATELIMITED") {
    return new TrackerError("rate_limit", "Linear rate limit reached; nothing was created", 60_000);
  }
  if (code.includes("AUTHENTICATION") || code === "FORBIDDEN" || status === 401 || status === 403) {
    return new TrackerError(
      "auth",
      "Linear rejected the write key or it may not create issues; nothing was created",
    );
  }
  return new TrackerError(
    "rejected",
    "Linear reported an error for the request (its text is not shown); no issue was reported as created. Look in Linear before trying again",
  );
}

export async function createLinearIssue(
  input: unknown,
  options: CreateOptions,
): Promise<CreatedIssue> {
  const { teamId, title, body } = parseLinearInput(input);
  const key = checkSecret(await options.secret(LINEAR_WRITE_KEY_SECRET), LINEAR_WRITE_KEY_SECRET);
  if (!SECRET_VALUE.test(key)) throw unusable(LINEAR_WRITE_KEY_SECRET);
  const res = await post(
    "Linear",
    LINEAR_CREATE_ENDPOINT,
    // Personal API keys go in the header as-is, without a "Bearer" prefix.
    { authorization: key },
    JSON.stringify({
      query: LINEAR_CREATE_MUTATION,
      variables: { input: { teamId, title, ...(body !== undefined ? { description: body } : {}) } },
    }),
    options,
  );
  const ok = res.status >= 200 && res.status < 300;
  let parsed: unknown;
  try {
    parsed = parseJson(res.body, "Linear");
  } catch {
    throw ok ? unreadable("Linear") : statusFailure("Linear", res);
  }
  const errors = isRecord(parsed) && Array.isArray(parsed.errors) ? parsed.errors : undefined;
  if (errors?.length) throw linearErrors(res.status, errors);
  if (!ok) throw statusFailure("Linear", res);
  const created = parseLinearCreated(parsed);
  if (!created) throw unreadable("Linear");
  return created;
}

/** The ADF document Jira Cloud v3 wants for a description: paragraphs of text and hard breaks. */
export function jiraDescription(text: string): Record<string, unknown> {
  const content = text
    .split(/\n{2,}/)
    .map((paragraph) => {
      const nodes: Record<string, unknown>[] = [];
      paragraph.split("\n").forEach((line, i) => {
        if (i > 0) nodes.push({ type: "hardBreak" });
        if (line.length > 0) nodes.push({ type: "text", text: line });
      });
      return nodes;
    })
    .filter((nodes) => nodes.some((n) => n.type === "text"))
    .map((nodes) => ({ type: "paragraph", content: nodes }));
  return { type: "doc", version: 1, content };
}

function parseJiraCreated(body: unknown, site: string, project: string): CreatedIssue | undefined {
  if (!isRecord(body)) return undefined;
  const { id, key } = body;
  if (typeof id !== "string" || !JIRA_ISSUE_ID.test(id)) return undefined;
  if (typeof key !== "string" || !JIRA_ISSUE_KEY.test(key) || !key.startsWith(`${project}-`)) {
    return undefined;
  }
  // The link is built from the pinned site and the validated key; the reply's own `self` is ignored.
  return { tracker: "jira", id, key, url: `${site}/browse/${key}` };
}

export async function createJiraIssue(
  input: unknown,
  options: JiraCreateOptions,
): Promise<CreatedIssue> {
  const { project, issueType, title, body } = parseJiraInput(input);
  const site = resolveJiraCloudSite(options.site);
  const email = checkSecret(await options.secret(JIRA_WRITE_EMAIL_SECRET), JIRA_WRITE_EMAIL_SECRET);
  const token = checkSecret(await options.secret(JIRA_WRITE_TOKEN_SECRET), JIRA_WRITE_TOKEN_SECRET);
  if (!EMAIL.test(email)) throw unusable(JIRA_WRITE_EMAIL_SECRET);
  if (!SECRET_VALUE.test(token)) throw unusable(JIRA_WRITE_TOKEN_SECRET);
  const res = await post(
    "Jira",
    `${site}/rest/api/3/issue`,
    { authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}` },
    JSON.stringify({
      fields: {
        project: { key: project },
        issuetype: { name: issueType },
        summary: title,
        ...(body !== undefined ? { description: jiraDescription(body) } : {}),
      },
    }),
    options,
  );
  if (res.status !== 201) {
    // A 2xx other than 201 is not what Jira documents: do not guess, say it could not be read.
    if (res.status >= 200 && res.status < 300) throw unreadable("Jira");
    throw statusFailure("Jira", res);
  }
  let parsed: unknown;
  try {
    parsed = parseJson(res.body, "Jira");
  } catch {
    throw unreadable("Jira");
  }
  const created = parseJiraCreated(parsed, site, project);
  if (!created) throw unreadable("Jira");
  return created;
}
