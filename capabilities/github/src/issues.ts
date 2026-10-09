// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// `issue.create` (Phase 36): the one command of this capability that WRITES to GitHub. Everything
// else the capability does is GET only.
//
// Safety properties, each pinned by a test:
//   * It uses the secret `write_token`, never the read `token`: a read-only token set for polling
//     cannot enable writes, and a missing write token fails before any request is made.
//   * The command is declared `external` in the manifest, so the capability manager asks the user
//     for confirmation on every call, and the policy engine rates it high risk.
//   * Idempotent by a client-generated key. The key is embedded in the body as a hidden comment
//     (`<!-- phoenix-ref:KEY -->`) and BEFORE posting we look for an issue that already carries it:
//     first the newest issues of the repository (a plain list; strongly consistent), then GitHub's
//     search. If either finds it, nothing is created and the existing issue is returned.
//     CAVEAT (eventual consistency): GitHub's search index lags behind writes by seconds to
//     minutes and its tokenisation of the marker has NOT been verified against the real service
//     (this code was only ever run against a local mock). The recent-issues list is what makes an
//     immediate retry safe; a retry after the key has fallen out of the newest 30 issues depends on
//     the search. A lookup that fails is an error, never a reason to create anyway.
//   * The POST is never retried automatically. When the outcome is unknown (timeout, connection
//     dropped) the error says so and says that retrying with the same key is safe.
//   * Redirects are refused, responses are size-capped and validated (the issue number and an
//     https link), and the error text never contains the credential, the request or anything the
//     remote side wrote.
//   * Title, body and labels are secret-redacted before they leave the machine.
import { redact } from "@phoenix/logging";
import { GithubClient, GithubError, readCapped, type GithubFailureKind } from "./client";
import { isRecord } from "./guards";

export const WRITE_TOKEN_SECRET = "write_token";

export const MAX_ISSUE_TITLE = 256;
export const MAX_ISSUE_BODY = 10_000;
export const MAX_ISSUE_LABELS = 10;
export const MAX_LABEL = 50;
export const IDEMPOTENCY_KEY_PATTERN = "^[A-Za-z0-9_-]{16,80}$";
const IDEMPOTENCY_KEY_RE = new RegExp(IDEMPOTENCY_KEY_PATTERN);
const WRITE_TOKEN_RE = /^[\x21-\x7e]{8,255}$/;
const MAX_CREATE_RESPONSE_BYTES = 256 * 1024;
const LOOKUP_RESPONSE_BYTES = 4 * 1024 * 1024;
const RECENT_ISSUES = 30;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_URL = 500;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const MARKER_TEXT = /<!--\s*phoenix-ref:[^>]*-->/gi;

/** The marker that identifies an issue created for one idempotency key. */
export function issueMarker(key: string): string {
  return `<!-- phoenix-ref:${key} -->`;
}

export interface IssueInput {
  repository: string;
  title: string;
  body?: string;
  labels?: string[];
  idempotency_key: string;
}

export interface IssueResult {
  status: "created" | "existing";
  repository: string;
  number: number;
  url: string;
  idempotency_key: string;
}

export interface IssueOptions {
  baseUrl: string | undefined;
  /** The `write_token` secret (undefined when the user never set one). */
  token: string | undefined;
  signal: AbortSignal;
}

/** Redacts secret-looking text, removes control characters and any marker the user typed. */
function scrub(text: string): string {
  return (redact(text) as string).replace(CONTROL, "").replace(MARKER_TEXT, "");
}

/** The request body GitHub receives: only these fields, ever. */
export function issuePayload(input: IssueInput): {
  title: string;
  body: string;
  labels?: string[];
} {
  const title = scrub(input.title).replace(/\s+/g, " ").trim();
  if (title.length === 0) throw new GithubError("invalid", "The issue title is empty");
  const labels = (input.labels ?? [])
    .map((l) => scrub(l).replace(/\s+/g, " ").trim().slice(0, MAX_LABEL))
    .filter((l) => l.length > 0);
  const text = scrub(input.body ?? "").trim();
  const body = `${text}${text ? "\n\n" : ""}${issueMarker(input.idempotency_key)}`;
  return {
    title: title.slice(0, MAX_ISSUE_TITLE),
    body,
    ...(labels.length > 0 ? { labels } : {}),
  };
}

interface Found {
  number: number;
  url: string;
}

function issueLink(raw: Record<string, unknown>): Found | undefined {
  const { number, html_url: url } = raw;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) return undefined;
  if (typeof url !== "string" || url.length > MAX_URL || !/^https:\/\/[^\s]+$/.test(url)) {
    return undefined;
  }
  return { number, url };
}

