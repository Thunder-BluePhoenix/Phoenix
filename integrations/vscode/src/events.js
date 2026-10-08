// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Builds the editor.* events and the capability manifest. Nothing here imports `vscode`, so all of
// it is unit-tested without an editor.
//
// Privacy contract: events carry the workspace's display name, task names and exit codes, and
// diagnostic COUNTS. They never carry file paths, file contents, diagnostic messages, task command
// lines or arguments, or environment variables.
"use strict";

const { randomUUID } = require("node:crypto");

const EXTENSION_VERSION = "0.1.0";
const PROTOCOL_VERSION = "1.1";
const MAX_TEXT = 120;

/**
 * Printable, bounded text from an editor-supplied label.
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function label(value, fallback) {
  // eslint-disable-next-line no-control-regex
  const clean =
    typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
  if (!clean) return fallback;
  return clean.length > MAX_TEXT ? clean.slice(0, MAX_TEXT - 1) + "…" : clean;
}

/**
 * @typedef {object} EditorEvent
 * @property {string} event_id
 * @property {string} event_type
 * @property {string} version
 * @property {"editor"} source
 * @property {string} timestamp
 * @property {"info" | "success" | "warning" | "error"} severity
 * @property {string} [subject]
 * @property {string} [correlation_id]
 * @property {Record<string, unknown>} payload
 */

/**
 * @param {string} type
 * @param {EditorEvent["severity"]} severity
 * @param {{ subject?: string, correlationId?: string, payload?: Record<string, unknown> }} [fields]
 * @param {() => Date} [now]
 * @returns {EditorEvent}
 */
function envelope(type, severity, fields = {}, now = () => new Date()) {
  return {
    event_id: `evt_${randomUUID().replaceAll("-", "")}`,
    event_type: type,
    version: PROTOCOL_VERSION,
    source: "editor",
    timestamp: now().toISOString(),
    severity,
    ...(fields.subject ? { subject: fields.subject } : {}),
    ...(fields.correlationId ? { correlation_id: fields.correlationId } : {}),
    payload: fields.payload ?? {},
  };
}

/**
 * @param {{ name?: string, folderCount?: number }} input `name` is the editor's display name for
 *   the workspace (e.g. "phoenix"), never a path.
 * @param {() => Date} [now]
 */
function workspaceOpened({ name, folderCount = 0 }, now) {
  const workspace = label(name, "(no folder)");
  return envelope(
    "editor.workspace.opened",
    "info",
    {
      subject: workspace,
      payload: { workspace, folders: Math.max(0, Math.min(Math.trunc(folderCount) || 0, 1000)) },
    },
    now,
  );
}

/**
 * @typedef {object} TaskInfo
 * @property {string} [name]
 * @property {string} [source] "Workspace", "npm", or the contributing extension's name.
 * @property {string} [type] The task definition's type (shell, process, npm, ...).
 */

/**
 * Tracks running tasks and turns start/end notifications into events. A task's condition in Fawkes
 * is keyed by source+name, so running a task again replaces its earlier failure instead of piling
 * up errors; two simultaneous runs of the same task share one condition.
 * @param {{ now?: () => Date, clock?: () => number }} [options] `clock` returns milliseconds.
 */
function createTaskTracker({ now = () => new Date(), clock = Date.now } = {}) {
  /** @type {Map<unknown, { info: ResolvedTask, startedAt: number }>} */
  const running = new Map();

  /** @typedef {{ name: string, source: string, type: string, correlationId: string }} ResolvedTask */
  /** @param {TaskInfo} info @returns {ResolvedTask} */
  const resolve = (info) => {
    const name = label(info.name, "task");
    const source = label(info.source, "unknown");
    return {
      name,
      source,
      type: label(info.type, "unknown"),
      correlationId: `editor-task:${source}:${name}`,
    };
  };

  return {
    /**
     * @param {unknown} key Identifies this run (the editor's task execution object).
     * @param {TaskInfo} info
     */
    started(key, info) {
      const task = resolve(info);
      running.set(key, { info: task, startedAt: clock() });
      return envelope(
        "editor.task.started",
        "info",
        {
          subject: task.name,
          correlationId: task.correlationId,
          payload: { task: task.name, source: task.source, type: task.type },
        },
        now,
      );
    },
    /**
     * @param {unknown} key
     * @param {number | undefined} exitCode undefined: the process was terminated without an exit code.
     * @param {TaskInfo} [fallback] Used if this run's start was never seen.
     */
    ended(key, exitCode, fallback = {}) {
      const run = running.get(key);
      running.delete(key);
      const task = run?.info ?? resolve(fallback);
      const durationMs = run ? Math.max(0, Math.round(clock() - run.startedAt)) : undefined;
      const fields = {
        subject: task.name,
        correlationId: task.correlationId,
        payload: {
          task: task.name,
          source: task.source,
          type: task.type,
          ...(typeof exitCode === "number" ? { exit_code: exitCode } : {}),
          ...(durationMs === undefined ? {} : { duration_ms: durationMs }),
        },
      };
      if (typeof exitCode !== "number")
        return envelope("editor.task.cancelled", "info", fields, now);
      return exitCode === 0
        ? envelope("editor.task.passed", "success", fields, now)
        : envelope("editor.task.failed", "error", fields, now);
    },
    /** Number of runs started but not yet ended. */
    get active() {
      return running.size;
    },
  };
}

/**
 * @param {{ errors: number, warnings: number, previousErrors: number, previousWarnings: number }} counts
 * @param {() => Date} [now]
 */
function diagnosticsChanged(counts, now) {
  return envelope(
    "editor.diagnostics.changed",
    "info",
    {
      payload: {
        errors: counts.errors,
        warnings: counts.warnings,
        previous_errors: counts.previousErrors,
        previous_warnings: counts.previousWarnings,
      },
    },
    now,
  );
}

/**
 * The manifest the editor registers with Core (external capability protocol). Task failures are
 * ERROR and a running task is WORKING, like terminal commands. Diagnostics counts and workspace
 * events deliberately have no Fawkes state: a red squiggle while typing is not an incident.
 * @returns {Record<string, unknown>}
 */
function buildManifest() {
  return {
    id: "editor",
    name: "Editor (VS Code)",
    version: EXTENSION_VERSION,
    description:
      "Reports the VS Code workspace you opened, task results and the number of errors and warnings.",
    license: "GPL-3.0-or-later",
    events: ["editor.*"],
    commands: [],
    // Observing the workspace and its problems is what this permission discloses; the extension
    // sends names and counts only, never file paths or contents.
    permissions: ["filesystem_read"],
    data_categories: ["workspace name", "task names and exit codes", "error and warning counts"],
    healthcheck: { interval_ms: 15_000 },
    state_rules: [
      {
        match: "editor.task.started",
        effect: { state: "WORKING", explain: "Task {subject} running", timeoutMs: 30 * 60_000 },
      },
      {
        match: "editor.task.passed",
        effect: { state: "SUCCESS", explain: "Task {subject} passed", ttlMs: 4_000 },
      },
      {
        match: "editor.task.failed",
        effect: { state: "ERROR", explain: "Task {subject} failed" },
      },
      { match: "editor.task.cancelled", effect: { clear: true } },
    ],
  };
}

module.exports = {
  EXTENSION_VERSION,
  buildManifest,
  createTaskTracker,
  diagnosticsChanged,
  envelope,
  label,
  workspaceOpened,
};
