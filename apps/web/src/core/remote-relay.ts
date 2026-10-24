// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// Wire types of the remote-relay routes (core/api `remote-relay-routes.ts`) and the pure helpers the
// Settings section uses. Nothing here stores anything; the relay's private key never reaches the app.
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./client";
import { useClient } from "./context";

export const REMOTE_RELAY_PATH = "/api/remote-relay";

/** GET/POST/DELETE /api/remote-relay. `route` and `core_public_key` are null while the relay is off. */
export interface RemoteRelayStatus {
  enabled: boolean;
  connected: boolean;
  url: string | null;
  route: string | null;
  core_public_key: string | null;
  /** Written by Core from what a relay or a device did: untrusted text. */
  last_error: string | null;
}

/** How often the status is re-read while the relay is on, so "connected" stays true to life. */
export const RELAY_POLL_MS = 5_000;

/** Core refuses a longer address. */
export const MAX_RELAY_URL = 300;

export type RelayUrlProblem = "empty" | "tooLong" | "notUrl" | "https" | "credentials";

/**
 * The same checks Core makes on `url` (`relayUrl` in core/runtime/src/remote-relay/stream.ts): at
 * most 300 characters, a URL, `https:` (plain `http:` only for this computer), and no credentials,
 * query or fragment. Core stays the authority; this only saves a round trip and explains the refusal.
 */
export function relayUrlProblem(text: string): RelayUrlProblem | null {
  if (text.length === 0) return "empty";
  if (text.length > MAX_RELAY_URL) return "tooLong";
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "notUrl";
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return "https";
  if (url.username || url.password || url.search || url.hash) return "credentials";
  return null;
}

const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const MAX_TEXT = 200;

/**
 * Text that Core relays from the outside (an error message) made safe to print: control, line-break
 * and bidirectional characters (which can reorder or hide text) become spaces, runs of white space
 * collapse and the length is capped. It is still only ever rendered as text.
 */
export function cleanRelayText(value: string): string {
  const chars = Array.from(value.replace(HIDDEN, " ").replace(/\s+/gu, " ").trim());
  return chars.length > MAX_TEXT ? `${chars.slice(0, MAX_TEXT).join("")}…` : chars.join("");
}

/** `absent`: Core has no relay route (no operating system secret store). */
export type RemoteRelayLoad =
  | { phase: "loading" }
  | { phase: "absent" }
  | { phase: "failed"; message: string | null }
  | { phase: "ready"; status: RemoteRelayStatus };

/** The relay status, re-read when Core comes back online and every few seconds while the relay is on. */
export function useRemoteRelay() {
  const client = useClient();
  const [load, setLoad] = useState<RemoteRelayLoad>({ phase: "loading" });
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const status = await client.request<RemoteRelayStatus>("GET", REMOTE_RELAY_PATH);
      if (alive.current) setLoad({ phase: "ready", status });
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof ApiError && err.status === 404) setLoad({ phase: "absent" });
      else setLoad({ phase: "failed", message: err instanceof ApiError ? err.message : null });
    }
  }, [client]);

  /** Replaces the status with the one a change just returned. */
  const applyStatus = useCallback((status: RemoteRelayStatus) => {
    setLoad({ phase: "ready", status });
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

  const on = load.phase === "ready" && load.status.enabled;
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => void reload(), RELAY_POLL_MS);
    return () => clearInterval(timer);
  }, [on, reload]);

  return { load, reload, applyStatus };
}
