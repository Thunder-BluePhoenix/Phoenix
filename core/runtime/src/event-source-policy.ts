// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Whether `POST /api/events` (the session-token route) may carry events whose source is
// `terminal`. Real terminal events come from the terminal capability through its own `ctx.emit`,
// so a copy posted here is indistinguishable from a real build or test result and feeds the
// engineering-signals history and the digest. Off by default because the SDK simulator and other
// local tooling post with that source; the user can turn the reservation on.
import type { AuditLog } from "@phoenix/permissions";
import type { SettingsStore } from "@phoenix/persistence";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";

export const RESERVE_TERMINAL_KEY = "events.reserve_terminal";

export interface EventSourcePolicyView {
  reserveTerminal: boolean;
}

export class EventSourcePolicy {
  constructor(
    private readonly settings: SettingsStore,
    private readonly audit: Pick<AuditLog, "record">,
  ) {}

  get(): EventSourcePolicyView {
    return { reserveTerminal: this.settings.get<unknown>(RESERVE_TERMINAL_KEY, false) === true };
  }

  set(input: unknown): EventSourcePolicyView {
    if (input === null || typeof input !== "object" || Array.isArray(input))
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Expected an object");
    const keys = Object.keys(input);
    const reserve = "reserveTerminal" in input ? input.reserveTerminal : undefined;
    if (keys.length !== 1 || typeof reserve !== "boolean")
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        'Expected exactly { "reserveTerminal": boolean }',
      );
    this.settings.set(RESERVE_TERMINAL_KEY, reserve);
    this.audit.record({
      actor: "user",
      action: "events.reserve_terminal.changed",
      decision: "info",
      details: { reserveTerminal: reserve },
    });
    return this.get();
  }
}
