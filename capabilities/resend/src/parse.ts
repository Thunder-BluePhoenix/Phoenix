// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Resend's "list emails" response (GET /emails), read defensively: every field is untrusted text.
import { redact } from "@phoenix/logging";
import { epochMs, expectObject, parseList, str, type Json } from "@phoenix/service-kit";

export const MAX_TEXT = 200;
/** Emails read per poll. Resend returns the newest first. */
export const PAGE_SIZE = 25;
const MAX_RECIPIENT_DOMAINS = 3;
const MAX_RECIPIENTS = 1000;
/** Resend ids are UUIDs; anything else cannot be put in a request path or a link safely. */
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const STATE = /^[a-z_]{1,30}$/;
const DOMAIN = /@([a-z0-9][a-z0-9.-]{0,98})>?\s*$/i;

export interface ResendEmail {
  id: string;
  subject: string;
  /** Resend's `last_event`: sent, delivered, bounced, failed, opened, … */
  state: string;
  createdAt: number;
  /** Only the domains of the first recipients: addresses themselves are never kept. */
  toDomains: string[];
  toCount: number;
}

/** Free text from the remote: clipped, control characters removed, secret-looking values redacted. */
export function text(value: unknown, max = MAX_TEXT): string | undefined {
  const clipped = str(value, max * 4);
  if (clipped === undefined) return undefined;
  const clean = String(redact(clipped));
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

function recipients(value: unknown): { domains: string[]; count: number } {
  if (!Array.isArray(value)) return { domains: [], count: 0 };
  const domains = new Set<string>();
  let count = 0;
  for (const entry of value.slice(0, MAX_RECIPIENTS)) {
    if (typeof entry !== "string") continue;
    count++;
    const domain = DOMAIN.exec(entry.slice(0, 320))?.[1]?.toLowerCase();
    if (domain && domains.size < MAX_RECIPIENT_DOMAINS) domains.add(domain);
  }
  return { domains: [...domains], count };
}

function parseEmail(raw: Json): ResendEmail | undefined {
  const id = str(raw.id, 100);
  if (id === undefined || !ID.test(id)) return undefined;
  const createdAt = epochMs(raw.created_at);
  if (createdAt === undefined) return undefined;
  const last = str(raw.last_event, 40)?.toLowerCase();
  const { domains, count } = recipients(raw.to);
  return {
    id,
    subject: text(raw.subject) ?? "(no subject)",
    state: last !== undefined && STATE.test(last) ? last : "unknown",
    createdAt,
    toDomains: domains,
    toCount: count,
  };
}

/** The `data` array of a list response. A malformed entry is skipped; a malformed body throws. */
export function parseEmails(body: unknown): ResendEmail[] {
  return parseList(expectObject(body).data, parseEmail, PAGE_SIZE);
}
