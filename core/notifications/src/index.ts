// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { randomBytes } from "node:crypto";
import type { EventBus } from "@phoenix/event-bus";
import { silentLogger, type Logger } from "@phoenix/logging";
import { SettingsStore, type Database } from "@phoenix/persistence";
import {
  createEvent,
  ErrorCode,
  PhoenixError,
  type PhoenixEvent,
  type Severity,
} from "@phoenix/protocol";
import type { StateEngine } from "@phoenix/state-engine";

export interface Notification {
  id: string;
  eventId: string | null;
  eventType: string | null;
  source: string | null;
  severity: Severity;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationPreferences {
  enabled: boolean;
  /** Lowest severity that notifies on its own (requires_action always notifies). */
  min_severity: "warning" | "error";
  /** Sources (capability ids) that never notify. */
  muted_sources: string[];
}

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  enabled: true,
  min_severity: "warning",
  muted_sources: [],
};

const PREFS_KEY = "notifications.preferences";
const SEVERITY_RANK: Record<Severity, number> = { info: 0, success: 1, warning: 2, error: 3 };

/** Successful outcomes worth telling the user about even though they are not problems. */
const ALWAYS_NOTIFY = new Set(["kage.summary.ready"]);

/** Bookkeeping events that never notify on their own. */
const NEVER_NOTIFY_PREFIXES = [
  "pet.",
  "notification.",
  "system.",
  "capability.health",
  "capability.registered",
];

const DUPLICATE_WINDOW_MS = 30_000;
const MAX_STORED = 1000;

export interface NotificationServiceOptions {
  db: Database;
  bus: EventBus;
  state: StateEngine;
  logger?: Logger;
  now?: () => number;
}

/**
 * Turns important events into user notifications (PRD v1 FR-013): errors,
 * warnings, anything needing the user's action, and a few notable successes.
 * Notifications are stored locally and announced as `notification.created`.
 */
export class NotificationService {
  private readonly settings: SettingsStore;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly recent = new Map<string, number>();
  private readonly unsubscribe: () => void;

  constructor(private readonly o: NotificationServiceOptions) {
    this.settings = new SettingsStore(o.db);
    this.logger = (o.logger ?? silentLogger).child("notifications");
    this.now = o.now ?? Date.now;
    this.unsubscribe = o.bus.subscribe("notifications", "*", (event) => {
      this.consider(event);
    });
  }

  close(): void {
    this.unsubscribe();
  }

  preferences(): NotificationPreferences {
    return {
      ...DEFAULT_PREFERENCES,
      ...this.settings.get<Partial<NotificationPreferences>>(PREFS_KEY, {}),
    };
  }

