// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useRef, type KeyboardEvent } from "react";
import { useT, type MessageKey } from "../i18n";
import type { FindInPage } from "./find";
import { FIND_MAX_QUERY } from "./shell";

const PROBLEM: Record<string, MessageKey> = {
  too_long: "browser.find.tooLong",
  control: "browser.find.control",
  bidi: "browser.find.bidi",
};

const FAILURE: Record<string, MessageKey> = {
  bad_query: "browser.find.bad_query",
  unknown_tab: "browser.find.unknown_tab",
  no_page: "browser.find.no_page",
  failed: "browser.find.failed",
};

/** The find-in-page bar. It sends the typed text to the shell; the page itself is never drawn here. */
export function FindBar({ find, focusToken }: { find: FindInPage; focusToken: number }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusToken]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      find.close();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (find.problem === null) find.step(!event.shiftKey);
    }
  };

  const { result } = find;
  const message =
    find.problem !== null
      ? t(PROBLEM[find.problem]!, { max: FIND_MAX_QUERY })
      : result.failure !== null
        ? t(FAILURE[result.failure]!)
        : result.searching
          ? t("browser.find.searching")
          : result.found === true
            ? t("browser.find.found")
            : result.found === false
              ? t("browser.find.notFound")
              : "";

  return (
    <div className="browser-find" role="search">
      <input
        ref={input}
        className="browser-address browser-find-input"
        type="text"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label={t("browser.find.label")}
        placeholder={t("browser.find.placeholder")}
        aria-invalid={find.problem !== null}
        value={find.query}
        onChange={(e) => find.setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className="browser-button"
        aria-label={t("browser.find.prev")}
        disabled={find.query === "" || find.problem !== null}
        onClick={() => find.step(false)}
      >
        ↑
      </button>
      <button
        type="button"
        className="browser-button"
        aria-label={t("browser.find.next")}
        disabled={find.query === "" || find.problem !== null}
        onClick={() => find.step(true)}
      >
        ↓
      </button>
      <span className="browser-find-status" role="status">
        {message}
      </span>
      <button
        type="button"
        className="browser-button"
        aria-label={t("browser.find.close")}
        onClick={find.close}
      >
        ×
      </button>
    </div>
  );
}
