// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { CoreClient } from "./client";
import { CoreError } from "./errors";
import { clean } from "./format";
import { parseEvents, type CoreEvent } from "./model";

/** The most events Core returns for one request. */
export const PAGE_LIMIT = 1000;

export interface EventFilter {
  source?: string;
  type?: string;
}

export function eventsPath(filter: EventFilter, limit: number, afterSeq?: number): string {
  const params = new URLSearchParams({ limit: String(limit) });
  if (afterSeq !== undefined) params.set("after_seq", String(afterSeq));
  if (filter.source) params.set("source", filter.source);
  if (filter.type) params.set("type", filter.type);
  return `/api/events?${params.toString()}`;
}

export function renderEvent(event: CoreEvent): string {
  const text = clean(event.description || event.type, 160);
  return `#${event.seq} ${clean(event.at, 30)} ${clean(event.severity, 10)} ${clean(event.source, 30)} ${clean(event.type, 60)}: ${text}`;
}

export interface TailOptions {
  client: CoreClient;
  filter: EventFilter;
  /** How many past events to show first. */
  initial: number;
  follow: boolean;
  intervalMs: number;
  signal: AbortSignal;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  emit: (event: CoreEvent) => void;
  warn: (text: string) => void;
}

/**
 * Prints the latest events oldest first, then (when following) polls for newer ones by sequence
 * number. Returns when the signal aborts or, without `follow`, after the first page. A transient
 * outage while following is reported once and retried; it never ends the tail.
 */
export async function tailEvents(options: TailOptions): Promise<void> {
  const { client, filter, signal } = options;
  const first =
    options.initial > 0
      ? parseEvents(
          await client.request(
            "GET",
            eventsPath(filter, clampLimit(options.initial)),
            undefined,
            signal,
          ),
        ).sort((a, b) => a.seq - b.seq)
      : [];
  for (const event of first) options.emit(event);
  if (!options.follow) return;

  // Unfiltered pages keep the cursor; with a filter the newest seq is still on the page or none.
  let cursor = await latestSeq(client, signal, first);
  let down = false;
  while (!signal.aborted) {
    try {
      await options.sleep(options.intervalMs, signal);
    } catch {
      return;
    }
    if (signal.aborted) return;
    try {
      const page = parseEvents(
        await client.request("GET", eventsPath(filter, PAGE_LIMIT, cursor), undefined, signal),
      ).sort((a, b) => a.seq - b.seq);
      if (down) options.warn("Core is reachable again");
      down = false;
      if (page.length >= PAGE_LIMIT) {
        options.warn("More events arrived than one page holds; the oldest of them were skipped");
      }
      for (const event of page) {
        options.emit(event);
        cursor = Math.max(cursor, event.seq);
      }
    } catch (err) {
      if (signal.aborted) return;
      if (
        !(err instanceof CoreError) ||
        err.kind === "unauthenticated" ||
        err.kind === "protocol"
      ) {
        throw err;
      }
      if (!down) options.warn(`${err.message} Retrying.`);
      down = true;
    }
  }
}

/**
 * The cursor to poll from: the newest sequence number in the whole history, so events that were
 * filtered out of the first page do not replay later.
 */
async function latestSeq(
  client: CoreClient,
  signal: AbortSignal,
  shown: readonly CoreEvent[],
): Promise<number> {
  const newest = parseEvents(await client.request("GET", eventsPath({}, 1), undefined, signal))[0];
  const fromShown = shown.reduce((max, e) => Math.max(max, e.seq), 0);
  return Math.max(newest?.seq ?? 0, fromShown);
}

function clampLimit(n: number): number {
  return Math.min(Math.max(Math.trunc(n), 1), PAGE_LIMIT);
}
