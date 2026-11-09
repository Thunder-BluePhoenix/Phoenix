// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// `jira.issue.attach` and `linear.issue.attach` (Phase 85): attach ONE image to an issue that
// already exists. Two separate `external` commands, so Core confirms every call and its card names
// the tracker (the command), the issue key, the file name, the byte size and a content-hash prefix.
// GitHub has no command here on purpose: GitHub offers no documented REST endpoint for uploading an
// image to an issue, and Phoenix does not use the undocumented upload endpoints the web UI uses.
//
// Safety properties, each pinned by a test in test/attach.test.ts:
//   * The image arrives only as base64 and must be a whole PNG of at most 5 MiB, checked with the
//     same `inspectPng` the capture adapter uses (signature, IHDR, dimensions, IEND). Nothing else
//     (JPEG, a path, a URL) is accepted.
//   * The file name is generated, never taken from the caller: `phoenix-screenshot-<sha256[0..12]>.png`.
//     The input carries `file_name`, `bytes` and `sha256_prefix` ONLY so the confirmation card can
//     show them; each is recomputed from the decoded image and a mismatch refuses the call before any
//     request, so the card cannot describe a different file than the one sent.
//   * Same write-only credentials as `*.issue.create` (`jira_write_*`, `linear_write_key`); the
//     polling credentials are never used. Jira is pinned to the owner-set `*.atlassian.net` site;
//     Linear to `https://api.linear.app/graphql`.
//   * Linear's upload goes to a signed URL Linear returns. It is accepted only when it is https, has
//     no credentials, port or fragment, and its host is Google Cloud Storage (`storage.googleapis.com`
//     or `<bucket>.storage.googleapis.com`), the storage the Linear SDK documents for uploads. The
//     headers Linear returns are accepted only from a short allow-list. The signed URL is used for the
//     single PUT and is never logged, returned or put in an error. Our credential is NOT sent to it.
//   * No redirects, timeouts, replies capped at 256 KiB, fixed secret-free errors that never contain
//     anything the remote side wrote. After a request was sent, a failure says the outcome is unknown.
import { createHash, randomBytes } from "node:crypto";
import { inspectPng, MAX_IMAGE_BYTES } from "@phoenix/capability-screen-region";
import { DEFAULT_TIMEOUT_MS, httpRequest, retryAfterMs, type HttpResult } from "./http";
import {
  checkSecret,
  EMAIL,
  invalid,
  JIRA_ISSUE_KEY,
  JIRA_WRITE_EMAIL_SECRET,
  JIRA_WRITE_TOKEN_SECRET,
  LINEAR_CREATE_ENDPOINT,
  LINEAR_IDENTIFIER,
  LINEAR_WRITE_KEY_SECRET,
  MAX_CREATE_RESPONSE_BYTES,
  onlyKeys,
  resolveJiraCloudSite,
  SECRET_VALUE,
  unusable,
  type CreateOptions,
  type JiraCreateOptions,
} from "./create";
import { TrackerError, type HttpLimits } from "./types";
import { isRecord, parseJson } from "./validate";

/** The image cap, the same as the capture adapter and the page. */
export const MAX_ATTACH_BYTES = MAX_IMAGE_BYTES;
/** Base64 of the cap (4 characters per 3 bytes, padded). */
export const MAX_ATTACH_BASE64 = Math.ceil(MAX_ATTACH_BYTES / 3) * 4;
/** The PUT may carry 5 MiB, so it gets longer than a JSON call. */
export const UPLOAD_TIMEOUT_MS = 30_000;

export const ATTACH_NAME_PATTERN = "^phoenix-screenshot-[0-9a-f]{12}\\.png$";
export const ATTACH_HASH_PATTERN = "^[0-9a-f]{12}$";
const ATTACH_NAME = new RegExp(ATTACH_NAME_PATTERN);
const ATTACH_HASH = new RegExp(ATTACH_HASH_PATTERN);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export const LINEAR_ISSUE_LOOKUP = `query PhoenixIssueLookup($id: String!) {
  issue(id: $id) { id identifier }
}`;
export const LINEAR_FILE_UPLOAD_MUTATION = `mutation PhoenixFileUpload($contentType: String!, $filename: String!, $size: Int!) {
  fileUpload(contentType: $contentType, filename: $filename, size: $size) {
    success
    uploadFile { uploadUrl assetUrl headers { key value } }
  }
}`;
export const LINEAR_ATTACHMENT_MUTATION = `mutation PhoenixAttachmentCreate($input: AttachmentCreateInput!) {
  attachmentCreate(input: $input) { success }
}`;

