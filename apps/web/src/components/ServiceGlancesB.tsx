// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Read-only glances for Resend, Notion and Cal.com (Phase 67). Each one calls only the capability's
// `status` read command through Core, and shows what service-glances-b.ts lets through: Resend
// delivery counts, Notion titles and edit times, Cal.com booking times and attendee counts.
import { formatNumber } from "../core/format";
import {
  BOOKINGS_SHOWN,
  CAL_STATUS_TEXT,
  formatDateTime,
  parseCalGlance,
  parseNotionGlance,
  parseResendGlance,
  RESEND_BUCKETS,
  RESEND_BUCKET_TEXT,
  type NotionKind,
} from "../core/service-glances-b";
import { useLocale, useT, type MessageKey } from "../i18n";
import { ServiceGlanceFrame } from "./ServiceGlanceFrame";

const refreshOn = (prefix: string) => (type: string) => type.startsWith(prefix);

const NOTION_KIND_TEXT: Record<NotionKind, MessageKey> = {
  page: "services.glance.notion.kind.page",
  database: "services.glance.notion.kind.database",
  archived: "services.glance.notion.kind.archived",
};

/** Counts of the recent sent emails by delivery state. Never a subject, a recipient or a link. */
export function ResendGlance() {
  const t = useT();
  const { locale } = useLocale();
  return (
    <ServiceGlanceFrame
      id="resend"
      name="Resend"
      parse={parseResendGlance}
      notConfigured="services.glance.resend.notConfigured"
      empty="services.glance.resend.empty"
      isEmpty={(d) => d.total === 0}
      refreshOn={refreshOn("resend.email.")}
    >
      {(d) => (
        <>
          <p>{t("services.glance.resend.summary", { count: d.total })}</p>
          <ul className="task-list">
            {RESEND_BUCKETS.filter((b) => d.counts[b] > 0).map((b) => (
              <li key={b}>
                {t(RESEND_BUCKET_TEXT[b])}: <strong>{formatNumber(d.counts[b])}</strong>
              </li>
            ))}
          </ul>
          {d.newest && (
            <p className="muted small">
              {t("services.glance.resend.newest", { time: formatDateTime(d.newest, locale) })}
            </p>
          )}
          <p className="muted small">{t("services.glance.resend.privacy")}</p>
        </>
      )}
    </ServiceGlanceFrame>
  );
}

/** The watched Notion pages and databases: cleaned, clipped titles and edit times, no contents. */
export function NotionGlance() {
  const t = useT();
  const { locale } = useLocale();
  return (
    <ServiceGlanceFrame
      id="notion"
      name="Notion"
      parse={parseNotionGlance}
      notConfigured="services.glance.notion.notConfigured"
      empty="services.glance.notion.empty"
      isEmpty={(d) => d.items.length === 0}
      refreshOn={refreshOn("notion.")}
    >
      {(d) => (
        <>
          <p>{t("services.glance.notion.summary", { count: d.items.length })}</p>
          <ul className="task-list">
            {d.items.map((item) => {
              const title = item.title ?? t("services.glance.notion.untitled");
              return (
                <li key={item.id}>
                  <strong>{title}</strong>{" "}
                  <span className="muted small">
                    {t(NOTION_KIND_TEXT[item.kind])}
                    {item.at &&
                      ` · ${t("services.glance.notion.edited", { time: formatDateTime(item.at, locale) })}`}
                  </span>
                  {item.url && (
                    <>
                      {" "}
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={t("services.glance.notion.openNamed", { title })}
                      >
                        {t("services.glance.notion.open")}
                      </a>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="muted small">{t("services.glance.notion.privacy")}</p>
        </>
      )}
    </ServiceGlanceFrame>
  );
}

/** Upcoming Cal.com bookings: start time, status and attendee count. No titles, names or emails. */
export function CalComGlance() {
  const t = useT();
  const { locale } = useLocale();
  return (
    <ServiceGlanceFrame
      id="calcom"
      name="Cal.com"
      parse={parseCalGlance}
      notConfigured="services.glance.calcom.notConfigured"
      empty="services.glance.calcom.empty"
      isEmpty={(d) => d.bookings.length === 0}
      refreshOn={refreshOn("calcom.booking.")}
    >
      {(d) => (
        <>
          <p>{t("services.glance.calcom.summary", { count: d.bookings.length })}</p>
          <ul className="task-list">
            {d.bookings.slice(0, BOOKINGS_SHOWN).map((b) => (
              <li key={b.id}>
                <strong>{formatDateTime(b.start, locale)}</strong>{" "}
                <span className="muted small">
                  {t(CAL_STATUS_TEXT[b.status])}
                  {b.attendees !== undefined &&
                    ` · ${t("services.glance.calcom.attendees", { count: b.attendees })}`}
                </span>
              </li>
            ))}
          </ul>
          {d.bookings.length > BOOKINGS_SHOWN && (
            <p className="muted small">
              {t("services.glance.calcom.more", { count: d.bookings.length - BOOKINGS_SHOWN })}
            </p>
          )}
          <p className="muted small">{t("services.glance.calcom.privacy")}</p>
        </>
      )}
    </ServiceGlanceFrame>
  );
}
