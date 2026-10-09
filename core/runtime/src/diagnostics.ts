// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { WebSocketMetrics } from "@phoenix/api";
import type { CapabilityManager } from "@phoenix/capability-manager";
import type { BusMetrics } from "@phoenix/event-bus";
import { redact } from "@phoenix/logging";
import type { AuditLog } from "@phoenix/permissions";
import type { DeadLetterStore, EventStore } from "@phoenix/persistence";

/** How long one processing run took, with no way to tell which meeting it was. */
export interface ProcessingRun {
  capability: string;
  outcome: "ready" | "failed";
  duration_ms: number;
}

export interface CapabilityDiagnostics {
  id: string;
  version: string;
  kind: string;
  status: string;
  health: string;
  last_error?: string;
  granted_permissions: string[];
  commands: string[];
  events: string[];
  /** Names only. Values may hold URLs or paths. */
  config_keys: string[];
  secrets_set: string[];
}

/**
 * What a user can attach to a bug report (PRD v2.0 §21). It describes how Phoenix is
 * behaving, never what the user was doing: no event payloads or subjects, no meeting
 * titles, participants, transcripts or summaries, no configuration values, no secrets,
 * no file paths.
 */
export interface Diagnostics {
  generated_at: string;
  version: string;
  protocol: string;
  env: string;
  platform: { os: string; arch: string; node: string };
  uptime_ms: number;
  schema_version: number;
  kill_switch: boolean;
  pet: { state: string; recording: boolean; active_tasks: number };
  counts: { events: number; notifications: number; meetings: number; audit_entries: number };
  /** Counts only (Phase 35-38): never a memory, an item, a node label or a name. */
  derived: {
    vectors: number;
    graph_nodes: number;
    graph_edges: number;
    meeting_items: number;
    plans: number;
    workflow_runs: number;
  };
  bus: BusMetrics;
  websocket: WebSocketMetrics | null;
  capabilities: CapabilityDiagnostics[];
  dead_letters: {
    event_type: string;
    subscriber: string;
    attempts: number;
    error: string;
    failed_at: string;
  }[];
  recent_events: { seq: number; type: string; source: string; severity: string; at: string }[];
  recent_audit: { at: string; action: string; decision: string; capability?: string }[];
  processing: {
    runs: ProcessingRun[];
    average_ms: number | null;
    max_ms: number | null;
  };
}

/** The slice of Core's own health that the report repeats. */
export interface HealthFacts {
  version: string;
  protocol: string;
  env: string;
  uptime_ms: number;
  schema_version: number;
  kill_switch: boolean;
  pet: { state: string; recording: boolean };
  active_tasks: number;
  bus: BusMetrics;
  websocket: WebSocketMetrics | null;
}

export interface DiagnosticsDeps {
  health: HealthFacts;
  capabilities: CapabilityManager;
  events: EventStore;
  deadLetters: DeadLetterStore;
  audit: AuditLog;
  counts: Diagnostics["counts"];
  derived: Diagnostics["derived"];
  now?: () => number;
}

const RECENT = 50;
const MAX_RUNS = 20;

/** Meeting processing starts at `*.meeting.ended` and finishes at the first of these. */
const PROCESSING_END: Record<string, ProcessingRun["outcome"]> = {
  "summary.ready": "ready",
  "transcription.completed": "ready",
  "meeting.failed": "failed",
};

const suffix = (type: string) => type.split(".").slice(-2).join(".");

/** Pairs each meeting-ended event with the event that finished it, by correlation id. */
export function processingRuns(
  events: { event_type: string; source: string; timestamp: string; correlation_id?: string }[],
): ProcessingRun[] {
  const started = new Map<string, { at: number; source: string }>();
  const runs: ProcessingRun[] = [];
  for (const e of [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    if (!e.correlation_id) continue;
    const at = Date.parse(e.timestamp);
    if (Number.isNaN(at)) continue;
    if (suffix(e.event_type) === "meeting.ended") {
      started.set(e.correlation_id, { at, source: e.source });
      continue;
    }
    const outcome = PROCESSING_END[suffix(e.event_type)];
    const begin = started.get(e.correlation_id);
    if (!outcome || !begin) continue;
    started.delete(e.correlation_id);
    runs.push({ capability: begin.source, outcome, duration_ms: Math.max(0, at - begin.at) });
  }
  return runs;
}

export function collectDiagnostics(d: DiagnosticsDeps): Diagnostics {
  const runs = processingRuns(
    d.events
      .recent({ limit: 1000 })
      .map((r) => r.event)
      .filter((e) => e.event_type.startsWith("kage.")),
  );
  const durations = runs.map((r) => r.duration_ms);

  const report: Diagnostics = {
    generated_at: new Date((d.now ?? Date.now)()).toISOString(),
    version: d.health.version,
    protocol: d.health.protocol,
    env: d.health.env,
    platform: { os: process.platform, arch: process.arch, node: process.version },
    uptime_ms: d.health.uptime_ms,
    schema_version: d.health.schema_version,
    kill_switch: d.health.kill_switch,
    pet: { ...d.health.pet, active_tasks: d.health.active_tasks },
    counts: d.counts,
    derived: d.derived,
    bus: d.health.bus,
    websocket: d.health.websocket,
    capabilities: d.capabilities.list().map((c) => ({
      id: c.id,
      version: c.version,
      kind: c.kind,
      status: c.status,
      health: c.health.status,
      ...(c.lastError ? { last_error: c.lastError.slice(0, 200) } : {}),
      granted_permissions: c.permissions.filter((p) => p.granted).map((p) => p.permission),
      commands: c.commands.map((x) => x.name),
      events: c.events,
      config_keys: Object.keys(c.config),
      secrets_set: c.secrets.filter((s) => s.set).map((s) => s.name),
    })),
    dead_letters: d.deadLetters.list(RECENT).map((l) => ({
      event_type: l.event.event_type,
      subscriber: l.subscriber,
      attempts: l.attempts,
      error: l.error.slice(0, 200),
      failed_at: l.failedAt,
    })),
    recent_events: d.events.recent({ limit: RECENT }).map((r) => ({
      seq: r.seq,
      type: r.event.event_type,
      source: r.event.source,
      severity: r.event.severity,
      at: r.event.timestamp,
    })),
    recent_audit: d.audit.list({ limit: RECENT }).map((a) => ({
      at: a.ts,
      action: a.action,
      decision: a.decision,
      ...(a.capabilityId ? { capability: a.capabilityId } : {}),
    })),
    processing: {
      runs: runs.slice(-MAX_RUNS),
      average_ms: durations.length
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null,
      max_ms: durations.length ? Math.max(...durations) : null,
    },
  };
  // Belt and braces: anything secret-shaped that slipped into free text is removed.
  return redact(report) as Diagnostics;
}
