// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Pages the person chose to send from the browser extension (Phase 89), kept as a plain list for
// the person to review and delete. A page note is untrusted data: its URL, title and selected text
// were written by a website. Nothing here reads a note back into a prompt, a route, a shell line
// or a capability, and nothing is sent to a model; the only reader is the review list in the web
// app, which renders it as inert text. Bounded: every field has a limit, and the list has a size
// limit (a full list refuses new notes rather than silently deleting the person's older ones).
import { randomBytes } from "node:crypto";
import { redactSecrets } from "@phoenix/capability-agents";
import type { AuditLog } from "@phoenix/permissions";
import type { Database } from "@phoenix/persistence";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";

export const MAX_PAGE_NOTES = 200;
export const MAX_PAGE_URL = 2048;
export const MAX_PAGE_TITLE = 200;
export const MAX_PAGE_SELECTION = 2000;
export const PAGE_NOTE_ID = /^pn_[0-9a-f]{24}$/;

export interface PageNoteView {
  id: string;
  received_at: string;
  url: string;
  title: string;
  /** Only present when the person had text selected when they clicked. */
  selected_text: string | null;
}

interface Row {
  id: string;
  received_at: string;
  url: string;
  title: string;
  selected_text: string | null;
}

/** Control, format, line and paragraph separators: nothing a page title may carry into the list. */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const ALLOWED_KEYS: Record<string, true> = { url: true, title: true, selection: true };

const codePoints = (text: string): number => Array.from(text).length;
const clip = (text: string, max: number): string => {
  const points = Array.from(text);
  return points.length > max ? `${points.slice(0, max - 1).join("")}…` : text;
};

function invalid(message: string): PhoenixError {
  return new PhoenixError(ErrorCode.INVALID_REQUEST, message);
}

/** One line, no control or format characters. */
function oneLine(text: string): string {
  return text.replace(UNSAFE, " ").replace(/\s+/g, " ").trim();
}

/** Keeps line breaks and tabs, drops everything else that is control or format. */
function multiLine(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\p{Zl}\p{Zp}]/gu, "\n")
    .replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === "\n" ? "\n" : c === "\t" ? " " : ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The page address: http(s) only, no credentials, no fragment, at most MAX_PAGE_URL characters. */
function pageUrl(value: unknown): string {
  if (typeof value !== "string" || value === "") throw invalid('"url" must be text');
  if (codePoints(value) > MAX_PAGE_URL) throw invalid(`"url" is longer than ${MAX_PAGE_URL}`);
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\s]/u.test(value)) throw invalid('"url" has unsafe characters');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid('"url" is not an address');
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw invalid('"url" must be http or https');
  if (url.username !== "" || url.password !== "") throw invalid('"url" must not carry credentials');
  // A fragment can hold a sign-in token (an OAuth implicit grant); the page itself does not need it.
  url.hash = "";
  const text = redactSecrets(url.href);
  if (codePoints(text) > MAX_PAGE_URL) throw invalid(`"url" is longer than ${MAX_PAGE_URL}`);
  return text;
}

function pageTitle(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string") throw invalid('"title" must be text');
  if (codePoints(value) > MAX_PAGE_TITLE) throw invalid(`"title" is longer than ${MAX_PAGE_TITLE}`);
  return clip(oneLine(redactSecrets(value)), MAX_PAGE_TITLE);
}

function pageSelection(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw invalid('"selection" must be text');
  if (codePoints(value) > MAX_PAGE_SELECTION)
    throw invalid(`"selection" is longer than ${MAX_PAGE_SELECTION}`);
  const text = clip(multiLine(redactSecrets(value)), MAX_PAGE_SELECTION);
  return text === "" ? null : text;
}

export interface PageNotesDependencies {
  db: Database;
  audit: Pick<AuditLog, "record">;
  now?: () => Date;
}

export class PageNotesService {
  constructor(private readonly d: PageNotesDependencies) {}

  count(): number {
    const row = this.d.db.prepare("SELECT COUNT(*) AS n FROM page_notes").get() as { n: number };
    return row.n;
  }

  list(): PageNoteView[] {
    return (
      this.d.db
        .prepare(
          "SELECT id, received_at, url, title, selected_text FROM page_notes ORDER BY received_at DESC, rowid DESC",
        )
        .all() as unknown as Row[]
    ).map((row) => ({ ...row }));
  }

  /** Stores one page note. Everything is validated first; a refused note stores nothing. */
  receive(input: unknown): PageNoteView {
    if (input === null || typeof input !== "object" || Array.isArray(input))
      throw invalid("Body must be a JSON object");
    const body = input as Record<string, unknown>;
    for (const key of Object.keys(body)) {
      if (!Object.hasOwn(ALLOWED_KEYS, key)) throw invalid(`Unexpected field "${key}"`);
    }
    const url = pageUrl(body.url);
    const title = pageTitle(body.title);
    const selected = pageSelection(body.selection);
    if (this.count() >= MAX_PAGE_NOTES)
      throw invalid(`The page list is full (${MAX_PAGE_NOTES}). Delete some pages and try again.`);
    const view: PageNoteView = {
      id: `pn_${randomBytes(12).toString("hex")}`,
      received_at: (this.d.now?.() ?? new Date()).toISOString(),
      url,
      title,
      selected_text: selected,
    };
    this.d.db
      .prepare(
        "INSERT INTO page_notes (id, received_at, url, title, selected_text) VALUES (?, ?, ?, ?, ?)",
      )
      .run(view.id, view.received_at, view.url, view.title, view.selected_text);
    this.d.audit.record({
      actor: "companion",
      action: "companion.page.received",
      decision: "info",
      // The host name only: a full address can carry a query the person did not mean to share.
      details: {
        id: view.id,
        host: new URL(url).host,
        selection_chars: selected === null ? 0 : codePoints(selected),
      },
    });
    return view;
  }

  remove(id: string): { removed: true } {
    if (!PAGE_NOTE_ID.test(id)) throw invalid("Not a page note id");
    const result = this.d.db.prepare("DELETE FROM page_notes WHERE id = ?").run(id);
    if (result.changes === 0)
      throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "No such page note");
    this.d.audit.record({
      actor: "user",
      action: "companion.page.deleted",
      decision: "info",
      details: { id },
    });
    return { removed: true };
  }
}
