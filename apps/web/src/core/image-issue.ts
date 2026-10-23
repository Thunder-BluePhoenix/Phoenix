// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 85, the reachable half of "screenshot to issue": an image the user ALREADY HAS (dropped,
// pasted or picked) next to a GitHub issue draft. There is no screen capture here.
//
// What this file decides, and what it leaves to Core:
//   * It reads the image through the same checks a dropped file gets (core/attachments.ts: name, the
//     5 MiB cap, PNG/JPEG only) and keeps it in this page's memory. The image is NEVER sent: the
//     github capability's `issue.create` takes text only, and the preview says so.
//   * It cleans the text the person typed (control and invisible characters, a typed
//     `phoenix-ref` marker), refuses text that looks like a secret, and builds the one command input
//     the preview shows. The same object is what is posted, so the preview is exactly the payload.
//   * It never decides the confirmation. Core's `issue.create` is an `external` command: Core asks
//     the person in Approvals, the UI only waits and reports the outcome.
import { findSecrets } from "../../../../protocol/src/secrets";
import { translate } from "../i18n/store";
import type { MessageKey, Vars } from "../i18n";
import {
  imageMime,
  readFile,
  type DroppedSource,
  type UploadOrigin,
  type UploadPayload,
} from "./attachments";
import { REPOSITORY_PATTERN } from "./handoff";
import type { CapabilityView } from "./types";

/** The same numbers as capabilities/github/src/issues.ts (MAX_ISSUE_TITLE, MAX_ISSUE_BODY). */
export const ISSUE_LIMITS = { titleChars: 256, bodyChars: 10_000 } as const;

export const GITHUB_CAPABILITY = "github";
export const ISSUE_COMMAND = "issue.create";
export const WRITE_TOKEN_SECRET = "write_token";

/** An image held in memory only; `base64` is the file's bytes, `mime` is PNG or JPEG. */
export interface IssueImage {
  name: string;
  mime: "image/png" | "image/jpeg";
  base64: string;
}

export type ImageRead = { ok: true; image: IssueImage } | { ok: false; message: string };

const HIDDEN_NAME = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** A file name that is safe to put in a sentence: hidden characters shown as ?, cut to 60. */
function plainName(name: string): string {
  const plain = name.replace(HIDDEN_NAME, "?");
  return plain.length > 60 ? `${plain.slice(0, 57)}...` : plain;
}

/**
 * Reads what was dropped or pasted into one image, or says why not, with the messages the file
 * drop already uses. More than one item, a folder or a non-image is refused (nothing is dropped
 * silently). Returns null when the drop held nothing at all.
 */
export async function readIssueImage(
  source: DroppedSource,
  origin: UploadOrigin,
): Promise<ImageRead | null> {
  const count = source.files.length + source.folders.length;
  if (count === 0) return null;
  if (count > 1) return { ok: false, message: translate("focus.issueDraft.oneImage") };
  const folder = source.folders[0];
  if (folder) {
    return {
      ok: false,
      message: translate("capture.attachments.file.unsupported", { name: plainName(folder.name) }),
    };
  }
  const file = source.files[0];
  if (!file) return null;
  const unsupported = {
    ok: false,
    message: translate("capture.attachments.file.unsupported", { name: plainName(file.name) }),
  } as const;
  if (imageMime(file) === null) return unsupported;
  const read: UploadPayload | string = await readFile(file, origin);
  if (typeof read === "string") return { ok: false, message: read };
  if (read.kind !== "image" || (read.mime !== "image/png" && read.mime !== "image/jpeg")) {
    return unsupported;
  }
  return { ok: true, image: { name: read.name, mime: read.mime, base64: read.content } };
}

/** An image as a data: address (the page's CSP allows img-src data:); only ever PNG or JPEG. */
export function imageSource(image: IssueImage): string {
  return `data:${image.mime};base64,${image.base64}`;
}

// ── Cleaning ────────────────────────────────────────────────────────────────────────────────────

/** A marker the github capability itself would strip; removed here so the preview matches. */
const MARKER_TEXT = /<!--\s*phoenix-ref:[^>]*-->/gi;
const FORMAT_CHARS = /\p{Cf}/gu;
const LINE_BREAKS = /\r\n?|[\u2028\u2029]/g;
// eslint-disable-next-line no-control-regex
const BODY_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const TITLE_SPACE = /[\p{Cc}\p{Zl}\p{Zp}\s]+/gu;

function withoutMarkers(text: string): string {
  let out = text;
  // Repeat: removing one marker must not leave another assembled from the pieces around it.
  for (let pass = 0; pass < 5; pass++) {
    const next = out.replace(MARKER_TEXT, "");
    if (next === out) return out;
    out = next;
  }
  return out.replace(/phoenix-ref:/gi, "phoenix-ref ");
}

