// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { resolve } from "node:path";
import type { CapabilityManager } from "@phoenix/capability-manager";
import type { NotificationService } from "@phoenix/notifications";
import type { AuditLog } from "@phoenix/permissions";
import type { EventStore, MeetingStore, SettingsStore } from "@phoenix/persistence";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";

/** Data classes the user can set retention for and delete. */
export const DATA_CLASSES = ["events", "notifications", "meetings", "memory"] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

/**
 * Classes with one retention number here. Memory is not one of them: its retention is set per
 * layer (working, episodic, project, preference) in the memory settings.
 */
export type RetainedClass = Exclude<DataClass, "memory">;
const RETAINED_CLASSES: readonly RetainedClass[] = ["events", "notifications", "meetings"];

/** Days to keep each class; null keeps it until deleted (bounded by count limits). */
export type Retention = Record<RetainedClass, number | null>;

const RETENTION_KEY = "privacy.retention";
const DEFAULT_RETENTION: Retention = { events: null, notifications: null, meetings: null };

const DESCRIPTIONS: Record<DataClass, string> = {
  events: "What capabilities reported: commands, builds, meetings, Git.",
  notifications: "Alerts Fawkes showed you.",
  meetings: "Phoenix's copy of details, transcripts and summaries (recordings stay in Kage).",
  memory:
    "What Fawkes remembers: commit messages, project docs you listed and, if you allow it, meeting summaries. Retention is set per kind of memory in the memory settings.",
};

/** Data Phoenix computed from a data class (vectors, graph, review items): listed, never retained alone. */
export interface DerivedInventory {
  id: string;
  description: string;
  count: number;
  /** The data class or classes whose deletion removes it. */
  deleted_with: string;
  [extra: string]: unknown;
}

export interface PrivacyDeps {
  dataDir: string;
  settings: SettingsStore;
  events: EventStore;
  notifications: NotificationService;
  meetings: MeetingStore;
  capabilities: CapabilityManager;
  audit: AuditLog;
  memory: {
    /** Memories the owner can see. */
    count(): number;
    retentionByLayer(): Record<string, number | null>;
    /** Deletes every memory (and its index entries); returns how many. */
    deleteAll(): number;
  };
  /** Derived data to list in the inventory, counted now. */
  derived(): DerivedInventory[];
  /** One sentence about what is sent to AI providers, derived from the live AI settings. */
  externalAi(): string;
}

/** What Phoenix stores, for how long, and deleting it (PRD v2.0 §19, FR-014). */
export class PrivacyService {
  constructor(private readonly d: PrivacyDeps) {}

  retention(): Retention {
    return { ...DEFAULT_RETENTION, ...this.d.settings.get<Partial<Retention>>(RETENTION_KEY, {}) };
  }

  setRetention(input: unknown, by = "user"): Retention {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, "retention must be an object");
    }
    const next = this.retention();
    for (const [key, value] of Object.entries(input)) {
      if (key === "memory") {
        throw new PhoenixError(
          ErrorCode.INVALID_REQUEST,
          "Memory retention is set per kind of memory in the memory settings",
        );
      }
      if (!(RETAINED_CLASSES as readonly string[]).includes(key)) {
        throw new PhoenixError(
          ErrorCode.INVALID_REQUEST,
          `Unknown data class "${key.slice(0, 40)}"`,
        );
      }
      if (value !== null && !(Number.isInteger(value) && value >= 1 && value <= 3650)) {
        throw new PhoenixError(ErrorCode.INVALID_REQUEST, `"${key}" must be 1-3650 days or null`);
      }
      next[key as RetainedClass] = value as number | null;
    }
    this.d.settings.set(RETENTION_KEY, next);
    this.d.audit.record({
      actor: by,
      action: "privacy.retention.changed",
      decision: "info",
      details: { ...next },
    });
    this.prune();
    return next;
  }

  /** Applies retention now. Returns how many records each class lost. */
  prune(now = Date.now()): Record<RetainedClass, number> {
    const r = this.retention();
    const cutoff = (days: number | null) =>
      days === null ? null : new Date(now - days * 86_400_000).toISOString();
    const removed = { events: 0, notifications: 0, meetings: 0 };
    const events = cutoff(r.events);
    if (events) removed.events = this.d.events.deleteBefore(events);
    const notes = cutoff(r.notifications);
    if (notes) removed.notifications = this.d.notifications.deleteBefore(notes);
    const meetings = cutoff(r.meetings);
    if (meetings) removed.meetings = this.d.meetings.deleteBefore(meetings);
    return removed;
  }

  /** Deletes every record of one class. The audit log records that it happened. */
  deleteAll(kind: unknown, confirm: unknown, by = "user"): { deleted: number } {
    if (!(DATA_CLASSES as readonly unknown[]).includes(kind)) {
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        `"data" must be one of ${DATA_CLASSES.join(", ")}`,
      );
    }
    if (confirm !== true) {
      throw new PhoenixError(
        ErrorCode.ACTION_REQUIRES_CONFIRMATION,
        'Deleting data needs {"confirm": true}',
      );
    }
    const deleted =
      kind === "events"
        ? this.d.events.deleteBefore()
        : kind === "notifications"
          ? this.d.notifications.deleteBefore()
          : kind === "meetings"
            ? this.d.meetings.deleteBefore()
            : this.d.memory.deleteAll();
    this.d.audit.record({
      actor: by,
      action: "privacy.data.deleted",
      decision: "info",
      details: { data: kind, deleted },
    });
    return { deleted };
  }

  inventory() {
    const r = this.retention();
    const counts: Record<DataClass, number> = {
      events: this.d.events.count(),
      notifications: this.d.notifications.count(),
      meetings: this.d.meetings.count(),
      memory: this.d.memory.count(),
    };
    const layers = this.d.memory.retentionByLayer();
    const kept = Object.values(layers);
    // One number for the row: the longest any kind of memory is kept (null = some kind forever).
    const longest = kept.includes(null) ? null : Math.max(...(kept as number[]));
    return {
      location: resolve(this.d.dataDir),
      data: DATA_CLASSES.map((id) => ({
        id,
        description: DESCRIPTIONS[id],
        count: counts[id],
        retention_days: id === "memory" ? longest : r[id],
        ...(id === "memory" ? { retention_by_layer: layers } : {}),
      })),
      audit_log: {
        description:
          "Security record of permissions, approvals and deletions. Kept so actions stay accountable; never sent anywhere.",
        count: this.d.audit.count(),
      },
      derived: this.d.derived(),
      credentials: this.d.capabilities
        .list()
        .flatMap((c) =>
          c.secrets.filter((s) => s.set).map((s) => ({ capability: c.id, name: s.name })),
        )
        .map((c) => ({ ...c, stored_in: "OS keychain" })),
      telemetry: "none",
      external_ai: this.d.externalAi(),
    };
  }
}
