// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 62, web side: turning what the user drops into the bytes Core's POST /api/attachments takes,
// with the same caps Core enforces (core/api/src/attachment-routes.ts), and building the
// "draft email" link. Core never receives a filesystem path: the browser's File API produces the
// content here, and Core is told only a display name.
//
// What this file will NOT do, on purpose:
//   * read a file it cannot read, follow anything that does not look like a plain file or folder,
//     or descend into dot-directories, node_modules and .git;
//   * silently cut content: a file over a cap is skipped and the skip is reported to the user;
//   * send mail. A mailto: link opens the user's own mail app with a draft.
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./client";
import { useClient, useConnection } from "./context";
import type { MessageKey } from "../i18n";
import { translate } from "../i18n/store";
import { formatNumber } from "./format";

export const ATTACHMENTS_PATH = "/api/attachments";
/** Core publishes this (count only) whenever the set changes, including the emergency stop. */
export const ATTACHMENTS_EVENT = "attachments.changed";

/** The same numbers as core/runtime/src/attachments.ts ATTACHMENT_LIMITS. */
export const DROP_LIMITS = {
  textChars: 200_000,
  imageBytes: 5 * 1024 * 1024,
  folderEntries: 200,
  folderTextChars: 400_000,
  folderFileTextChars: 20_000,
  folderPathChars: 300,
  folderDepth: 8,
  nameChars: 120,
  askAttachments: 5,
} as const;

export type AttachmentKind = "text" | "image" | "folder";
export type AttachmentOrigin = "drop" | "window" | "paste";

export interface AttachmentSummary {
  id: string;
  name: string;
  kind: AttachmentKind;
  mime: string;
  origin: AttachmentOrigin;
  bytes: number;
  preview: string | null;
  files: number | null;
  created_at: string;
  expires_at: string;
}

export interface AttachmentDetail extends AttachmentSummary {
  content: string;
}

export interface AttachmentList {
  attachments: AttachmentSummary[];
  total_bytes: number;
  limits: { max_count: number; max_total_bytes: number; ttl_ms: number };
}

export interface AttachmentAnswer {
  answer: string;
  processed_by: string;
  model: string;
  provider: string;
  locality: "local" | "cloud";
  usage: { input_tokens: number | null; output_tokens: number | null } | null;
  cost: { amount: number; currency: "USD"; basis: "user-configured prices" } | null;
  vision_model: string | null;
  sources: { id: string; name: string }[];
}

/** The origins a page sends: a drop, or a paste. Origin `window` is posted only by the "Attach a window" accept button (core/window-capture.ts), never by an upload. */
export type UploadOrigin = Extract<AttachmentOrigin, "drop" | "paste">;

/** What POST /api/attachments takes. */
export interface UploadPayload {
  name: string;
  kind: AttachmentKind;
  mime: string;
  origin: UploadOrigin;
  content: string;
}

// ── What a drop hands us (structural, so tests can pass plain objects) ──────────────────────────

/** The slice of a File this file uses. */
export interface FileLike {
  name: string;
  size: number;
  type: string;
  text(): Promise<string>;
}

export interface EntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?(success: (file: FileLike) => void, failure: (error: unknown) => void): void;
  createReader?(): {
    readEntries(success: (entries: EntryLike[]) => void, failure: (error: unknown) => void): void;
  };
}

export interface DataTransferLike {
  files?: ArrayLike<FileLike> | null;
  items?: ArrayLike<{
    kind: string;
    getAsFile?(): FileLike | null;
    webkitGetAsEntry?(): EntryLike | null;
  }> | null;
  types?: ArrayLike<string> | null;
}

/** What `collectDropped` found, read synchronously inside the drop event (the browser clears it afterwards). */
export interface DroppedSource {
  files: FileLike[];
  folders: EntryLike[];
}

/** True while the user drags files (not text or a link) over the page. */
export function dragHasFiles(dt: DataTransferLike | null | undefined): boolean {
  return Array.from(dt?.types ?? []).includes("Files");
}

