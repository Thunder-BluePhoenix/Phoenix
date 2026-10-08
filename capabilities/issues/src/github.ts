// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// GitHub Issues provider (REST v3). Deliberately shares no code with the `github` capability:
// that one watches pull requests and CI, this one watches issues assigned to the user.
import { resolveBase, retryAfterMs, statusError, MAX_RETRY_AFTER_MS, type HttpResult } from "./http";
import { PAGE_SIZE, ProviderBase, type ProviderOptions } from "./provider-base";
import {
  TrackerError,
  type IssueCategory,
  type IssueProvider,
  type RawIssueChange,
} from "./types";
import { MAX_STATUS, MAX_TITLE, isRecord, parseJson, safeUrl, sanitiseText, toIso } from "./validate";

export const GITHUB_API = "https://api.github.com";
export const REPO_PATTERN = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const SINCE_OVERLAP_MS = 1000;

export interface GithubConfig {
  repositories: string[];
  /** Whose issues count as "mine" when no token is available to ask GitHub. */
  login?: string;
  apiUrl?: string;
}

/** GitHub state (+ state_reason) → Phoenix status name and category. */
export function normaliseGithubStatus(
  state: string,
  reason: string | undefined,
): { status: string; category: IssueCategory } {
  if (state === "open") return { status: "open", category: "open" };
  if (reason === "not_planned" || reason === "duplicate") {
    return { status: `closed (${reason.replace("_", " ")})`, category: "cancelled" };
  }
  return { status: "closed", category: "done" };
}

/**
 * One element of GET /repos/{owner}/{repo}/issues as a change, or undefined when it is not
 * a usable issue. Pull requests share this endpoint and are dropped.
 */
export function parseGithubIssue(
  raw: unknown,
  repo: string,
  login: string,
): RawIssueChange | undefined {
  if (!isRecord(raw) || "pull_request" in raw) return undefined;
  const number = raw.number;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) return undefined;
  const title = sanitiseText(raw.title, MAX_TITLE);
  const url = safeUrl(raw.html_url);
  const updatedAt = toIso(raw.updated_at);
  const state = raw.state;
  if (title === undefined || url === undefined || updatedAt === undefined) return undefined;
  if (state !== "open" && state !== "closed") return undefined;
  const reason = typeof raw.state_reason === "string" ? raw.state_reason : undefined;
  const { status, category } = normaliseGithubStatus(state, reason);
  const assignees = Array.isArray(raw.assignees) ? raw.assignees : [];
  const me = login.toLowerCase();
  const assignedToMe = assignees.some(
    (a) => isRecord(a) && typeof a.login === "string" && a.login.toLowerCase() === me,
  );
  return {
    tracker: "github",
    key: `${repo}#${number}`,
    title,
    url,
    status: status.slice(0, MAX_STATUS),
    category,
    assignedToMe,
    updatedAt,
    ref: `${repo}#${number}`,
  };
}

