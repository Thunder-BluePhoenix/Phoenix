// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useId, useState, type FormEvent } from "react";
import { useLoaded } from "../core/browser-profiles";
import { useAction } from "../core/hooks";
import { FILTER_LISTS_PATH, SHIELDS_PATH, type FilterListsPayload } from "../core/filter-lists";
import { formatDate, formatNumber } from "../core/format";
import { useLocale, useT } from "../i18n";
import { Feedback } from "./Feedback";

/**
 * Phase 93: the filter lists, the master switch and the per-site off-list. Phoenix has no browser
 * window yet, so this card only records choices; the intro says so.
 */
export function ShieldsSection() {
  const t = useT();
  const { state, replace } = useLoaded<FilterListsPayload>(FILTER_LISTS_PATH);

  return (
    <section className="card" aria-labelledby="shields-h">
      <h2 id="shields-h">{t("shields.title")}</h2>
      <p>{t("shields.intro")}</p>
      {state.phase === "loading" && (
        <p className="muted" role="status">
          {t("common.status.loading")}
        </p>
      )}
      {state.phase === "unavailable" && <p role="status">{t("shields.unavailable")}</p>}
      {state.phase === "failed" && (
        <p className="error-text small" role="alert">
          {t("shields.loadFailed")}
        </p>
      )}
      {state.phase === "ready" && <Ready data={state.data} replace={replace} />}
    </section>
  );
}

function Ready({
  data,
  replace,
}: {
  data: FilterListsPayload;
  replace: (data: FilterListsPayload) => void;
}) {
  const t = useT();
  const global = useAction();

  const setGlobal = async (enabled: boolean) => {
    const result = await global.run<{ shields: FilterListsPayload["shields"] }>(
      "PUT",
      SHIELDS_PATH,
      { enabled },
    );
    if (result) replace({ ...data, shields: result.shields });
  };

  return (
    <>
      <label>
        <input
          type="checkbox"
          checked={data.shields.enabled}
          disabled={global.busy}
          onChange={(event) => void setGlobal(event.target.checked)}
        />{" "}
        {t("shields.global.label")}
      </label>
      <p className="muted small">{t("shields.global.hint")}</p>
      <Feedback error={global.error} />

      <h3 className="h3">{t("shields.lists.title")}</h3>
      <p className="muted small">{t("shields.lists.note")}</p>
      <ul className="card-list" aria-label={t("shields.lists.title")}>
        {data.lists.map((list) => (
          <ListRow
            key={list.id}
            list={list}
            onLists={(lists) => replace({ ...data, lists })}
            onList={(next) =>
              replace({ ...data, lists: data.lists.map((l) => (l.id === next.id ? next : l)) })
            }
          />
        ))}
      </ul>

      <SiteList data={data} replace={replace} />
    </>
  );
}

