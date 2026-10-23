// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The shared frame of the per-service glances (Phase 67). It calls ONLY the capability's read
// command `status`, through Core's capability command route (never the service itself), and owns
// every state a glance has: not installed (nothing shown), turned off (a prompt that points at
// Capabilities), loading, error, not configured, empty, and stale (the last data, with a warning).
// It refreshes on a bounded interval only while the page is visible.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatAgo } from "../core/format";
import { useCapabilities, useCommandResult } from "../core/hooks";
import { cleanText, GLANCE_REFRESH_MS, httpsUrl, type GlanceItem } from "../core/service-glances";
import { useT, type MessageKey } from "../i18n";

const isVisible = () => document.visibilityState !== "hidden";

export interface ServiceGlanceFrameProps<T extends { configured: boolean }> {
  /** The capability id; its `status` command is the only thing called. */
  id: string;
  /** The service's brand name, shown as the heading. */
  name: string;
  /** Checks the raw command result; null when it is not the expected shape. */
  parse: (raw: unknown) => T | null;
  notConfigured: MessageKey;
  empty: MessageKey;
  isEmpty: (data: T) => boolean;
  /** Event types that make the glance read again (while the page is visible). */
  refreshOn?: (eventType: string) => boolean;
  children: (data: T) => ReactNode;
}

/** Re-reads every `GLANCE_REFRESH_MS` while the page is visible, and when it becomes visible again. */
function useVisibleRefresh(reload: () => Promise<void>) {
  const last = useRef(Date.now());
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    const run = () => {
      last.current = Date.now();
      void reloadRef.current();
    };
    const timer = window.setInterval(() => {
      if (isVisible()) run();
    }, GLANCE_REFRESH_MS);
    const onVisible = () => {
      if (isVisible() && Date.now() - last.current >= GLANCE_REFRESH_MS) run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}

function GlanceBody<T extends { configured: boolean }>({
  id,
  name,
  parse,
  notConfigured,
  empty,
  isEmpty,
  refreshOn,
  children,
}: ServiceGlanceFrameProps<T>) {
  const t = useT();
  const { data, error, reload } = useCommandResult<unknown>(
    id,
    "status",
    true,
    (type) => isVisible() && (refreshOn?.(type) ?? false),
  );
  useVisibleRefresh(reload);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  useEffect(() => {
    if (data !== null) setUpdatedAt(new Date().toISOString());
  }, [data]);

  const view = data === null ? null : parse(data);
  const unreadable = data !== null && view === null;
  const detail = error === null ? undefined : cleanText(error, 160);
  return (
    <section aria-labelledby={`service-glance-${id}-h`} className="service-glance">
      <h3 id={`service-glance-${id}-h`}>{t("services.glance.heading", { name })}</h3>
      {data === null && error === null && (
        <p className="muted small" role="status">
          {t("services.glance.loading")}
        </p>
      )}
      {error !== null && (
        <p className="error-text small" role="alert">
          {t(data === null ? "services.glance.error" : "services.glance.stale", { name })}
          {detail !== undefined && <span className="muted"> ({detail})</span>}
        </p>
      )}
      {unreadable && error === null && (
        <p className="error-text small" role="alert">
          {t("services.glance.unreadable", { name })}
        </p>
      )}
      {view !== null && !view.configured && (
        <p className="muted small" role="status">
          {t(notConfigured)}
        </p>
      )}
      {view !== null && view.configured && isEmpty(view) && (
        <p className="muted small">{t(empty)}</p>
      )}
      {view !== null && view.configured && !isEmpty(view) && children(view)}
      {view !== null && updatedAt !== null && (
        <p className="muted small">
          {t("services.glance.updated", { time: formatAgo(updatedAt) })}
        </p>
      )}
    </section>
  );
}

/**
 * One service's glance. Renders nothing while the capability is not installed, a short prompt while
 * it is installed but off (no command is called), and the read-only view once it is enabled.
 */
export function ServiceGlanceFrame<T extends { configured: boolean }>(
  props: ServiceGlanceFrameProps<T>,
) {
  const t = useT();
  const { data: caps } = useCapabilities();
  const capability = caps.find((c) => c.id === props.id);
  if (capability === undefined) return null;
  if (capability.status !== "enabled") {
    return (
      <section aria-labelledby={`service-glance-${props.id}-h`} className="service-glance">
        <h3 id={`service-glance-${props.id}-h`}>
          {t("services.glance.heading", { name: props.name })}
        </h3>
        <p className="muted small" role="status">
          {t("services.glance.disabled", { name: props.name })}
        </p>
      </section>
    );
  }
  return <GlanceBody {...props} />;
}

/** Items of a service as a list: title, state word, detail, time, and an https address as its host. */
export function GlanceItems({
  items,
  stateText,
}: {
  items: readonly GlanceItem[];
  stateText: (state: string) => string;
}) {
  return (
    <ul className="task-list service-glance-items">
      {items.map((item) => {
        const href = item.url === undefined ? undefined : httpsUrl(item.url);
        return (
          <li key={item.id}>
            <strong className="service-glance-title">{item.title}</strong>{" "}
            <span className="muted small">{stateText(item.state)}</span>
            {item.detail !== undefined && <div className="muted small">{item.detail}</div>}
            {item.at !== undefined && <div className="muted small">{formatAgo(item.at)}</div>}
            {href !== undefined && (
              <div className="small">
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {new URL(href).host}
                </a>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
