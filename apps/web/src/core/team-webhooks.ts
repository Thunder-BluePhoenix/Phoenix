// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 92: incoming webhook sources as Core reports them. A source's signing secret is shown by
// Core exactly once, in the response to creating or rotating it; it is never part of the list this
// hook holds. The validation below repeats Core's own rules (core/runtime/src/team-status/
// webhook-schema.ts) so a mistake is caught before the request; Core still decides.
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./client";
import { useClient } from "./context";

export const TEAM_WEBHOOKS_PATH = "/api/team/webhooks";
export const TEAM_WEBHOOK_SOURCES_PATH = "/api/team/webhooks/sources";

/** Same rule as Core's `WEBHOOK_SOURCE_ID`. */
const SOURCE_ID = /^[a-z][a-z0-9_-]{2,31}$/;
const EVENT_TYPE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
const MAX_EVENT_TYPE_LENGTH = 200;
export const WEBHOOK_NAMESPACES: readonly string[] = [
  "build",
  "test",
  "deploy",
  "ci",
  "alert",
  "monitor",
  "release",
  "task",
  "webhook",
];
export const MAX_WEBHOOK_EVENT_TYPES = 16;
export const MAX_WEBHOOK_SOURCES = 16;

export interface WebhookSource {
  id: string;
  /** Where the sender POSTs, relative to Core's address. */
  path: string;
  eventTypes: string[];
  enabled: boolean;
  createdAt: string;
  lastAcceptedAt: string | null;
}

export interface WebhookStatus {
  enabled: boolean;
  sources: WebhookSource[];
}

/** The response to creating or rotating a source: the only place a secret ever appears. */
export interface WebhookSourceSecret {
  source: WebhookSource;
  secret: string;
}

export type SourceIdProblem = "empty" | "invalid";
export type EventTypesProblem = "empty" | "tooMany" | "invalid" | "namespace";

export function sourceIdProblem(id: string): SourceIdProblem | null {
  if (id === "") return "empty";
  return SOURCE_ID.test(id) ? null : "invalid";
}

/** Splits what the user typed (commas or white space between types) into distinct types, in order. */
export function splitEventTypes(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).filter((type) => type !== ""))];
}

export function eventTypesProblem(types: readonly string[]): EventTypesProblem | null {
  if (types.length === 0) return "empty";
  if (types.length > MAX_WEBHOOK_EVENT_TYPES) return "tooMany";
  for (const type of types) {
    if (type.length > MAX_EVENT_TYPE_LENGTH || !EVENT_TYPE.test(type)) return "invalid";
    if (!WEBHOOK_NAMESPACES.includes(type.slice(0, type.indexOf(".")))) return "namespace";
  }
  return null;
}

// Control, line-break and invisible format (bidi, zero-width) characters: they can reorder or hide
// the text around them, so they never reach the screen.
const HIDDEN =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g;
const MAX_SHOWN = 64;

/** Text from Core that is shown as a label: no hidden characters, bounded length. Still rendered as text. */
export function cleanLabel(value: string): string {
  const clean = value.replace(HIDDEN, "");
  return clean.length > MAX_SHOWN ? `${clean.slice(0, MAX_SHOWN)}…` : clean;
}

/** `absent`: Core has no such route (no OS secret store). `failed`: any other error, with Core's words. */
export type WebhooksLoad =
  | { phase: "loading" }
  | { phase: "absent" }
  | { phase: "failed"; message: string | null }
  | { phase: "ready"; status: WebhookStatus };

/** The webhook sources, re-read on demand and when Core comes back online. Holds no secret. */
export function useTeamWebhooks() {
  const client = useClient();
  const [load, setLoad] = useState<WebhooksLoad>({ phase: "loading" });
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const status = await client.request<WebhookStatus>("GET", TEAM_WEBHOOKS_PATH);
      if (alive.current) setLoad({ phase: "ready", status });
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof ApiError && err.status === 404) setLoad({ phase: "absent" });
      else setLoad({ phase: "failed", message: err instanceof ApiError ? err.message : null });
    }
  }, [client]);

  /** Replaces the list with the one a change just returned. */
  const applyStatus = useCallback((status: WebhookStatus) => {
    setLoad((current) => (current.phase === "ready" ? { phase: "ready", status } : current));
  }, []);

  useEffect(() => {
    alive.current = true;
    void reload();
    const offStatus = client.statusChanged.on((s) => s === "online" && void reload());
    return () => {
      alive.current = false;
      offStatus();
    };
  }, [client, reload]);

  return { load, reload, applyStatus };
}
