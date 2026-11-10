// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useCallback, useEffect, useState } from "react";
import { useClient } from "../core/context";
import { useAction } from "../core/hooks";
import { useT } from "../i18n";
import { Feedback } from "./Feedback";

interface PageNote {
  id: string;
  received_at: string;
  url: string;
  title: string;
  selected_text: string | null;
}

const LIST_PATH = "/api/companion/pages";

/** A server answer reduced to the fields this list shows; anything else is ignored. */
function readPages(body: unknown): PageNote[] {
  const pages = (body as { pages?: unknown } | null)?.pages;
  if (!Array.isArray(pages)) return [];
  return pages.flatMap((raw: unknown) => {
    const p = raw as Record<string, unknown> | null;
    if (!p || typeof p.id !== "string" || typeof p.url !== "string") return [];
    return [
      {
        id: p.id,
        received_at: typeof p.received_at === "string" ? p.received_at : "",
        url: p.url,
        title: typeof p.title === "string" ? p.title : "",
        selected_text: typeof p.selected_text === "string" ? p.selected_text : null,
      },
    ];
  });
}

/**
 * Pages the person sent with the browser extension (Phase 89). Every field was written by a website,
 * so each is rendered as plain text. The address is NOT a link: opening a page is the person's own
 * act in their browser, not something this list does for them. Nothing here sends a note anywhere.
 */
export function PageNotesSection() {
  const t = useT();
  const client = useClient();
  const { run, busy, error } = useAction();
  const [pages, setPages] = useState<PageNote[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(
    () =>
      client.request<unknown>("GET", LIST_PATH).then(
        (body) => {
          setPages(readPages(body));
          setLoadFailed(false);
        },
        () => setLoadFailed(true),
      ),
    [client],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id: string) => {
    if (await run("DELETE", `${LIST_PATH}/${encodeURIComponent(id)}`)) await load();
  };

  return (
    <section className="card" aria-labelledby="page-notes-h">
      <h2 id="page-notes-h">{t("pageNotes.title")}</h2>
      <p>{t("pageNotes.intro")}</p>
      {loadFailed && (
        <p className="error-text small" role="alert">
          {t("pageNotes.loadFailed")}
        </p>
      )}
      {!loadFailed && pages === null && (
        <p className="muted" role="status">
          {t("pageNotes.loading")}
        </p>
      )}
      {pages !== null && pages.length === 0 && <p className="muted">{t("pageNotes.empty")}</p>}
      {pages !== null && pages.length > 0 && (
        <ul className="card-list" aria-label={t("pageNotes.list")}>
          {pages.map((page) => (
            <li key={page.id}>
              <strong className="break">{page.title || t("pageNotes.untitled")}</strong>
              <p className="memory-text break small">{page.url}</p>
              {page.selected_text !== null && (
                <details>
                  <summary>{t("pageNotes.selection")}</summary>
                  <p className="memory-text break" style={{ whiteSpace: "pre-wrap" }}>
                    {page.selected_text}
                  </p>
                </details>
              )}
              <p className="muted small">{t("pageNotes.received", { time: page.received_at })}</p>
              <button
                type="button"
                className="btn"
                disabled={busy}
                aria-label={t("pageNotes.deleteLabel", { title: page.title || page.url })}
                onClick={() => void remove(page.id)}
              >
                {t("pageNotes.delete")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Feedback error={error} />
    </section>
  );
}
