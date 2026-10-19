// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { CapabilityContext } from "@phoenix/sdk";

/**
 * Emits each event and returns how many Core refused. A refusal means the change tracker has
 * already recorded the new state while subscribers never saw it, so it is logged (the error code
 * only, never the payload, which came from a remote service) for the capability to count.
 */
export function emitAll(
  ctx: CapabilityContext,
  events: readonly Parameters<CapabilityContext["emit"]>[0][],
): number {
  let refused = 0;
  for (const event of events) {
    const result = ctx.emit(event);
    if (result.ok) continue;
    refused++;
    ctx.logger.warn("event refused by Core", { type: event.event_type, code: result.error.code });
  }
  return refused;
}
