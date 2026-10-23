// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { route, type Route } from "./http";

/** One change Core has made and not yet undone. Kinds and times only: no ids, no undo data. */
export interface QuitCheckPending {
  kind: string;
  /** Epoch milliseconds the change was journalled. */
  at: number;
}

/**
 * What the desktop shell asks before it quits (Phase 73 quit veto). `available` is false while
 * the keep-awake capability has never run in this Core, so nothing is known; the shell then
 * quits normally.
 */
export interface QuitCheckView {
  available: boolean;
  can_quit: boolean;
  /** How many changes still need undoing (may be larger than `pending.length`). */
  count: number;
  pending: QuitCheckPending[];
}

export interface QuitCheckApi {
  status(): QuitCheckView;
}

/**
 * Authenticated (session token), read-only and parameterless: the shell holds that token. Asking
 * never undoes, discards or changes anything in the recovery journal; it only reads the veto.
 */
export function quitCheckRoutes(service: QuitCheckApi): Route[] {
  return [
    route("GET", "/api/awake/quit-check", async ({ url }) => {
      for (const _key of url.searchParams.keys())
        throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Unknown quit-check parameter");
      return service.status();
    }),
  ];
}