  setPreferences(input: unknown): NotificationPreferences {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, "preferences must be an object");
    }
    const p = input as Record<string, unknown>;
    const next = this.preferences();
    if (p.enabled !== undefined) {
      if (typeof p.enabled !== "boolean")
        throw new PhoenixError(ErrorCode.INVALID_REQUEST, '"enabled" must be a boolean');
      next.enabled = p.enabled;
    }
    if (p.min_severity !== undefined) {
      if (p.min_severity !== "warning" && p.min_severity !== "error") {
        throw new PhoenixError(
          ErrorCode.INVALID_REQUEST,
          '"min_severity" must be "warning" or "error"',
        );
      }
      next.min_severity = p.min_severity;
    }
    if (p.muted_sources !== undefined) {
      if (!Array.isArray(p.muted_sources) || !p.muted_sources.every((s) => typeof s === "string")) {
        throw new PhoenixError(
          ErrorCode.INVALID_REQUEST,
          '"muted_sources" must be a list of strings',
        );
      }
      next.muted_sources = [...new Set(p.muted_sources as string[])];
    }
    this.settings.set(PREFS_KEY, next);
    return next;
  }

  /** Newest first. */
  list(options: { unreadOnly?: boolean; limit?: number } = {}): {
    notifications: Notification[];
    unread: number;
  } {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const rows = this.o.db
      .prepare(
        `SELECT * FROM notifications ${options.unreadOnly ? "WHERE read = 0" : ""} ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(limit) as Record<string, string | number | null>[];
    return { notifications: rows.map(toNotification), unread: this.unreadCount() };
  }

  unreadCount(): number {
    return (
      this.o.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE read = 0").get() as {
        n: number;
      }
    ).n;
  }

  markRead(id: string): Notification {
    const result = this.o.db.prepare("UPDATE notifications SET read = 1 WHERE id = ?").run(id);
    if (result.changes === 0)
      throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Notification not found");
    return toNotification(
      this.o.db.prepare("SELECT * FROM notifications WHERE id = ?").get(id) as Record<
        string,
        string | number | null
      >,
    );
  }

  markAllRead(): number {
    return Number(
      this.o.db.prepare("UPDATE notifications SET read = 1 WHERE read = 0").run().changes,
    );
  }

  /** Decides whether an event deserves a notification; returns it if created. */
  consider(event: PhoenixEvent): Notification | null {
    if (!this.shouldNotify(event)) return null;
    const title = this.o.state.describe(event);
    const dedupKey = `${event.source}|${event.subject ?? ""}|${title}`;
    const nowMs = this.now();
    const last = this.recent.get(dedupKey);
    if (last !== undefined && nowMs - last < DUPLICATE_WINDOW_MS) return null;
    this.recent.set(dedupKey, nowMs);
    if (this.recent.size > 500) this.recent.delete(this.recent.keys().next().value!);

    const n: Notification = {
      id: `ntf_${nowMs.toString(36)}${randomBytes(5).toString("hex")}`,
      eventId: event.event_id,
      eventType: event.event_type,
      source: event.source === "core" && event.subject ? event.subject : event.source,
      severity: event.severity,
      title,
      body:
        event.subject && event.source !== "core"
          ? `${event.source} · ${event.subject}`
          : event.source === "core"
            ? null
            : event.source,
      read: false,
      createdAt: new Date(nowMs).toISOString(),
    };
    this.o.db
      .prepare(
        "INSERT INTO notifications (id, event_id, severity, title, body, read, created_at, source, event_type) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)",
      )
      .run(n.id, n.eventId, n.severity, n.title, n.body, n.createdAt, n.source, n.eventType);
    this.o.db
      .prepare(
        "DELETE FROM notifications WHERE rowid NOT IN (SELECT rowid FROM notifications ORDER BY created_at DESC LIMIT ?)",
      )
      .run(MAX_STORED);

    const published = this.o.bus.publish(
      createEvent({
        event_type: "notification.created",
        source: "core",
        severity: n.severity,
        payload: { notification: n as unknown as Record<string, unknown> },
      }),
      { ephemeral: true },
    );
    if (!published.ok)
      this.logger.warn("failed to announce notification", { code: published.error.code });
    return n;
  }

  private shouldNotify(event: PhoenixEvent): boolean {
    const prefs = this.preferences();
    if (!prefs.enabled) return false;
    if (NEVER_NOTIFY_PREFIXES.some((p) => event.event_type.startsWith(p))) return false;
    const origin = event.source === "core" && event.subject ? event.subject : event.source;
    if (prefs.muted_sources.includes(origin)) return false;
    // A user rejecting an action does not need to be told about it.
    if (
      event.event_type === "capability.command.failed" &&
      event.payload.code === "PERMISSION_DENIED"
    )
      return false;
    // The resolution of an approval request is the user's own action.
    if (event.event_type === "security.confirmation.resolved") return false;
    if (event.requires_action === true) return true;
    if (ALWAYS_NOTIFY.has(event.event_type)) return true;
    return SEVERITY_RANK[event.severity] >= SEVERITY_RANK[prefs.min_severity];
  }
}

function toNotification(r: Record<string, string | number | null>): Notification {
  return {
    id: String(r.id),
    eventId: r.event_id === null ? null : String(r.event_id),
    eventType: r.event_type === null ? null : String(r.event_type),
    source: r.source === null ? null : String(r.source),
    severity: r.severity as Severity,
    title: String(r.title),
    body: r.body === null ? null : String(r.body),
    read: Number(r.read) === 1,
    createdAt: String(r.created_at),
  };
}