/** The issue (not pull request) whose body carries `marker`. Junk entries are skipped. */
function withMarker(list: unknown, marker: string): Found | undefined {
  if (!Array.isArray(list)) throw new Error("unexpected shape");
  for (const raw of list) {
    if (!isRecord(raw) || "pull_request" in raw) continue;
    if (typeof raw.body !== "string" || !raw.body.includes(marker)) continue;
    const found = issueLink(raw);
    if (found) return found;
  }
  return undefined;
}

/** Looks for an issue that already carries the key. Throws on any lookup failure (fail closed). */
async function findExisting(
  http: GithubClient,
  repository: string,
  key: string,
): Promise<Found | undefined> {
  const marker = issueMarker(key);
  const recent = await http.get(
    `/repos/${repository}/issues?state=all&sort=created&direction=desc&per_page=${RECENT_ISSUES}`,
    (body) => withMarker(body, marker) ?? null,
  );
  if (recent.value) return recent.value;
  const query = encodeURIComponent(`"phoenix-ref:${key}" repo:${repository} in:body type:issue`);
  const searched = await http.get(
    `/search/issues?q=${query}&per_page=5`,
    (body) => withMarker(isRecord(body) ? body.items : undefined, marker) ?? null,
  );
  return searched.value ?? undefined;
}

const CREATE_FAILURES: Readonly<Record<number, { kind: GithubFailureKind; message: string }>> = {
  401: {
    kind: "auth",
    message: "GitHub rejected the write token (401): check that it is valid and not expired",
  },
  403: {
    kind: "forbidden",
    message:
      "GitHub refused to create the issue (403): the write token needs Issues: read and write on this repository",
  },
  404: {
    kind: "not_found",
    message: "GitHub could not find the repository (404), or the write token cannot see it",
  },
  410: { kind: "http", message: "Issues are disabled on this repository (410)" },
  422: { kind: "http", message: "GitHub rejected the issue as invalid (422)" },
  429: { kind: "rate_limit", message: "GitHub rate limit reached (429); nothing was created" },
};

const UNKNOWN_OUTCOME =
  "GitHub did not answer in time or the connection dropped; the issue may or may not have been created. Retry with the same idempotency_key: it finds the issue if it exists";

export async function createIssue(input: IssueInput, options: IssueOptions): Promise<IssueResult> {
  if (!IDEMPOTENCY_KEY_RE.test(input.idempotency_key)) {
    throw new GithubError("invalid", "idempotency_key must be 16-80 letters, digits, _ or -");
  }
  if (options.token === undefined || options.token === "") {
    throw new GithubError(
      "auth",
      `No ${WRITE_TOKEN_SECRET} is set. Creating issues needs its own token with write access; the read token is never used for writing`,
    );
  }
  if (!WRITE_TOKEN_RE.test(options.token)) {
    throw new GithubError("auth", `The ${WRITE_TOKEN_SECRET} is not a usable token`);
  }
  const payload = issuePayload(input);
  const { repository, idempotency_key: key } = input;
  const http = new GithubClient({
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    token: options.token,
    signal: options.signal,
    maxBytes: LOOKUP_RESPONSE_BYTES,
  });

  const existing = await findExisting(http, repository, key);
  if (existing) {
    return {
      status: "existing",
      repository,
      number: existing.number,
      url: existing.url,
      idempotency_key: key,
    };
  }

  const baseUrl = (options.baseUrl ?? "https://api.github.com").replace(/\/$/, "");
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/repos/${repository}/issues`, {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "phoenix-github-capability",
        authorization: `Bearer ${options.token}`,
      },
      body: JSON.stringify(payload),
      redirect: "error",
      signal,
    });
  } catch {
    throw new GithubError("network", UNKNOWN_OUTCOME);
  }
  if (res.status !== 201) {
    await res.body?.cancel().catch(() => {});
    if (res.status >= 300 && res.status < 400) {
      throw new GithubError("invalid", "GitHub answered with a redirect, which is not followed");
    }
    const known = CREATE_FAILURES[res.status];
    if (known) throw new GithubError(known.kind, known.message);
    throw new GithubError(
      "http",
      res.status >= 500
        ? `GitHub answered HTTP ${res.status}; the issue may or may not have been created. Retry with the same idempotency_key`
        : `GitHub answered HTTP ${res.status}`,
    );
  }
  let created: Found | undefined;
  try {
    const parsed: unknown = JSON.parse(
      await readCapped(res, MAX_CREATE_RESPONSE_BYTES, REQUEST_TIMEOUT_MS),
    );
    created = isRecord(parsed) ? issueLink(parsed) : undefined;
  } catch {
    created = undefined;
  }
  if (!created) {
    throw new GithubError(
      "invalid",
      "GitHub answered 201 with a response Phoenix could not read; the issue was probably created. Retry with the same idempotency_key to find it",
    );
  }
  return {
    status: "created",
    repository,
    number: created.number,
    url: created.url,
    idempotency_key: key,
  };
}
