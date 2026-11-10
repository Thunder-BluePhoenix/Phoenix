// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// `pr.comment` (Phase 79): posts ONE comment on ONE pull request. It is the third command of this
// capability that WRITES to GitHub (after `issue.create` and `ci.rerun_failed`) and exists so a
// handoff note can be attached to a pull request after the user confirms it twice.
//
// Endpoint (GitHub REST, "Create an issue comment", read 2026-11-10; pull requests are issues, so
// the issue-comment endpoint is the documented way to comment on one):
//   POST https://api.github.com/repos/{owner}/{repo}/issues/{issue_number}/comments
//   https://docs.github.com/en/rest/issues/comments#create-an-issue-comment
// The page documents the body field `body` (required) and the statuses 201, 403, 404, 410 and 422
// (422 also for "the endpoint has been spammed"; "this endpoint triggers notifications"). The
// endpoint also accepts a plain issue number: Phoenix does NOT look up whether the number is a pull
// request, so the confirmation card, which names the number, is the only check. The 401, 429 and
// redirect mappings below are defensive choices, not taken from that page.
//
// Safety properties, each pinned by a test:
//   * It uses the same `write_token` secret as `issue.create` (a fine-grained token needs Issues or
//     Pull requests: read and write). The read `token` and `ci_write_token` are never used, and a
//     missing write token fails before any request.
//   * `external` in the manifest: the capability manager asks for confirmation on every call and the
//     policy engine rates it high risk. The card shows the repository, the pull request number, the
//     SHA-256 of the body and its length; the handler recomputes both and refuses a mismatch, so the
//     card cannot describe a different body than the one that is posted.
//   * The host is fixed to api.github.com. The capability's `api_url` setting is NOT honoured here,
//     so this credential cannot be pointed at another host.
//   * The body is at most 60000 characters, control characters are removed and secret-looking text
//     is masked with the logging redactor before anything leaves the machine.
//   * Redirects are refused, there is a 15 s timeout, the reply is capped at 256 KiB, and only the
//     comment id and an https github.com link, both validated, are returned.
//   * Every failure is a fixed message. Nothing from the request, the response or the credential is
//     ever put into an error.
//   * No automatic retry and nothing calls this command by itself. The POST is NOT idempotent:
//     confirming the same text twice posts two comments.
import { createHash } from "node:crypto";
import { redact } from "@phoenix/logging";
import { GithubError, readCapped } from "./client";
import { isRecord } from "./guards";
import { WRITE_TOKEN_RE, WRITE_TOKEN_SECRET } from "./issues";

export const PR_COMMENT_ORIGIN = "https://api.github.com";
export const PR_COMMENT_TIMEOUT_MS = 15_000;
export const PR_COMMENT_MAX_REPLY_BYTES = 256 * 1024;
export const MAX_PR_COMMENT_BODY = 60_000;
export const SHA256_PATTERN = "^[0-9a-f]{64}$";

const OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const REPO_RE = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;
const SHA256_RE = new RegExp(SHA256_PATTERN);
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const MAX_URL = 500;
const FIELDS = ["repository", "number", "body", "body_sha256", "body_chars"];

export interface PrCommentInput {
  repository: string;
  number: number;
  body: string;
  /** SHA-256 (hex) of `body` as given; shown on the confirmation card and re-checked here. */
  body_sha256: string;
  /** `body.length`; shown on the confirmation card and re-checked here. */
  body_chars: number;
}

export interface PrCommentResult {
  status: "commented";
  repository: string;
  number: number;
  id: number;
  html_url: string;
}

export interface PrCommentOptions {
  /** The `write_token` secret (undefined when the user never set one). */
  token: string | undefined;
  signal: AbortSignal;
}

const FAILURES: Readonly<Record<number, { kind: GithubError["kind"]; message: string }>> = {
  401: {
    kind: "auth",
    message: `GitHub rejected the ${WRITE_TOKEN_SECRET} (401): check that it is valid and not expired. Nothing was posted`,
  },
  403: {
    kind: "forbidden",
    message: `GitHub refused the comment (403): the ${WRITE_TOKEN_SECRET} needs Issues or Pull requests: read and write on this repository. Nothing was posted`,
  },
  404: {
    kind: "not_found",
    message: `GitHub could not find the repository or the pull request (404), or the ${WRITE_TOKEN_SECRET} cannot see it. Nothing was posted`,
  },
  410: { kind: "http", message: "The pull request is gone (410). Nothing was posted" },
  422: {
    kind: "http",
    message:
      "GitHub rejected the comment as invalid or as sent too fast (422). Nothing was posted; wait before trying again",
  },
  429: { kind: "rate_limit", message: "GitHub rate limit reached (429). Nothing was posted" },
};

const UNKNOWN_OUTCOME =
  "GitHub did not answer in time or the connection dropped; the comment may or may not have been posted. Check the pull request on GitHub before asking again";