/**
 * Splits a drop into plain files and folders. MUST be called synchronously from the drop handler:
 * `webkitGetAsEntry` and `getAsFile` stop working once the event has been dispatched.
 */
export function collectDropped(dt: DataTransferLike): DroppedSource {
  const out: DroppedSource = { files: [], folders: [] };
  const items = Array.from(dt.items ?? []).filter((i) => i.kind === "file");
  if (items.length > 0) {
    for (const item of items) {
      const entry = item.webkitGetAsEntry?.() ?? null;
      if (entry?.isDirectory) out.folders.push(entry);
      else {
        const file = item.getAsFile?.() ?? null;
        if (file) out.files.push(file);
      }
    }
    return out;
  }
  out.files.push(...Array.from(dt.files ?? []));
  return out;
}

/**
 * Pasted plain text becomes an attachment only from this length: shorter text is an ordinary paste
 * into the box and is never intercepted. Longer than DROP_LIMITS.textChars is still taken, so the
 * refusal is the one a dropped file of that size gets.
 */
export const PASTE_TEXT_MIN_CHARS = 20_000;
/** The name Core shows for a pasted block of text. */
export const PASTE_TEXT_NAME = "pasted-text.txt";

/** The slice of a paste event's `clipboardData` this file reads. */
export interface ClipboardLike extends DataTransferLike {
  getData?(format: string): string;
}

/**
 * What a paste carries that is ours to take: its files (a screenshot or image, a copied file), or,
 * when the paste is NOT into an editable field and the text is long enough to be clearly an
 * attachment, that text as one text "file". Anything else returns null and the browser pastes as
 * usual. MUST be called synchronously from the paste handler, the only place the clipboard is read.
 */
export function collectPasted(
  cb: ClipboardLike | null | undefined,
  intoField: boolean,
): DroppedSource | null {
  if (!cb) return null;
  const files: FileLike[] = [];
  const items = Array.from(cb.items ?? []).filter((i) => i.kind === "file");
  if (items.length > 0) {
    for (const item of items) {
      const file = item.getAsFile?.() ?? null;
      if (file) files.push(file);
    }
  } else files.push(...Array.from(cb.files ?? []));
  if (files.length > 0) return { files, folders: [] };
  if (intoField) return null;
  const text = cb.getData?.("text/plain") ?? "";
  if (text.length < PASTE_TEXT_MIN_CHARS) return null;
  // `size` is a lower bound of the UTF-8 length; readFile checks the real length of the text.
  const file: FileLike = {
    name: PASTE_TEXT_NAME,
    type: "text/plain",
    size: text.length,
    text: () => Promise.resolve(text),
  };
  return { files: [file], folders: [] };
}

// ── Classification ──────────────────────────────────────────────────────────────────────────────

const TEXT_EXTENSIONS: Record<string, true> = Object.fromEntries(
  (
    "txt md markdown rst log csv tsv json jsonl yaml yml toml ini cfg conf xml html htm css scss " +
    "js mjs cjs jsx ts tsx py rb go rs java kt swift c h cc cpp hpp cs php sh bash zsh sql lua r pl " +
    "tex bib srt vtt diff patch"
  )
    .split(" ")
    .map((ext) => [ext, true] as const),
);
const TEXT_MIME = /^(text\/|application\/(json|xml|x-yaml|yaml|toml|javascript|x-sh|sql))/u;

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function isTextFile(file: Pick<FileLike, "name" | "type">): boolean {
  return TEXT_MIME.test(file.type) || Object.hasOwn(TEXT_EXTENSIONS, extensionOf(file.name));
}