const LINEAR_NODE_ID = /^[A-Za-z0-9-]{1,64}$/;
const LINEAR_ASSET_HOST = "uploads.linear.app";
const GCS_HOST = "storage.googleapis.com";
/** One bucket label only: a dotted bucket would be a nested host and has no valid TLS name. */
const GCS_BUCKET_HOST = /^[a-z0-9][a-z0-9_-]{1,61}[a-z0-9]\.storage\.googleapis\.com$/;
/** The URL parser resolves `/../` before we could look; refuse the raw text instead. */
const DOT_SEGMENT = /\/\.\.?(?:[/?#]|$)/;
const MAX_SIGNED_URL = 4096;
export const JIRA_ISSUE_KEY_PATTERN = "^[A-Z][A-Z0-9_]{0,49}-\\d{1,9}$";
export const LINEAR_IDENTIFIER_PATTERN = "^[A-Za-z][A-Za-z0-9]{0,15}-\\d{1,9}$";

/**
 * The input schema of both attach commands. `issue`, `file_name`, `bytes` and `sha256_prefix` are
 * flagged so Core's confirmation card shows them; the image itself is not shown (a card cannot
 * render it) and is bound to the card by the hash prefix and size, which are recomputed on the bytes.
 */
export function attachSchema(issuePattern: string): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["issue", "image_base64", "bytes", "sha256_prefix", "file_name"],
    properties: {
      issue: { type: "string", pattern: issuePattern, "x-phoenix-confirm": true },
      file_name: { type: "string", pattern: ATTACH_NAME_PATTERN, "x-phoenix-confirm": true },
      bytes: {
        type: "integer",
        minimum: 1,
        maximum: MAX_ATTACH_BYTES,
        "x-phoenix-confirm": true,
      },
      sha256_prefix: { type: "string", pattern: ATTACH_HASH_PATTERN, "x-phoenix-confirm": true },
      image_base64: { type: "string", minLength: 1, maxLength: MAX_ATTACH_BASE64 },
    },
  };
}
const MAX_UPLOAD_HEADERS = 12;
/** Headers a Google Cloud Storage signed PUT can name; anything else Linear returns is refused. */
const UPLOAD_HEADER_NAME =
  /^(content-type|cache-control|content-disposition|content-md5|x-goog-[a-z0-9-]{1,60})$/;
// eslint-disable-next-line no-control-regex
const HEADER_VALUE = /^[\x20-\x7e]{1,1024}$/;

export interface AttachInput {
  issue: string;
  image_base64: string;
  bytes: number;
  sha256_prefix: string;
  file_name: string;
}

export interface Attached {
  tracker: "linear" | "jira";
  issue: string;
  file_name: string;
  bytes: number;
  sha256_prefix: string;
  attached: true;
}

export interface PreparedImage {
  issue: string;
  png: Buffer;
  fileName: string;
  hashPrefix: string;
}

/**
 * Checks the input and the image. `issuePattern` is the tracker's key shape. The confirmation-only
 * fields are recomputed from the image; any difference refuses the call.
 */
export function prepareAttachment(input: unknown, issuePattern: RegExp): PreparedImage {
  if (!isRecord(input)) throw invalid("Input must be an object");
  onlyKeys(input, ["issue", "image_base64", "bytes", "sha256_prefix", "file_name"]);
  const { issue, image_base64: image, bytes, sha256_prefix: prefix, file_name: name } = input;
  if (typeof issue !== "string" || !issuePattern.test(issue))
    throw invalid("issue is not a valid key");
  if (typeof image !== "string" || image.length === 0) throw invalid("image_base64 must be text");
  if (image.length > MAX_ATTACH_BASE64) throw invalid("The image is larger than 5 MiB");
  if (image.length % 4 !== 0 || !BASE64.test(image)) throw invalid("image_base64 is not base64");
  const png = Buffer.from(image, "base64");
  if (png.length > MAX_ATTACH_BYTES) throw invalid("The image is larger than 5 MiB");
  try {
    inspectPng(png);
  } catch {
    throw invalid("The image is not a valid PNG");
  }
  const hashPrefix = createHash("sha256").update(png).digest("hex").slice(0, 12);
  const fileName = `phoenix-screenshot-${hashPrefix}.png`;
  if (
    bytes !== png.length ||
    typeof prefix !== "string" ||
    !ATTACH_HASH.test(prefix) ||
    prefix !== hashPrefix ||
    typeof name !== "string" ||
    !ATTACH_NAME.test(name) ||
    name !== fileName
  ) {
    throw invalid(
      "The confirmed size, hash or file name does not match the image; nothing was sent",
    );
  }
  return { issue, png, fileName, hashPrefix };
}

