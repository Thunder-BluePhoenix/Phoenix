// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The query is the ONE thing that leaves this computer. It is cleaned and checked here, before any
// request exists: control and invisible characters become spaces, the length is capped (a query that
// is too long is refused, never cut, because a cut could leave half a secret in what is sent), and
// anything the agent secret detector recognises is refused so a pasted key never reaches a search host.
import { scanText } from "@phoenix/capability-agents";
import { ServiceError } from "@phoenix/service-kit";

export const SERVICE = "Web search";
export const MAX_QUERY_CHARS = 200;
/**
 * The confirmed command's cap. Core's approval prompt shows at most 80 characters of a value, so a
 * query that needs approval is held to what the person can read in full before it is sent.
 */
export const MAX_CONFIRMED_QUERY_CHARS = 80;
/** Longest raw input looked at; anything longer is refused before it is scanned. */
const MAX_RAW_CHARS = 1_000;
/** Control, format (bidi, zero-width) and line/paragraph separator characters. */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const SPACES = /\s+/gu;
/** `scheme://user:password@host`: a credential inside a pasted address. */
const URL_CREDENTIALS = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/iu;

export type QueryResult = { ok: true; query: string } | { ok: false; error: ServiceError };

const refuse = (message: string): QueryResult => ({
  ok: false,
  error: new ServiceError(SERVICE, "invalid", message),
});

/** True when the text holds something the secret detector (or a credential in an address) recognises. */
function looksSecret(text: string): boolean {
  return scanText(text, "query").length > 0 || URL_CREDENTIALS.test(text);
}

export interface QueryOptions {
  /** Longest query accepted (default MAX_QUERY_CHARS). */
  maxChars?: number;
  /**
   * Refuse, instead of tidying, a query that cleaning would change (hidden characters, runs of
   * spaces, outer spaces), so what a person approved is exactly what is sent.
   */
  exact?: boolean;
}

/**
 * The query to send, or a fixed, secret-free refusal. Never echoes the input back in an error.
 * Hidden characters are scanned both as spaces and removed outright, so a secret split by a
 * zero-width character is still recognised.
 */
export function cleanQuery(raw: unknown, options: QueryOptions = {}): QueryResult {
  const max = options.maxChars ?? MAX_QUERY_CHARS;
  const tooLong = `The search was not sent: the query is longer than ${max} characters`;
  if (typeof raw !== "string") return refuse("The search was not sent: the query must be text");
  if (raw.length > MAX_RAW_CHARS) return refuse(tooLong);
  const query = raw.replace(HIDDEN, " ").replace(SPACES, " ").trim();
  if (query.length === 0) return refuse("The search was not sent: the query is empty");
  if (query.length > max) return refuse(tooLong);
  if (options.exact === true && query !== raw) {
    return refuse("The search was not sent: the query has hidden characters or extra spaces");
  }
  if (looksSecret(query) || looksSecret(raw.replace(HIDDEN, ""))) {
    return refuse("The search was not sent: the query looks like it contains a secret");
  }
  return { ok: true, query };
}