function ListRow({
  list,
  onList,
  onLists,
}: {
  list: FilterListsPayload["lists"][number];
  onList: (list: FilterListsPayload["lists"][number]) => void;
  onLists: (lists: FilterListsPayload["lists"]) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const update = useAction();
  const toggle = useAction();
  const remove = useAction();
  const [note, setNote] = useState<string | null>(null);
  const base = `${FILTER_LISTS_PATH}/${encodeURIComponent(list.id)}`;

  const doUpdate = async () => {
    setNote(null);
    const result = await update.run<{ list: FilterListsPayload["lists"][number] }>(
      "POST",
      `${base}/update`,
    );
    if (result) {
      onList(result.list);
      setNote(t("shields.list.updated", { name: list.title }));
    }
  };
  const doToggle = async (enabled: boolean) => {
    setNote(null);
    const result = await toggle.run<{ lists: FilterListsPayload["lists"] }>("PUT", base, {
      enabled,
    });
    if (result) onLists(result.lists);
  };
  const doRemove = async () => {
    setNote(null);
    const result = await remove.run<{ lists: FilterListsPayload["lists"] }>("DELETE", base);
    if (result) {
      onLists(result.lists);
      setNote(t("shields.list.removed", { name: list.title }));
    }
  };

  return (
    <li className="card">
      <p>
        <strong>{list.title}</strong> ·{" "}
        {t(list.purpose === "ads" ? "shields.list.purpose.ads" : "shields.list.purpose.trackers")}
      </p>
      {list.status === "never" && <p className="muted small">{t("shields.list.never")}</p>}
      {list.status === "damaged" && (
        <p className="warning-text small" role="status">
          {t("shields.list.damaged")}
        </p>
      )}
      {list.status === "ready" && list.rules && list.fetchedAt && (
        <>
          <p className="small">
            {t("shields.list.status", {
              date: formatDate(list.fetchedAt, locale),
              rules: formatNumber(list.rules.network, locale),
              cosmetic: formatNumber(list.rules.cosmetic, locale),
            })}
          </p>
          {list.version && (
            <p className="muted small">{t("shields.list.version", { version: list.version })}</p>
          )}
          {list.dueAt && (
            <p className="muted small">
              {t("shields.list.due", { date: formatDate(list.dueAt, locale) })}
            </p>
          )}
        </>
      )}
      <p className="muted small memory-text">
        {t("shields.list.licence", { licence: list.licence, attribution: list.attribution })}
      </p>
      <p className="muted small memory-text">{t("shields.list.source", { source: list.source })}</p>
      <label>
        <input
          type="checkbox"
          checked={list.enabled}
          disabled={toggle.busy || list.status !== "ready"}
          onChange={(event) => void doToggle(event.target.checked)}
        />{" "}
        {t("shields.list.enable", { name: list.title })}
      </label>
      {list.status !== "ready" && (
        <p className="muted small">{t("shields.list.enableNeedsDownload")}</p>
      )}
      <div className="button-row">
        <button
          type="button"
          className="btn"
          disabled={update.busy}
          onClick={() => void doUpdate()}
        >
          {update.busy
            ? t("shields.list.updating")
            : list.status === "ready"
              ? t("shields.list.update")
              : t("shields.list.updateFirst")}
        </button>
        {list.status !== "never" && (
          <button
            type="button"
            className="btn"
            disabled={remove.busy}
            onClick={() => void doRemove()}
          >
            {t("shields.list.remove")}
          </button>
        )}
      </div>
      <Feedback error={update.error ?? toggle.error ?? remove.error} saved={note} />
    </li>
  );
}

function SiteList({
  data,
  replace,
}: {
  data: FilterListsPayload;
  replace: (data: FilterListsPayload) => void;
}) {
  const t = useT();
  const id = useId();
  const add = useAction();
  const drop = useAction();
  const [site, setSite] = useState("");
  const path = (name: string) => `${SHIELDS_PATH}/sites/${encodeURIComponent(name)}`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = site.trim();
    if (!name) return;
    const result = await add.run<{ shields: FilterListsPayload["shields"] }>("PUT", path(name), {
      blocking: false,
    });
    if (result) {
      replace({ ...data, shields: result.shields });
      setSite("");
    }
  };
  const turnOn = async (name: string) => {
    const result = await drop.run<{ shields: FilterListsPayload["shields"] }>("PUT", path(name), {
      blocking: true,
    });
    if (result) replace({ ...data, shields: result.shields });
  };

  return (
    <>
      <h3 className="h3">{t("shields.sites.title")}</h3>
      <p className="muted small">{t("shields.sites.hint")}</p>
      {data.shields.offSites.length === 0 ? (
        <p className="muted small">{t("shields.sites.empty")}</p>
      ) : (
        <ul className="card-list" aria-label={t("shields.sites.title")}>
          {data.shields.offSites.map((name) => (
            <li key={name} className="card">
              <span className="memory-text">{name}</span>{" "}
              <button
                type="button"
                className="btn"
                disabled={drop.busy}
                onClick={() => void turnOn(name)}
              >
                {t("shields.sites.remove", { site: name })}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Feedback error={drop.error} />
      <form onSubmit={(event) => void submit(event)}>
        <label className="field" htmlFor={`${id}-site`}>
          {t("shields.sites.add.label")}
        </label>
        <input
          id={`${id}-site`}
          type="text"
          value={site}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setSite(event.target.value)}
        />
        <div className="button-row">
          <button type="submit" className="btn" disabled={add.busy || !site.trim()}>
            {t("shields.sites.add.submit")}
          </button>
        </div>
        <Feedback error={add.error} />
      </form>
    </>
  );
}