function result(tracker: "linear" | "jira", p: PreparedImage): Attached {
  return {
    tracker,
    issue: p.issue,
    file_name: p.fileName,
    bytes: p.png.length,
    sha256_prefix: p.hashPrefix,
    attached: true,
  };
}

/** A non-success reply as a fixed message; what the tracker wrote is never shown. */
function statusFailure(tracker: string, res: HttpResult): TrackerError {
  const { status } = res;
  if (status === 401) {
    return new TrackerError(
      "auth",
      `${tracker} rejected the credentials (401); nothing was attached`,
    );
  }
  if (status === 403) {
    return new TrackerError(
      "auth",
      `${tracker} refused the request (403); check the write credential's permissions. Nothing was attached`,
    );
  }
  if (status === 404) {
    return new TrackerError(
      "rejected",
      `${tracker} could not find that issue, or the account cannot see it (404); nothing was attached`,
    );
  }
  if (status === 413) {
    return new TrackerError(
      "rejected",
      `${tracker} refused the image as too large (413); nothing was attached`,
    );
  }
  if (status === 429) {
    return new TrackerError(
      "rate_limit",
      `${tracker} rate limit reached; nothing was attached`,
      retryAfterMs(res.headers),
    );
  }
  if (status >= 300 && status < 400) {
    return new TrackerError(
      "invalid_response",
      `${tracker} answered with a redirect, which is not followed; the image may or may not have been attached`,
    );
  }
  if (status >= 400 && status < 500) {
    return new TrackerError(
      "rejected",
      `${tracker} rejected the image (HTTP ${status}); nothing was attached`,
    );
  }
  return new TrackerError(
    "unavailable",
    `${tracker} answered HTTP ${status}; the image may or may not have been attached. Look in ${tracker} before trying again`,
  );
}

const unreadable = (tracker: string) =>
  new TrackerError(
    "invalid_response",
    `${tracker} answered with a reply Phoenix could not read; the image may or may not have been attached. Look in ${tracker} before trying again`,
  );

async function send(
  tracker: string,
  url: string,
  init: { method: "POST" | "PUT"; headers: Record<string, string>; body: string | Uint8Array },
  options: CreateOptions,
  timeoutMs: number,
): Promise<HttpResult> {
  const limits: HttpLimits = {
    timeoutMs: options.limits?.timeoutMs ?? timeoutMs,
    maxBytes: Math.min(
      options.limits?.maxBytes ?? MAX_CREATE_RESPONSE_BYTES,
      MAX_CREATE_RESPONSE_BYTES,
    ),
  };
  try {
    return await httpRequest(url, init, limits, options.signal);
  } catch {
    // The transport's own text can hold the host or a signed URL: it is dropped, only fixed text goes on.
    throw new TrackerError(
      "unavailable",
      `${tracker} did not answer in time, the connection dropped, or the reply was refused (redirect or too large); the image may or may not have been attached. Look in ${tracker} before trying again`,
    );
  }
}

// ── Jira ────────────────────────────────────────────────────────────────────────────────────────

/** A multipart/form-data body with the one part Jira wants: a field named `file`. */
export function multipartBody(png: Uint8Array, fileName: string, boundary: string): Buffer {
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: image/png\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([head, png, tail]);
}

