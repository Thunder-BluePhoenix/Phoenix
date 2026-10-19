// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useId, useMemo, useState } from "react";
import { formatTime, SEVERITY_LABEL } from "../core/format";
import { useActivity } from "../core/hooks";
import { useT } from "../i18n";

const SEVERITIES = ["error", "warning", "success", "info"] as const;

/** Recent events with source and severity filters (PRD v2.0 §5.3 "Activity"). */
export function ActivityFeed() {
  const t = useT();
  const { items, error } = useActivity();
  const [source, setSource] = useState("all");
  const [severities, setSeverities] = useState<Set<string>>(new Set(SEVERITIES));
  const sourceId = useId();

  const sources = useMemo(() => [...new Set(items.map((i) => i.event.source))].sort(), [items]);
  const visible = items.filter(
    (i) => (source === "all" || i.event.source === source) && severities.has(i.event.severity),
  );

  const toggle = (s: string) =>
    setSeverities((cur) => {
      const next = new Set(cur);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  return (
    <div className="activity">
      <div className="filters">
        <label htmlFor={sourceId}>{t("common.label.source")}</label>
        <select id={sourceId} value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="all">{t("agents.activity.allSources")}</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <div className="chips" role="group" aria-label={t("agents.activity.severity")}>
          {SEVERITIES.map((s) => (
            <button
              key={s}
              type="button"
              className={`chip sev-${s}`}
              aria-pressed={severities.has(s)}
              onClick={() => toggle(s)}
            >
              {SEVERITY_LABEL[s]}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="error-text">{error}</p>}
      {visible.length === 0 ? (
        <p className="muted">
          {items.length > 0 ? t("agents.activity.emptyFiltered") : t("agents.activity.emptyNone")}
        </p>
      ) : (
        <ol className="feed" aria-label={t("agents.activity.feedLabel")}>
          {visible.map(({ seq, event, description }) => (
            <li key={seq} className={`feed-item sev-${event.severity}`}>
              <time dateTime={event.timestamp} className="muted small">
                {formatTime(event.timestamp)}
              </time>
              <span className={`sev-badge sev-${event.severity}`}>
                {SEVERITY_LABEL[event.severity]}
              </span>
              <span className="feed-text">{description ?? event.event_type}</span>
              <span className="muted small">{event.source}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