/** The browser's word for the type; Core checks the bytes again and its answer is the one stored. */
export function imageMime(
  file: Pick<FileLike, "name" | "type">,
): "image/png" | "image/jpeg" | null {
  const ext = extensionOf(file.name);
  if (file.type === "image/png" || ext === "png") return "image/png";
  if (file.type === "image/jpeg" || ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return null;
}

// eslint-disable-next-line no-control-regex
const HIDDEN = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/u;

/** A name worth showing in a message: no hidden characters, not too long. */
export function shown(name: string): string {
  // eslint-disable-next-line no-control-regex
  const plain = name.replace(
    /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/gu,
    "?",
  );
  return plain.length > 60 ? `${plain.slice(0, 57)}...` : plain;
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────────

/** Base64 of a file, through FileReader (the data URL's payload). */
export async function readBase64(file: Blob): Promise<string> {
  const done = Promise.withResolvers<string>();
  const reader = new FileReader();
  reader.onload = () => {
    const url = typeof reader.result === "string" ? reader.result : "";
    const comma = url.indexOf(",");
    if (comma < 0) done.reject(new Error("unreadable"));
    else done.resolve(url.slice(comma + 1));
  };
  reader.onerror = () => done.reject(new Error("unreadable"));
  reader.readAsDataURL(file);
  return done.promise;
}

/** One dropped or pasted plain file: a payload, or the reason it was skipped. */
export async function readFile(
  file: FileLike,
  origin: UploadOrigin = "drop",
): Promise<UploadPayload | string> {
  const name = shown(file.name);
  if (file.name.length === 0 || file.name.length > DROP_LIMITS.nameChars || HIDDEN.test(file.name))
    return translate("capture.attachments.file.badName", { name });
  const image = imageMime(file);
  if (image) {
    if (file.size > DROP_LIMITS.imageBytes)
      return translate("capture.attachments.file.imageTooBig", { name });
    try {
      return {
        name: file.name,
        kind: "image",
        mime: image,
        origin,
        content: await readBase64(file as unknown as Blob),
      };
    } catch {
      return translate("capture.attachments.file.unreadable", { name });
    }
  }
  if (!isTextFile(file)) return translate("capture.attachments.file.unsupported", { name });
  // 4 bytes per character is the most UTF-8 can use, so anything bigger cannot fit under the cap.
  if (file.size > DROP_LIMITS.textChars * 4)
    return translate("capture.attachments.file.tooLargeBytes", {
      name,
      max: formatNumber(DROP_LIMITS.textChars),
    });
  let content: string;
  try {
    content = await file.text();
  } catch {
    return translate("capture.attachments.file.unreadable", { name });
  }
  if (content.length === 0) return translate("capture.attachments.file.empty", { name });
  if (content.length > DROP_LIMITS.textChars)
    return translate("capture.attachments.file.tooLarge", {
      name,
      chars: formatNumber(content.length),
      max: formatNumber(DROP_LIMITS.textChars),
    });
  return {
    name: file.name,
    kind: "text",
    mime: file.type || "text/plain",
    origin,
    content,
  };
}

/** Why a folder entry was skipped; each code has its own full message so word order can change. */
type SkipReason =
  | "unusualName"
  | "hidden"
  | "longPath"
  | "tooDeep"
  | "special"
  | "unreadableFile"
  | "unreadableFolder"
  | "longText";

const SKIP_MESSAGE: Record<SkipReason, MessageKey> = {
  unusualName: "capture.attachments.skip.unusualName",
  hidden: "capture.attachments.skip.hidden",
  longPath: "capture.attachments.skip.longPath",
  tooDeep: "capture.attachments.skip.tooDeep",
  special: "capture.attachments.skip.special",
  unreadableFile: "capture.attachments.skip.unreadableFile",
  unreadableFolder: "capture.attachments.skip.unreadableFolder",
  longText: "capture.attachments.skip.longText",
};

interface Walk {
  files: { path: string; bytes: number; text?: string }[];
  textChars: number;
  /** Count per reason, in the order each reason first happened. */
  skipped: Map<SkipReason, number>;
  capped: boolean;
}

const skip = (walk: Walk, reason: SkipReason) => {
  walk.skipped.set(reason, (walk.skipped.get(reason) ?? 0) + 1);
};

async function entriesOf(dir: EntryLike): Promise<EntryLike[]> {
  const reader = dir.createReader?.();
  if (!reader) throw new Error("unreadable");
  const all: EntryLike[] = [];
  // readEntries returns a batch at a time and an empty batch at the end.
  for (;;) {
    const batch = Promise.withResolvers<EntryLike[]>();
    reader.readEntries(batch.resolve, batch.reject);
    const got = await batch.promise;
    if (got.length === 0) return all;
    all.push(...got);
    if (all.length > DROP_LIMITS.folderEntries * 4) return all; // far more than will be listed
  }
}

async function fileOf(entry: EntryLike): Promise<FileLike> {
  const got = Promise.withResolvers<FileLike>();
  if (!entry.file) throw new Error("unreadable");
  entry.file(got.resolve, got.reject);
  return got.promise;
}

async function walkFolder(
  dir: EntryLike,
  prefix: string,
  depth: number,
  walk: Walk,
): Promise<void> {
  let children: EntryLike[];
  try {
    children = await entriesOf(dir);
  } catch {
    skip(walk, "unreadableFolder");
    return;
  }
  for (const child of children) {
    if (walk.files.length >= DROP_LIMITS.folderEntries) {
      walk.capped = true;
      return;
    }
    const name = child.name;
    // A name that is not one plain path segment is refused, never repaired.
    if (
      name.length === 0 ||
      name === "." ||
      name === ".." ||
      /[\\/]/u.test(name) ||
      HIDDEN.test(name)
    ) {
      skip(walk, "unusualName");
      continue;
    }
    if (name.startsWith(".") || name === "node_modules") {
      skip(walk, "hidden");
      continue;
    }
    const path = prefix === "" ? name : `${prefix}/${name}`;
    if (path.length > DROP_LIMITS.folderPathChars) {
      skip(walk, "longPath");
      continue;
    }
    if (child.isDirectory) {
      if (depth >= DROP_LIMITS.folderDepth) skip(walk, "tooDeep");
      else await walkFolder(child, path, depth + 1, walk);
      continue;
    }
    if (!child.isFile) {
      skip(walk, "special");
      continue;
    }
    let file: FileLike;
    try {
      file = await fileOf(child);
    } catch {
      skip(walk, "unreadableFile");
      continue;
    }
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      skip(walk, "unreadableFile");
      continue;
    }
    const entry: { path: string; bytes: number; text?: string } = { path, bytes: file.size };
    if (isTextFile(file) && file.size <= DROP_LIMITS.folderFileTextChars * 4) {
      try {
        const text = await file.text();
        if (
          text.length > 0 &&
          text.length <= DROP_LIMITS.folderFileTextChars &&
          !text.includes("\u0000") &&
          walk.textChars + text.length <= DROP_LIMITS.folderTextChars
        ) {
          entry.text = text;
          walk.textChars += text.length;
        } else if (text.length > 0) skip(walk, "longText");
      } catch {
        skip(walk, "unreadableFile");
        continue;
      }
    }
    walk.files.push(entry);
  }
}

/** A dropped folder: a payload with the listing the client built, or the reason it was skipped. */
export async function readFolder(
  dir: EntryLike,
): Promise<{ payload: UploadPayload | null; notes: string[] }> {
  const walk: Walk = { files: [], textChars: 0, skipped: new Map(), capped: false };
  await walkFolder(dir, "", 1, walk);
  const label = shown(dir.name);
  const notes = [...walk.skipped].map(([reason, n]) =>
    translate(SKIP_MESSAGE[reason], {
      label,
      n: formatNumber(n),
      pathChars: formatNumber(DROP_LIMITS.folderPathChars),
      depth: formatNumber(DROP_LIMITS.folderDepth),
    }),
  );
  if (walk.capped)
    notes.push(
      translate("capture.attachments.folder.capped", {
        label,
        max: formatNumber(DROP_LIMITS.folderEntries),
      }),
    );
  if (walk.files.length === 0) {
    notes.unshift(translate("capture.attachments.folder.noFiles", { label }));
    return { payload: null, notes };
  }
  if (dir.name.length === 0 || dir.name.length > DROP_LIMITS.nameChars || HIDDEN.test(dir.name)) {
    return {
      payload: null,
      notes: [translate("capture.attachments.folder.badName", { label }), ...notes],
    };
  }
  return {
    payload: {
      name: dir.name,
      kind: "folder",
      mime: "inode/directory",
      origin: "drop",
      content: JSON.stringify({ files: walk.files }),
    },
    notes,
  };
}

export interface DropReading {
  payloads: UploadPayload[];
  notes: string[];
}

/** Reads everything that was dropped or pasted. Never throws: a failure is a note. */
export async function readDropped(
  source: DroppedSource,
  origin: UploadOrigin = "drop",
): Promise<DropReading> {
  const out: DropReading = { payloads: [], notes: [] };
  for (const file of source.files) {
    const read = await readFile(file, origin);
    if (typeof read === "string") out.notes.push(read);
    else out.payloads.push(read);
  }
  for (const folder of source.folders) {
    const read = await readFolder(folder);
    if (read.payload) out.payloads.push(read.payload);
    out.notes.push(...read.notes);
  }
  return out;
}

// ── Upload to Core + the shared list ────────────────────────────────────────────────────────────

const failure = (err: unknown) =>
  err instanceof ApiError
    ? err.message
    : err instanceof Error
      ? err.message
      : translate("common.error.requestFailed");

export interface UploadNotice {
  /** Human sentence for a status region. */
  text: string;
  /** True when anything was refused or skipped. */
  problem: boolean;
}

/** Reads a drop or paste and posts each item to Core. One notice describes the whole drop. */
export function useAttachmentUpload(onDone?: () => void) {
  const client = useClient();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<UploadNotice | null>(null);
  const running = useRef(false);

  const upload = useCallback(
    async (source: DroppedSource, origin: UploadOrigin = "drop", earlier: string[] = []) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      setNotice(null);
      try {
        const read = await readDropped(source, origin);
        const problems = [...earlier, ...read.notes];
        let added = 0;
        for (const payload of read.payloads) {
          try {
            await client.request("POST", ATTACHMENTS_PATH, payload);
            added++;
          } catch (err) {
            problems.push(
              translate("capture.attachments.notice.uploadFailed", {
                name: shown(payload.name),
                reason: failure(err),
              }),
            );
          }
        }
        const head =
          added > 0
            ? translate("capture.attachments.notice.attached", { n: added })
            : translate("capture.attachments.notice.nothingAttached");
        setNotice({
          text:
            problems.length > 0
              ? translate("capture.attachments.notice.withProblems", {
                  head,
                  problems: problems.join(" "),
                })
              : head,
          problem: problems.length > 0,
        });
        onDone?.();
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [client, onDone],
  );
  return { upload, busy, notice, clearNotice: () => setNotice(null) };
}

export interface AttachmentsState {
  data: AttachmentList | null;
  error: string | null;
  reload: () => Promise<void>;
}

/** The attachments Core holds, reloaded when Core says the set changed (also on the emergency stop). */
export function useAttachments(): AttachmentsState {
  const client = useClient();
  const connection = useConnection();
  const [data, setData] = useState<AttachmentList | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await client.request<AttachmentList>("GET", ATTACHMENTS_PATH));
      setError(null);
    } catch (err) {
      setData(null);
      setError(failure(err));
    }
  }, [client]);

  useEffect(() => {
    if (connection === "online") void reload();
  }, [connection, reload]);
  useEffect(
    () =>
      client.eventCreated.on(({ event }) => {
        if (event.event_type === ATTACHMENTS_EVENT) void reload();
      }),
    [client, reload],
  );
  return { data, error, reload };
}

