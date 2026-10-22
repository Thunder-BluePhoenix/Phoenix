// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useCallback, useEffect, useState } from "react";
import {
  calendarLink,
  prepLink,
  type CalendarEventView,
  type CalendarPrepSource,
  type CalendarUpcomingView,
} from "../core/calendar";
import { useClient } from "../core/context";
import { formatDate, formatTime } from "../core/format";
import { useT } from "../i18n";

const UPCOMING_PATH = "/api/calendar/upcoming";

/** Opens the Meetings page, where the notetaker's own consent dialog runs. Never starts recording. */
function openMeetings() {
  window.location.hash = "#/meetings";
}

function SourceList({ heading, items }: { heading: string; items: CalendarPrepSource[] }) {
  const t = useT();
  if (!items.length) return null;
  return (
    <>
      <h4>{heading}</h4>
      <ul>
        {items.map((item, i) => {
          const href = prepLink(item.href);
          return (
            <li key={`${item.href}:${i}`}>
              {item.text}{" "}
              {href ? (
                <a href={href}>{t("calendar.source", { meeting: item.meetingTitle })}</a>
              ) : (
                <span className="muted small">
                  {t("calendar.source", { meeting: item.meetingTitle })}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function CalendarPrepPage({
  load,
  onStartNotetaker = openMeetings,
}: {
  /** Injection seam: production reads authenticated Core; tests and unavailable routes inject data. */
  load?: () => Promise<CalendarUpcomingView>;
  /**
   * One click opens the notetaker suggestion; recording itself starts only through the existing
   * consent dialog, so this handler must never begin a recording.
   */
  onStartNotetaker?: (event: CalendarEventView) => void;
}) {
  const client = useClient();
  const t = useT();
  const [view, setView] = useState<CalendarUpcomingView | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    setError(false);
    void (load ? load() : client.request<CalendarUpcomingView>("GET", UPCOMING_PATH))
      .then((value) => {
        if (live) setView(value);
      })
      .catch(() => {
        if (live) {
          setView(null);
          setError(true);
        }
      });
    return () => {
      live = false;
    };
  }, [client, load, reload]);

  const refresh = useCallback(() => {
    setView(null);
    setReload((n) => n + 1);
  }, []);

  return (
    <section className="card" aria-labelledby="calendar-title">
      <h1 id="calendar-title">{t("calendar.title")}</h1>
      <button type="button" className="btn" onClick={refresh}>
        {t("calendar.refresh")}
      </button>
      {error && <p role="alert">{t("calendar.error")}</p>}
      {!view && !error && <p role="status">{t("calendar.loading")}</p>}
      {view && !view.enabled && <p role="status">{t("calendar.disabled")}</p>}
      {view && view.enabled && view.status === "unconfigured" && (
        <p role="status">{t("calendar.unconfigured")}</p>
      )}
      {view && view.enabled && view.status === "unavailable" && (
        <p role="alert">{t("calendar.unavailable")}</p>
      )}
      {view && view.enabled && view.status === "stale" && <p role="alert">{t("calendar.stale")}</p>}
      {view && view.enabled && view.status !== "ready" && view.checkedAt !== null && (
        <p className="muted small">
          {t("calendar.lastChecked", {
            time: `${formatDate(new Date(view.checkedAt).toISOString())} ${formatTime(new Date(view.checkedAt).toISOString())}`,
          })}
        </p>
      )}
      {view && view.enabled && view.status === "ready" && !view.prepComplete && (
        <p role="status">{t("calendar.prepIncomplete")}</p>
      )}
      {view && view.enabled && view.status === "ready" && view.events.length === 0 && (
        <p>{t("calendar.empty")}</p>
      )}
      {view && view.enabled && view.status === "ready" && view.events.length > 0 && (
        <ul className="calendar-events">
          {view.events.map((event) => {
            const prep = event.private ? undefined : view.prep[event.id];
            const link = event.private ? undefined : calendarLink(event.url);
            const title = event.private ? t("calendar.busy") : event.title;
            return (
              <li key={event.id}>
                <article aria-label={title}>
                  <h2>{link ? <a href={link}>{title}</a> : title}</h2>
                  <p>
                    {formatDate(event.start)} {formatTime(event.start)} – {formatTime(event.end)}
                  </p>
                  {!event.private && event.deployFreeze && (
                    <p role="status">
                      <strong>{t("calendar.freeze")}</strong>
                    </p>
                  )}
                  {!event.private && (
                    <section aria-label={t("calendar.prep")}>
                      <h3>{t("calendar.prep")}</h3>
                      {prep && (prep.decisions.length > 0 || prep.actionItems.length > 0) ? (
                        <>
                          <SourceList heading={t("calendar.decisions")} items={prep.decisions} />
                          <SourceList heading={t("calendar.actions")} items={prep.actionItems} />
                        </>
                      ) : (
                        <p>{t("calendar.noPrep")}</p>
                      )}
                    </section>
                  )}
                  {!event.private && (
                    <p>
                      <button type="button" className="btn" onClick={() => onStartNotetaker(event)}>
                        {t("calendar.notetaker")}
                      </button>{" "}
                      <span className="muted small">{t("calendar.notetakerInfo")}</span>
                    </p>
                  )}
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