/** One line: invisible characters removed, any run of whitespace or control characters a space. */
export function cleanTitle(text: string): string {
  return withoutMarkers(text.replace(FORMAT_CHARS, "").replace(TITLE_SPACE, " "))
    .replace(TITLE_SPACE, " ")
    .trim();
}

/** Several lines: invisible and control characters removed (tab and line breaks kept), then trimmed. */
export function cleanBody(text: string): string {
  return withoutMarkers(
    text.replace(FORMAT_CHARS, "").replace(LINE_BREAKS, "\n").replace(BODY_CONTROL, ""),
  ).trim();
}

// ── The draft ───────────────────────────────────────────────────────────────────────────────────

/** What `github` `issue.create` takes (capabilities/github input_schema); the body is left out when empty. */
export interface IssueCreateInput {
  repository: string;
  title: string;
  body?: string;
  idempotency_key: string;
}

/** A complete draft; `input` is what is posted to Core, byte for byte what the preview shows. */
export interface ImageIssueDraft {
  input: IssueCreateInput;
  image: IssueImage;
}

export interface DraftProblem {
  key: MessageKey;
  vars?: Vars;
}

export type DraftResult =
  { ok: true; draft: ImageIssueDraft } | { ok: false; problem: DraftProblem };

/** A fresh retry key: 16 to 80 letters, digits, _ or - (the capability's idempotency_key pattern). */
export function newIdempotencyKey(): string {
  return `image-issue-${crypto.randomUUID()}`;
}

/** Checks and cleans what was typed. Secret-looking text is refused, never sent or cut. */
export function buildImageIssueDraft(
  fields: { image: IssueImage | null; repository: string; title: string; body: string },
  idempotencyKey: string,
): DraftResult {
  const fail = (key: MessageKey, vars?: Vars): DraftResult => ({
    ok: false,
    problem: vars ? { key, vars } : { key },
  });
  if (!fields.image) return fail("focus.issueDraft.imageRequired");
  const repository = fields.repository.trim();
  if (!new RegExp(REPOSITORY_PATTERN).test(repository)) {
    return fail("handoff.attach.repositoryInvalid");
  }
  const title = cleanTitle(fields.title);
  const body = cleanBody(fields.body);
  if (title.length === 0) return fail("focus.issueDraft.titleRequired");
  if (title.length > ISSUE_LIMITS.titleChars) {
    return fail("focus.issueDraft.titleTooLong", { max: ISSUE_LIMITS.titleChars });
  }
  if (body.length > ISSUE_LIMITS.bodyChars) {
    return fail("focus.issueDraft.bodyTooLong", { max: ISSUE_LIMITS.bodyChars });
  }
  const inTitle = findSecrets(title, "$").length > 0;
  const inBody = findSecrets(body, "$").length > 0;
  if (inTitle && inBody) return fail("focus.issueDraft.secretInBoth");
  if (inTitle) return fail("focus.issueDraft.secretInTitle");
  if (inBody) return fail("focus.issueDraft.secretInBody");
  return {
    ok: true,
    draft: {
      input: {
        repository,
        title,
        ...(body ? { body } : {}),
        idempotency_key: idempotencyKey,
      },
      image: fields.image,
    },
  };
}

// ── What Core says about the github capability ──────────────────────────────────────────────────

/** Why `issue.create` cannot run now, or null when Core's own view says it can be asked. */
export function createUnavailable(capabilities: readonly CapabilityView[]): MessageKey | null {
  const github = capabilities.find((c) => c.id === GITHUB_CAPABILITY);
  if (github?.status !== "enabled" || !github.commands.some((c) => c.name === ISSUE_COMMAND)) {
    return "focus.issueDraft.unavailable.capability";
  }
  const token = github.secrets?.find((s) => s.name === WRITE_TOKEN_SECRET);
  return token?.set === true ? null : "focus.issueDraft.unavailable.token";
}

/** The repositories the user already watches with the github capability (valid owner/name only). */
export function watchedRepositories(capabilities: readonly CapabilityView[]): string[] {
  const list = capabilities.find((c) => c.id === GITHUB_CAPABILITY)?.config?.repositories;
  if (!Array.isArray(list)) return [];
  const pattern = new RegExp(REPOSITORY_PATTERN);
  return list.filter((r): r is string => typeof r === "string" && pattern.test(r));
}

export interface CreatedIssue {
  status: "created" | "existing";
  repository: string;
  number: number;
  url: string;
}

/** The capability's result, read defensively: anything that is not exactly this shape is null. */
export function readCreated(raw: unknown): CreatedIssue | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.status !== "created" && r.status !== "existing") return null;
  if (typeof r.repository !== "string" || typeof r.url !== "string") return null;
  if (typeof r.number !== "number" || !Number.isSafeInteger(r.number) || r.number < 1) return null;
  return { status: r.status, repository: r.repository, number: r.number, url: r.url };
}
