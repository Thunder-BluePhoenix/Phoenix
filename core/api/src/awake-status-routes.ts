// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { route, type Route } from "./http";

/**
 * What the desktop shell's tray shows of a Keep-awake session (Phase 72): whether one runs and how
 * long it has left. No session id, no label and no times of day: only what a countdown needs.
 * `available` is false while the keep-awake capability is not running, so nothing is known.
 */
export interface AwakeTrayView {
  available: boolean;
  active: boolean;
  mode?: "timed" | "agents_grace";
  /** Whole seconds left; null while an agents_grace session is held by working agents. */
  remaining_seconds?: number | null;
}

export interface AwakeStatusApi {
  status(): AwakeTrayView;
}

/**
 * Authenticated (session token), read-only and parameterless: the shell holds that token. Asking
 * never starts, extends or ends a session; those stay confirmed `execute` commands.
 */
export function awakeStatusRoutes(service: AwakeStatusApi): Route[] {
  return [
    route("GET", "/api/awake/status", async ({ url }) => {
      for (const _key of url.searchParams.keys())
        throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Unknown awake status parameter");
      return service.status();
    }),
  ];
}
