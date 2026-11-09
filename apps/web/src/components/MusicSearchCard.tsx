// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useState } from "react";
import { ApiError } from "../core/client";
import { useClient } from "../core/context";
import {
  MAX_PLAY_QUERY_CHARS,
  REFUSAL_TEXT,
  SERVICE_NAME,
  sameAddress,
  type PlayRoute,
} from "../core/music-search";
import { useT } from "../i18n";

type Answer =
  | { phase: "checking" }
  | { phase: "answered"; url: unknown }
  | { phase: "off" }
  | { phase: "failed" };

/**
 * The step between a play request and any page: the site and the exact query, and a link that only
 * the person's own click follows. Core is asked for the address (it answers only for a site the
 * person switched on in Settings > music sites) and its answer must equal the address built here.
 * Nothing is played, no result is chosen and no player is embedded. The link opens the site's own
 * search page in the system browser; `phoenix://browser/open` accepts loopback addresses only (see
 * docs/youtube-music.md).
 */
export function MusicSearchCard({ route }: { route: PlayRoute }) {
  const t = useT();
  const client = useClient();
  const [answer, setAnswer] = useState<Answer>({ phase: "checking" });
  const service = route.ok ? route.service : null;
  const query = route.ok ? route.query : null;

  useEffect(() => {
    if (service === null || query === null) return;
    let alive = true;
    setAnswer({ phase: "checking" });
    client
      .request<{ url?: unknown }>(
        "POST",
        `/api/music/connectors/${encodeURIComponent(service)}/search`,
        { query },
      )
      .then((body) => alive && setAnswer({ phase: "answered", url: body.url }))
      .catch((err: unknown) => {
        if (!alive) return;
        setAnswer({ phase: err instanceof ApiError && err.status === 403 ? "off" : "failed" });
      });
    return () => {
      alive = false;
    };
  }, [client, service, query]);

  if (!route.ok) {
    if (route.reason === "not_play_request") return null;
    return (
      <p className="error-text small" role="alert">
        {t(REFUSAL_TEXT[route.reason], { max: MAX_PLAY_QUERY_CHARS })}
      </p>
    );
  }
  const name = t(SERVICE_NAME[route.service]);
  return (
    <section className="card" aria-label={t("musicPlay.title")}>
      <h3>{t("musicPlay.title")}</h3>
      <p className="small muted">{t("musicPlay.body")}</p>
      <p>{t("musicPlay.service", { service: name })}</p>
      <p className="memory-text break">{t("musicPlay.query", { query: route.query })}</p>
      {answer.phase === "checking" && (
        <p className="muted small" role="status">
          {t("musicPlay.checking")}
        </p>
      )}
      {answer.phase === "off" && (
        <p className="error-text small" role="alert">
          {t("musicPlay.off", { service: name })}
        </p>
      )}
      {(answer.phase === "failed" ||
        (answer.phase === "answered" && !sameAddress(route, answer.url))) && (
        <p className="error-text small" role="alert">
          {t("musicPlay.failed")}
        </p>
      )}
      {answer.phase === "answered" && sameAddress(route, answer.url) && (
        <p>
          <a className="btn" href={route.url} target="_blank" rel="noopener noreferrer">
            {t("musicPlay.open")}
          </a>
        </p>
      )}
    </section>
  );
}
