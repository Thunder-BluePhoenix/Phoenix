// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useId, useState, type FormEvent } from "react";
import { MUSIC_PATH, isMusicSiteId, useLoaded, type MusicSite } from "../core/browser-profiles";
import { useAction } from "../core/hooks";
import { useT, type MessageKey } from "../i18n";
import { Feedback } from "./Feedback";

const SITE_NAME = {
  youtube: "browserProfiles.music.site.youtube",
  soundcloud: "browserProfiles.music.site.soundcloud",
  bandcamp: "browserProfiles.music.site.bandcamp",
  "spotify-web": "browserProfiles.music.site.spotify-web",
} as const satisfies Record<string, MessageKey>;

/** Only an http(s) address is ever made into a link; anything else Core might send is not. */
function webAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** The four music sites, each off until switched on (Phase 94). Nothing plays here. */
export function MusicSitesSection() {
  const t = useT();
  const { state, replace } = useLoaded<{ sites: MusicSite[] }>(MUSIC_PATH);

  return (
    <section className="card" aria-labelledby="music-sites-h">
      <h2 id="music-sites-h">{t("browserProfiles.music.title")}</h2>
      <p>{t("browserProfiles.music.intro")}</p>
      {state.phase === "loading" && (
        <p className="muted" role="status">
          {t("common.status.loading")}
        </p>
      )}
      {state.phase === "unavailable" && (
        <p role="status">{t("browserProfiles.music.unavailable")}</p>
      )}
      {state.phase === "failed" && (
        <p className="error-text small" role="alert">
          {t("browserProfiles.music.loadFailed")}
        </p>
      )}
      {state.phase === "ready" && (
        <ul className="card-list" aria-label={t("browserProfiles.music.list")}>
          {state.data.sites.map((site) => (
            <SiteRow key={site.site} site={site} onSites={(sites) => replace({ sites })} />
          ))}
        </ul>
      )}
    </section>
  );
}

function SiteRow({ site, onSites }: { site: MusicSite; onSites: (sites: MusicSite[]) => void }) {
  const t = useT();
  const id = useId();
  const { run, busy, error } = useAction();
  const search = useAction();
  const [query, setQuery] = useState("");
  const [address, setAddress] = useState<string | null>(null);
  const [badAddress, setBadAddress] = useState(false);
  const name = isMusicSiteId(site.site)
    ? t(SITE_NAME[site.site])
    : t("browserProfiles.music.site.other", { site: site.site });
  const base = `${MUSIC_PATH}/${encodeURIComponent(site.site)}`;

  const toggle = async (enabled: boolean) => {
    const result = await run<{ sites: MusicSite[] }>("PUT", base, { enabled });
    if (!result) return;
    onSites(result.sites);
    if (!enabled) {
      setAddress(null);
      setBadAddress(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    const result = await search.run<{ url?: unknown }>("POST", `${base}/search`, {
      query: trimmed,
    });
    if (!result) return;
    const url = webAddress(result.url);
    setAddress(url);
    setBadAddress(url === null);
  };

  return (
    <li className="card">
      <label>
        <input
          type="checkbox"
          checked={site.enabled}
          disabled={busy}
          onChange={(event) => void toggle(event.target.checked)}
        />{" "}
        {name}
      </label>
      <p className="muted small memory-text">
        {t("browserProfiles.music.hosts", { hosts: site.hosts.join(", ") })}
      </p>
      {site.enabled && site.site === "youtube" && site.adBlocking === "exempt" && (
        <p className="warning-text small">{t("browserProfiles.music.adBlocking")}</p>
      )}
      <Feedback error={error} />
      {site.enabled && (
        <form onSubmit={(event) => void submit(event)}>
          <label className="field" htmlFor={`${id}-q`}>
            {t("browserProfiles.music.search.label", { site: name })}
          </label>
          <input
            id={`${id}-q`}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="button-row">
            <button type="submit" className="btn" disabled={search.busy || !query.trim()}>
              {t("browserProfiles.music.search.submit")}
            </button>
          </div>
          <Feedback error={search.error} />
          {address && (
            <p className="small memory-text">
              {t("browserProfiles.music.search.open")}{" "}
              <a href={address} target="_blank" rel="noopener noreferrer">
                {address}
              </a>
            </p>
          )}
          {badAddress && (
            <p className="error-text small" role="alert">
              {t("browserProfiles.music.search.badAddress")}
            </p>
          )}
        </form>
      )}
    </li>
  );
}