export async function attachJiraImage(
  input: unknown,
  options: JiraCreateOptions,
): Promise<Attached> {
  const prepared = prepareAttachment(input, JIRA_ISSUE_KEY);
  const site = resolveJiraCloudSite(options.site);
  const email = checkSecret(await options.secret(JIRA_WRITE_EMAIL_SECRET), JIRA_WRITE_EMAIL_SECRET);
  const token = checkSecret(await options.secret(JIRA_WRITE_TOKEN_SECRET), JIRA_WRITE_TOKEN_SECRET);
  if (!EMAIL.test(email)) throw unusable(JIRA_WRITE_EMAIL_SECRET);
  if (!SECRET_VALUE.test(token)) throw unusable(JIRA_WRITE_TOKEN_SECRET);
  const boundary = `phoenix-${randomBytes(16).toString("hex")}`;
  const res = await send(
    "Jira",
    `${site}/rest/api/3/issue/${prepared.issue}/attachments`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
        // Required by Jira, or the request is blocked as a possible cross-site forgery.
        "x-atlassian-token": "no-check",
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      body: multipartBody(prepared.png, prepared.fileName, boundary),
    },
    options,
    UPLOAD_TIMEOUT_MS,
  );
  if (res.status !== 200) {
    if (res.status >= 200 && res.status < 300) throw unreadable("Jira");
    throw statusFailure("Jira", res);
  }
  let parsed: unknown;
  try {
    parsed = parseJson(res.body, "Jira");
  } catch {
    throw unreadable("Jira");
  }
  // Jira documents an array with one entry per uploaded file; the entry's own text is not shown.
  const first = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : undefined;
  if (!isRecord(first) || typeof first.id !== "string" || !/^\d{1,18}$/.test(first.id)) {
    throw unreadable("Jira");
  }
  return result("jira", prepared);
}

// ── Linear ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The signed upload URL Linear returned, or undefined when it is not acceptable: https, a Google
 * Cloud Storage host, no credentials, port or fragment, a plain path and a bounded length. It is
 * returned as a string for the one PUT; callers never log it.
 */
export function validateUploadUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_SIGNED_URL) return undefined;
  // Control characters, spaces and backslashes are never part of a signed URL.
  if (/[^\x21-\x7e]|\\/.test(raw) || DOT_SEGMENT.test(raw)) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    (url.hostname !== GCS_HOST && !GCS_BUCKET_HOST.test(url.hostname))
  ) {
    return undefined;
  }
  if (url.pathname.split("/").some((part) => part === "." || part === "..")) return undefined;
  if (/%2e|%2f|%5c/i.test(url.pathname)) return undefined;
  return url.href;
}

/** Linear's permanent link for the stored file: https on its own asset host, a plain path. */
export function validateAssetUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 500) return undefined;
  if (DOT_SEGMENT.test(raw)) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== LINEAR_ASSET_HOST ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    !/^\/[A-Za-z0-9._~/-]{1,400}$/.test(url.pathname) ||
    url.pathname.split("/").some((part) => part === "." || part === "..")
  ) {
    return undefined;
  }
  return url.href;
}

/** The headers Linear says the PUT needs, kept only if every one is on the allow-list. */
export function validateUploadHeaders(raw: unknown): Record<string, string> | undefined {
  if (!Array.isArray(raw) || raw.length > MAX_UPLOAD_HEADERS) return undefined;
  const out: Record<string, string> = {};
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.key !== "string" || typeof entry.value !== "string") {
      return undefined;
    }
    const name = entry.key.toLowerCase();
    if (!UPLOAD_HEADER_NAME.test(name) || !HEADER_VALUE.test(entry.value)) return undefined;
    // The signature covers the content type: anything but the PNG type would not verify.
    if (name === "content-type" && entry.value.toLowerCase() !== "image/png") return undefined;
    out[name] = entry.value;
  }
  return out;
}

/** A GraphQL `errors` array as a fixed message. */
function graphqlFailure(res: HttpResult, errors: readonly unknown[]): TrackerError {
  const first = errors[0];
  const ext = isRecord(first) && isRecord(first.extensions) ? first.extensions : {};
  const code = typeof ext.code === "string" ? ext.code.toUpperCase() : "";
  if (code === "RATELIMITED") {
    return new TrackerError(
      "rate_limit",
      "Linear rate limit reached; nothing was attached",
      60_000,
    );
  }
  if (
    code.includes("AUTHENTICATION") ||
    code === "FORBIDDEN" ||
    res.status === 401 ||
    res.status === 403
  ) {
    return new TrackerError(
      "auth",
      "Linear rejected the write key or it may not attach files; nothing was attached",
    );
  }
  return new TrackerError(
    "rejected",
    "Linear reported an error for the request (its text is not shown); the image may or may not have been attached. Look in Linear before trying again",
  );
}