// ── Draft email (draft only; the user sends) ────────────────────────────────────────────────────

export const MAIL_LIMITS = { subjectChars: 120, bodyChars: 1500, urlChars: 1900 } as const;

export type MailtoResult = { ok: true; url: string } | { ok: false; reason: string };

// One plain address: no whitespace, no quotes, no separators, and none of the characters that
// would start another mailto: field (? & = #) or an escape (%).
const ADDRESS =
  /^[^\s@,;:<>()"'\\[\]?&=#%]+@[^\s@,;:<>()"'\\[\]?&=#%]+\.[^\s@,;:<>()"'\\[\]?&=#%]+$/u;

/**
 * A `mailto:` URL for a draft: subject "About: <name>", the body the user chose to share, and NO
 * recipient unless the user typed one. Everything is percent-encoded; line breaks are CRLF as RFC 6068
 * asks. A body or total length over the cap is refused with the reason, never cut.
 */
export function buildMailto(input: {
  attachmentName: string;
  body: string;
  to?: string;
}): MailtoResult {
  const cleanSubject = Array.from(
    input.attachmentName
      // eslint-disable-next-line no-control-regex
      .replace(
        /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/gu,
        " ",
      )
      .replace(/\s+/gu, " ")
      .trim(),
  );
  // The subject is capped as a whole, so the room for the name is what the prefix leaves.
  const room =
    MAIL_LIMITS.subjectChars - translate("capture.attachments.mail.subject", { name: "" }).length;
  const subject = translate("capture.attachments.mail.subject", {
    name: cleanSubject.slice(0, room).join(""),
  });

  const body = input.body
    .replace(/\r\n?/gu, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(
      /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/gu,
      "",
    );
  if (body.trim().length === 0)
    return { ok: false, reason: translate("capture.attachments.mail.empty") };
  if (body.length > MAIL_LIMITS.bodyChars)
    return {
      ok: false,
      reason: translate("capture.attachments.mail.tooLong", {
        over: formatNumber(body.length - MAIL_LIMITS.bodyChars),
        limit: formatNumber(MAIL_LIMITS.bodyChars),
      }),
    };

  const to = (input.to ?? "").trim();
  let recipient = "";
  if (to !== "") {
    if (to.length > 254 || !ADDRESS.test(to))
      return { ok: false, reason: translate("capture.attachments.mail.badAddress") };
    recipient = encodeURIComponent(to).replaceAll("%40", "@");
  }
  const url = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replaceAll("\n", "\r\n"))}`;
  if (url.length > MAIL_LIMITS.urlChars)
    return {
      ok: false,
      reason: translate("capture.attachments.mail.urlTooLong", {
        length: formatNumber(url.length),
        limit: formatNumber(MAIL_LIMITS.urlChars),
      }),
    };
  return { ok: true, url };
}

/** The slice of `window` that opening a mail draft touches. */
export interface MailTarget {
  __TAURI__?: {
    core?: { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
  };
  location: { assign(url: string): void };
}

/**
 * Opens the draft in the user's mail app: through the desktop shell's `open_mailto` command when the
 * page runs inside it (the shell validates the URL again), otherwise by navigating to the link.
 * Re-checks what `buildMailto` guarantees, so no other caller can open anything else.
 */
export async function openMailto(url: string, win: MailTarget = window): Promise<void> {
  // eslint-disable-next-line no-control-regex
  if (
    !url.startsWith("mailto:") ||
    url.length > MAIL_LIMITS.urlChars ||
    /[\u0000-\u001F\u007F-\u009F\s]/u.test(url)
  )
    throw new Error("Not a mail draft link");
  const invoke = win.__TAURI__?.core?.invoke;
  if (invoke) await invoke("open_mailto", { url });
  else win.location.assign(url);
}
