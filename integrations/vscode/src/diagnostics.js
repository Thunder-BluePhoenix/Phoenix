// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Diagnostics reporting. Only counts leave this module: the list the editor gives us contains file
// URIs and messages, and neither is ever read beyond `.severity`.
"use strict";

/** vscode.DiagnosticSeverity values. */
const SEVERITY_ERROR = 0;
const SEVERITY_WARNING = 1;

/**
 * @param {ReadonlyArray<readonly [unknown, ReadonlyArray<{ severity: number }>]>} entries
 *   What `vscode.languages.getDiagnostics()` returns.
 * @returns {{ errors: number, warnings: number }}
 */
function countDiagnostics(entries) {
  let errors = 0;
  let warnings = 0;
  for (const [, diagnostics] of entries) {
    for (const d of diagnostics) {
      if (d.severity === SEVERITY_ERROR) errors++;
      else if (d.severity === SEVERITY_WARNING) warnings++;
    }
  }
  return { errors, warnings };
}

/**
 * Collapses the editor's bursty "diagnostics changed" notifications (one per file per keystroke
 * while a language server catches up) into at most one event per quiet period, and only when the
 * totals actually differ from what was last reported.
 *
 * @param {object} options
 * @param {() => { errors: number, warnings: number }} options.read Current totals.
 * @param {(change: { errors: number, warnings: number, previousErrors: number, previousWarnings: number }) => void} options.report
 * @param {number} [options.quietMs] Wait this long after the last notification (default 3 s).
 * @param {number} [options.maxWaitMs] Report at the latest this long after the first notification
 *   of a burst, so a constantly changing project still reports (default 15 s).
 * @param {(fn: () => void, ms: number) => unknown} [options.setTimer]
 * @param {(handle: unknown) => void} [options.clearTimer]
 * @param {() => number} [options.clock] Milliseconds.
 */
function createDiagnosticsReporter({
  read,
  report,
  quietMs = 3_000,
  maxWaitMs = 15_000,
  setTimer = setTimeout,
  clearTimer = (h) => clearTimeout(/** @type {NodeJS.Timeout} */ (h)),
  clock = Date.now,
}) {
  let last = read();
  /** @type {unknown} */
  let timer;
  /** @type {number | undefined} */
  let burstStart;

  function flush() {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
    burstStart = undefined;
    const now = read();
    if (now.errors === last.errors && now.warnings === last.warnings) return;
    const change = {
      errors: now.errors,
      warnings: now.warnings,
      previousErrors: last.errors,
      previousWarnings: last.warnings,
    };
    last = now;
    report(change);
  }

  return {
    /** Call on every diagnostics-changed notification. */
    changed() {
      const t = clock();
      burstStart ??= t;
      if (timer !== undefined) clearTimer(timer);
      const wait = Math.max(0, Math.min(quietMs, burstStart + maxWaitMs - t));
      timer = setTimer(flush, wait);
    },
    /** Drops a pending report (the extension is deactivating). */
    dispose() {
      if (timer !== undefined) clearTimer(timer);
      timer = undefined;
    },
    /** Totals most recently reported (or the initial ones). */
    get last() {
      return last;
    },
  };
}

module.exports = { countDiagnostics, createDiagnosticsReporter, SEVERITY_ERROR, SEVERITY_WARNING };
