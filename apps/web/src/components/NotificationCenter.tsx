// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useId, useRef, useState } from "react";
import { formatTime, SEVERITY_LABEL } from "../core/format";
import { useNotifications } from "../core/hooks";

/** Bell with unread count and a list of recent notifications (PRD v1 FR-013). */
export function NotificationCenter() {
  const { items, unread, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";
  return (
    <div className="notif" ref={root}>
      <button
        ref={button}
        type="button"
        className="icon-button bell"
        aria-label={label}
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"
          />
        </svg>
        {unread > 0 && (
          <span className="badge" aria-hidden="true">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div id={popoverId} className="notif-popover" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button type="button" className="link-button" onClick={() => void markAllRead()}>
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="muted">You're all caught up.</p>
          ) : (
            <ul className="notif-list">
              {items.map((n) => (
                <li
                  key={n.id}
                  className={`notif-item sev-${n.severity} ${n.read ? "read" : "unread"}`}
                >
                  <div>
                    <span className={`sev-badge sev-${n.severity}`}>
                      {SEVERITY_LABEL[n.severity]}
                    </span>{" "}
                    <span className="notif-title">{n.title}</span>
                    <p className="muted small">
                      {formatTime(n.createdAt)}
                      {n.source && <> · {n.source}</>}
                    </p>
                  </div>
                  {!n.read && (
                    <button
                      type="button"
                      className="link-button small"
                      onClick={() => void markRead(n.id)}
                      aria-label={`Mark "${n.title}" as read`}
                    >
                      Mark read
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
