// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Save counting. Only a NUMBER leaves this module: the notification's document (its URI, name,
// language and text) is never read, so nothing here can say WHICH file was saved.
"use strict";

/**
 * Counts "a document was saved" notifications and reports the total once per quiet period, so a
 * "save all" or a format-on-save burst is one event with a count, not one event per file.
 *
 * @param {object} options
 * @param {(count: number) => void} options.report Called with how many saves happened since the last report.
 * @param {number} [options.quietMs] Wait this long after the last save (default 10 s).
 * @param {number} [options.maxWaitMs] Report at the latest this long after the first save of a
 *   burst, so continuous work still reports (default 60 s).
 * @param {(fn: () => void, ms: number) => unknown} [options.setTimer]
 * @param {(handle: unknown) => void} [options.clearTimer]
 * @param {() => number} [options.clock] Milliseconds.
 */
function createSaveCounter({
  report,
  quietMs = 10_000,
  maxWaitMs = 60_000,
  setTimer = setTimeout,
  clearTimer = (h) => clearTimeout(/** @type {NodeJS.Timeout} */ (h)),
  clock = Date.now,
}) {
  let count = 0;
  /** @type {unknown} */
  let timer;
  /** @type {number | undefined} */
  let burstStart;

  function flush() {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
    burstStart = undefined;
    const saves = count;
    count = 0;
    if (saves > 0) report(saves);
  }

  return {
    /** Call on every save notification. Takes no argument on purpose. */
    saved() {
      count++;
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
      count = 0;
      burstStart = undefined;
    },
  };
}

module.exports = { createSaveCounter };