/** The rel="next" URL of a Link header, or undefined. */
export function nextLink(header: string | null): string | undefined {
  if (header === null || header.length > 2000) return undefined;
  for (const part of header.split(",")) {
    const m = /^\s*<([^>]+)>\s*;\s*rel="next"\s*$/.exec(part);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

/** How long GitHub says to wait, measured on GitHub's clock (the Date header). */
export function githubRateLimitWait(headers: Headers): number | undefined {
  const explicit = retryAfterMs(headers);
  if (explicit !== undefined) return explicit;
  if (headers.get("x-ratelimit-remaining") !== "0") return undefined;
  const reset = Number(headers.get("x-ratelimit-reset"));
  const now = Date.parse(headers.get("date") ?? "");
  if (!Number.isFinite(reset) || !Number.isFinite(now)) return MAX_RETRY_AFTER_MS;
  return Math.min(Math.max(reset * 1000 - now, 1000), MAX_RETRY_AFTER_MS);
}

export class GithubProvider extends ProviderBase implements IssueProvider {
  readonly id = "github";
  private login: string | undefined;
  private authenticated = false;

  constructor(
    private readonly config: GithubConfig,
    options: ProviderOptions,
  ) {
    super(options);
  }

  private base(): string {
    return resolveBase(this.config.apiUrl ?? GITHUB_API, "GitHub api_url");
  }

  private async get(
    url: string,
    token: string | undefined,
    signal: AbortSignal,
  ): Promise<HttpResult> {
    const res = await this.send(
      url,
      {
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "Phoenix-issues-capability",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      },
      signal,
    );
    if (res.status >= 200 && res.status < 300) return res;
    if (res.status === 403 || res.status === 429) {
      const wait = githubRateLimitWait(res.headers);
      if (wait !== undefined) {
        throw new TrackerError("rate_limit", "GitHub rate limit reached", wait);
      }
    }
    if (res.status === 404) {
      throw new TrackerError("unavailable", "GitHub: repository not found or not accessible");
    }
    throw statusError("GitHub", res);
  }

  private async me(token: string | undefined, signal: AbortSignal): Promise<string> {
    if (this.login !== undefined) return this.login;
    if (token) {
      const res = await this.get(`${this.base()}/user`, token, signal);
      const body = parseJson(res.body, "GitHub");
      const login = isRecord(body) ? body.login : undefined;
      if (typeof login !== "string" || !LOGIN_PATTERN.test(login)) {
        throw new TrackerError("invalid_response", "GitHub /user returned no usable login");
      }
      this.login = login;
      return login;
    }
    const configured = this.config.login;
    if (configured === undefined || !LOGIN_PATTERN.test(configured)) {
      throw new TrackerError(
        "config",
        "Set a GitHub token (secret github_token) or github_login so Phoenix knows which issues are yours",
      );
    }
    this.login = configured;
    return configured;
  }

  async poll(since: string | undefined, signal: AbortSignal): Promise<RawIssueChange[]> {
    if (this.config.repositories.length === 0) {
      throw new TrackerError("config", "No GitHub repositories are configured");
    }
    const token = (await this.secret("github_token")) || undefined;
    this.authenticated = token !== undefined;
    const login = await this.me(token, signal);
    const base = this.base();
    const sinceParam =
      since === undefined
        ? undefined
        : new Date(Date.parse(since) - SINCE_OVERLAP_MS).toISOString();
    const changes: RawIssueChange[] = [];
    let truncated = false;
    let skipped = 0;
    for (const repo of this.config.repositories) {
      // First poll: only my open issues, newest first. Later polls: everything touched since
      // the cursor (oldest first, so a cut-off page resumes where it stopped) because an
      // issue that was just unassigned from me no longer matches an assignee filter.
      const params =
        sinceParam === undefined
          ? `state=open&assignee=${encodeURIComponent(login)}&sort=updated&direction=desc`
          : `state=all&since=${encodeURIComponent(sinceParam)}&sort=updated&direction=asc`;
      let url: string | undefined = `${base}/repos/${repo}/issues?${params}&per_page=${PAGE_SIZE}`;
      for (let page = 0; url !== undefined; page++) {
        if (page >= this.maxPages) {
          truncated = true;
          break;
        }
        const res = await this.get(url, token, signal);
        const body = parseJson(res.body, "GitHub");
        if (!Array.isArray(body)) {
          throw new TrackerError("invalid_response", "GitHub returned an unexpected issue list");
        }
        for (const item of body) {
          const change = parseGithubIssue(item, repo, login);
          if (change) changes.push(change);
          else if (isRecord(item) && !("pull_request" in item)) skipped++;
        }
        url = this.sameOrigin(nextLink(res.headers.get("link")), base);
      }
    }
    const notes: string[] = [];
    if (!this.authenticated) notes.push("no token: 60 requests/hour, public repositories only");
    if (truncated) notes.push(`more than ${this.maxPages} pages; the rest follows on the next poll`);
    if (skipped > 0) notes.push(`${skipped} malformed issue(s) ignored`);
    this.setNote(notes.length ? notes.join("; ") : undefined);
    return changes;
  }

  /** Pagination links are followed only when they stay on the configured API host. */
  private sameOrigin(link: string | undefined, base: string): string | undefined {
    if (link === undefined) return undefined;
    try {
      return new URL(link).origin === new URL(base).origin ? link : undefined;
    } catch {
      return undefined;
    }
  }
}
