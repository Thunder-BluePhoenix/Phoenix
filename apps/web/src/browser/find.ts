// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 93: find in page, the chrome's half. The shell (`find_in_page`) is the enforcement point and
// refuses a bad query with `bad_query`; this check is for feedback while the person types, and mirrors
// the shell's limits: at most 200 characters, no control character, no zero-width character, no bidirectional-control character.
import { useCallback, useEffect, useRef, useState } from "react";
import { FIND_MAX_QUERY, type BrowserShell } from "./shell";
import { BIDI, CONTROL } from "./unsafe-text";

export type FindQueryProblem = "too_long" | "control" | "bidi";

/** Zero-width format characters (ZWSP, ZWNJ, ZWJ, word joiner, BOM): invisible, so they hide in a query. Mirrors the shell. */
const ZERO_WIDTH = /[\u200b-\u200d\u2060\ufeff]/;

/** `null` when the query may be sent (the empty query clears the highlight and is allowed). */
export function findQueryProblem(query: string): FindQueryProblem | null {
  if ([...query].length > FIND_MAX_QUERY) return "too_long";
  if (CONTROL.test(query) || ZERO_WIDTH.test(query)) return "control";
  if (BIDI.test(query)) return "bidi";
  return null;
}

/** What the find bar shows for a `find_in_page` refusal reason. */
export type FindFailure = "bad_query" | "unknown_tab" | "no_page" | "failed";

export function findFailure(reason: string): FindFailure {
  return reason === "bad_query" || reason === "unknown_tab" || reason === "no_page"
    ? reason
    : "failed";
}

/** The last answer for the query on screen. */
export interface FindResultState {
  searching: boolean;
  /** null: no answer yet (or the query is empty). */
  found: boolean | null;
  failure: FindFailure | null;
}

const IDLE: FindResultState = { searching: false, found: null, failure: null };

export interface FindInPage {
  open: boolean;
  query: string;
  problem: FindQueryProblem | null;
  result: FindResultState;
  show(): void;
  close(): void;
  setQuery(query: string): void;
  step(forward: boolean): void;
}

/**
 * The find bar's state for the ACTIVE tab. Typing searches at once (forward from the top); Next and
 * Previous step. Closing the bar, switching tab or leaving clears the highlight the shell drew.
 * An answer that arrives after a newer request is dropped.
 */
export function useFindInPage(shell: BrowserShell | null, tabId: string | null): FindInPage {
  const [open, setOpen] = useState(false);
  const [query, setQueryState] = useState("");
  const [result, setResult] = useState<FindResultState>(IDLE);
  const seq = useRef(0);
  const queryRef = useRef(query);
  queryRef.current = query;
  /** The tab that may currently carry a highlight from this bar. */
  const highlighted = useRef<string | null>(null);

  const run = useCallback(
    async (text: string, forward: boolean) => {
      const n = ++seq.current;
      if (!shell || !tabId || text === "" || findQueryProblem(text) !== null) {
        setResult(IDLE);
        return;
      }
      setResult({ searching: true, found: null, failure: null });
      highlighted.current = tabId;
      try {
        const answer = await shell.findInPage(tabId, text, forward);
        if (n !== seq.current) return;
        setResult(
          answer.ok
            ? { searching: false, found: answer.found, failure: null }
            : { searching: false, found: null, failure: findFailure(answer.reason) },
        );
      } catch {
        if (n === seq.current) setResult({ searching: false, found: null, failure: "failed" });
      }
    },
    [shell, tabId],
  );

  // While the bar is open on a tab: search the typed text there; leaving clears the old tab's highlight.
  useEffect(() => {
    if (!open || !tabId || !shell) return;
    if (queryRef.current !== "") void run(queryRef.current, true);
    return () => {
      seq.current += 1;
      setResult(IDLE);
      const was = highlighted.current;
      highlighted.current = null;
      if (was !== null) void shell.findInPage(was, "", true).catch(() => {});
    };
  }, [open, tabId, shell, run]);

  const setQuery = useCallback(
    (next: string) => {
      setQueryState(next);
      void run(next, true);
    },
    [run],
  );

  return {
    open,
    query,
    problem: findQueryProblem(query),
    result,
    show: () => setOpen(true),
    close: () => setOpen(false),
    setQuery,
    step: (forward) => void run(queryRef.current, forward),
  };
}