/** SHA-256 (hex) of a comment body, the value the confirmation card shows. */
export function prCommentBodyHash(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/**
 * Strictly validates the input. Throws GithubError("invalid") with a fixed message; the rejected
 * value is never echoed.
 */
export function parsePrCommentInput(input: unknown): PrCommentInput & {
  owner: string;
  repo: string;
} {
  if (!isRecord(input)) throw new GithubError("invalid", "The input must be an object");
  for (const key of Object.keys(input)) {
    if (!FIELDS.includes(key)) {
      throw new GithubError("invalid", "The input has a field this command does not accept");
    }
  }
  const { repository, number, body, body_sha256: sha, body_chars: chars } = input;
  if (typeof repository !== "string" || repository.length > 140) {
    throw new GithubError("invalid", 'repository must be "owner/name"');
  }
  const parts = repository.split("/");
  const [owner, repo] = parts;
  if (
    parts.length !== 2 ||
    owner === undefined ||
    repo === undefined ||
    !OWNER_RE.test(owner) ||
    !REPO_RE.test(repo)
  ) {
    throw new GithubError("invalid", 'repository must be "owner/name"');
  }
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) {
    throw new GithubError("invalid", "number must be a positive integer");
  }
  if (typeof body !== "string" || body.length < 1 || body.length > MAX_PR_COMMENT_BODY) {
    throw new GithubError("invalid", `body must be 1 to ${MAX_PR_COMMENT_BODY} characters of text`);
  }
  if (typeof sha !== "string" || !SHA256_RE.test(sha) || sha !== prCommentBodyHash(body)) {
    throw new GithubError("invalid", "body_sha256 does not match the body");
  }
  if (typeof chars !== "number" || chars !== body.length) {
    throw new GithubError("invalid", "body_chars does not match the body");
  }
  return { repository, number, body, body_sha256: sha, body_chars: chars, owner, repo };
}

/** What GitHub receives: control characters removed, secret-looking text masked, then trimmed. */
export function prCommentPayload(body: string): { body: string } {
  const text = (redact(body) as string).replace(CONTROL, "").trim();
  if (text.length === 0) throw new GithubError("invalid", "The comment is empty");
  if (text.length > MAX_PR_COMMENT_BODY) {
    throw new GithubError("invalid", "The comment is too long once secrets are masked");
  }
  return { body: text };
}

/** The exact URL the POST goes to, built only from validated parts. */
export function prCommentUrl(owner: string, repo: string, number: number): string {
  return `${PR_COMMENT_ORIGIN}/repos/${owner}/${repo}/issues/${number}/comments`;
}

/** The comment page link, only if it is a plain https github.com pull request or issue address. */
function commentLink(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > MAX_URL || /\s/.test(value)) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    !/^\/[^/]+\/[^/]+\/(pull|issues)\/\d+$/.test(url.pathname) ||
    !/^(#issuecomment-\d+)?$/.test(url.hash)
  ) {
    return undefined;
  }
  return value;
}

/**
 * Posts one comment. Resolves only on a 201 whose reply names a comment id and a github.com link.
 * Throws GithubError with a fixed message otherwise. The caller must already hold the user's
 * confirmation.
 */
export async function postPrComment(
  input: unknown,
  options: PrCommentOptions,
): Promise<PrCommentResult> {
  const parsed = parsePrCommentInput(input);
  const { owner, repo, number } = parsed;
  const payload = prCommentPayload(parsed.body);
  const { token } = options;
  if (token === undefined || token === "") {
    throw new GithubError(
      "auth",
      `No ${WRITE_TOKEN_SECRET} is set. Commenting on a pull request needs a token with write access; the read token is never used for writing`,
    );
  }
  if (!WRITE_TOKEN_RE.test(token)) {
    throw new GithubError("auth", `The ${WRITE_TOKEN_SECRET} is not a usable token`);
  }
  let res: Response;
  try {
    res = await fetch(prCommentUrl(owner, repo, number), {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "phoenix-github-capability",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: AbortSignal.any([options.signal, AbortSignal.timeout(PR_COMMENT_TIMEOUT_MS)]),
    });
  } catch {
    throw new GithubError("network", UNKNOWN_OUTCOME);
  }
  if (res.status !== 201) {
    await res.body?.cancel().catch(() => {});
    if (res.status >= 300 && res.status < 400) {
      throw new GithubError("invalid", "GitHub answered with a redirect, which is not followed");
    }
    const known = FAILURES[res.status];
    if (known) throw new GithubError(known.kind, known.message);
    throw new GithubError(
      "http",
      res.status >= 500
        ? `GitHub answered HTTP ${res.status}; the comment may or may not have been posted. Check the pull request on GitHub before asking again`
        : `GitHub answered HTTP ${res.status}`,
    );
  }
  let id: number | undefined;
  let link: string | undefined;
  try {
    const reply: unknown = JSON.parse(
      await readCapped(res, PR_COMMENT_MAX_REPLY_BYTES, PR_COMMENT_TIMEOUT_MS),
    );
    if (isRecord(reply)) {
      if (typeof reply.id === "number" && Number.isSafeInteger(reply.id) && reply.id >= 1) {
        id = reply.id;
      }
      link = commentLink(reply.html_url);
    }
  } catch {
    id = undefined;
  }
  if (id === undefined || link === undefined) {
    throw new GithubError(
      "invalid",
      "GitHub answered 201 with a reply Phoenix could not read; the comment was probably posted. Check the pull request on GitHub before asking again",
    );
  }
  return { status: "commented", repository: `${owner}/${repo}`, number, id, html_url: link };
}