async function linearGraphql(
  query: string,
  variables: Record<string, unknown>,
  key: string,
  options: CreateOptions,
): Promise<Record<string, unknown>> {
  const res = await send(
    "Linear",
    LINEAR_CREATE_ENDPOINT,
    {
      method: "POST",
      // Personal API keys go in the header as-is, without a "Bearer" prefix.
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: key,
      },
      body: JSON.stringify({ query, variables }),
    },
    options,
    DEFAULT_TIMEOUT_MS,
  );
  const ok = res.status >= 200 && res.status < 300;
  let parsed: unknown;
  try {
    parsed = parseJson(res.body, "Linear");
  } catch {
    throw ok ? unreadable("Linear") : statusFailure("Linear", res);
  }
  const errors = isRecord(parsed) && Array.isArray(parsed.errors) ? parsed.errors : undefined;
  if (errors?.length) throw graphqlFailure(res, errors);
  if (!ok) throw statusFailure("Linear", res);
  const data = isRecord(parsed) ? parsed.data : undefined;
  if (!isRecord(data)) throw unreadable("Linear");
  return data;
}

export async function attachLinearImage(input: unknown, options: CreateOptions): Promise<Attached> {
  const prepared = prepareAttachment(input, LINEAR_IDENTIFIER);
  const key = checkSecret(await options.secret(LINEAR_WRITE_KEY_SECRET), LINEAR_WRITE_KEY_SECRET);
  if (!SECRET_VALUE.test(key)) throw unusable(LINEAR_WRITE_KEY_SECRET);

  // 1. Resolve the key to the issue's id; the id must come back with the same identifier.
  const lookup = await linearGraphql(LINEAR_ISSUE_LOOKUP, { id: prepared.issue }, key, options);
  const found = lookup.issue;
  if (
    !isRecord(found) ||
    typeof found.id !== "string" ||
    !LINEAR_NODE_ID.test(found.id) ||
    typeof found.identifier !== "string" ||
    found.identifier.toUpperCase() !== prepared.issue.toUpperCase()
  ) {
    throw new TrackerError(
      "rejected",
      "Linear could not find that issue, or the key cannot see it; nothing was attached",
    );
  }
  const issueId = found.id;

  // 2. Ask Linear for a signed upload URL.
  const upload = await linearGraphql(
    LINEAR_FILE_UPLOAD_MUTATION,
    { contentType: "image/png", filename: prepared.fileName, size: prepared.png.length },
    key,
    options,
  );
  const payload = upload.fileUpload;
  const file = isRecord(payload) && payload.success === true ? payload.uploadFile : undefined;
  if (!isRecord(file)) throw unreadable("Linear");
  const uploadUrl = validateUploadUrl(file.uploadUrl);
  const assetUrl = validateAssetUrl(file.assetUrl);
  const headers = validateUploadHeaders(file.headers);
  if (uploadUrl === undefined || assetUrl === undefined || headers === undefined) {
    throw new TrackerError(
      "invalid_response",
      "Linear returned an upload address or headers Phoenix does not accept; nothing was uploaded or attached",
    );
  }

  // 3. PUT the bytes to the signed URL. No credential of ours goes to this host.
  const put = await send(
    "Linear",
    uploadUrl,
    {
      method: "PUT",
      headers: {
        "cache-control": "public, max-age=31536000",
        ...headers,
        "content-type": "image/png",
      },
      body: prepared.png,
    },
    options,
    UPLOAD_TIMEOUT_MS,
  );
  if (put.status < 200 || put.status >= 300) {
    throw new TrackerError(
      put.status >= 400 && put.status < 500 ? "rejected" : "unavailable",
      `Linear's file storage did not accept the image (HTTP ${put.status}); nothing was attached`,
    );
  }

  // 4. Reference the stored file from the issue.
  const attached = await linearGraphql(
    LINEAR_ATTACHMENT_MUTATION,
    { input: { issueId, title: prepared.fileName, url: assetUrl } },
    key,
    options,
  );
  const made = attached.attachmentCreate;
  if (!isRecord(made) || made.success !== true) {
    throw new TrackerError(
      "rejected",
      "The image was uploaded to Linear's storage but Linear did not link it to the issue",
    );
  }
  return result("linear", prepared);
}
