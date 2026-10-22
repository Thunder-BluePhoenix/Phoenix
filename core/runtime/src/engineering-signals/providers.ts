// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type {
  AdvisoryProvider,
  HistoryRun,
  HistorySource,
} from "@phoenix/ai-proactive/engineering";
import { ProviderUnavailableError } from "@phoenix/ai-proactive/engineering";
import type { EventStore, StoredEvent } from "@phoenix/persistence";

/**
 * There is no locally vetted advisory database in Phoenix. Never claim an empty match set or
 * contact a network service without a separately approved and injected advisory source.
 */
export function unavailableAdvisoryProvider(): AdvisoryProvider {
  return {
    async lookup() {
      throw new ProviderUnavailableError(
        "No approved local dependency advisory database is configured",
      );
    },
  };
}

/**
 * Reads already-authorized, locally persisted `phoenix run` events. The terminal capability's
 * finished build/test reports contain actual exit codes, durations, commands and working dirs.
 * CI run events carry no duration and terminal reports carry no test-case identity; neither is
 * invented here. Events with missing or ambiguous evidence are omitted, not counted as passes.
 * The EventStore is injected by its owner: this adapter never opens a database or reads a repo.
 */
export function terminalHistorySource(events: Pick<EventStore, "recent">): HistorySource {
  return {
    async list(root): Promise<readonly HistoryRun[]> {
      let stored: StoredEvent[];
      try {
        stored = events.recent({ source: "terminal", limit: 1000 });
      } catch {
        throw new ProviderUnavailableError("Local terminal event history is unreadable");
      }
      const runs: HistoryRun[] = [];
      for (const { event } of stored) {
        if (event.source !== "terminal") continue;
        if (
          event.event_type !== "build.passed" &&
          event.event_type !== "build.failed" &&
          event.event_type !== "test.passed" &&
          event.event_type !== "test.failed"
        )
          continue;
        const payload: Record<string, unknown> = event.payload;
        if (
          payload.cwd !== root ||
          typeof payload.command !== "string" ||
          payload.command.length === 0 ||
          payload.command.length > 160 ||
          typeof payload.duration_ms !== "number" ||
          !Number.isSafeInteger(payload.duration_ms) ||
          payload.duration_ms < 0 ||
          payload.duration_ms > 86_400_000 ||
          typeof payload.exit_code !== "number" ||
          !Number.isInteger(payload.exit_code)
        )
          continue;
        const passed = event.event_type.endsWith(".passed");
        if (passed !== (payload.exit_code === 0)) continue;
        const finishedAt = Date.parse(event.timestamp);
        if (!Number.isFinite(finishedAt)) continue;
        runs.push({
          repo: root,
          source: "terminal",
          job: payload.command,
          test: null,
          outcome: passed ? "passed" : "failed",
          durationMs: payload.duration_ms,
          finishedAt,
        });
      }
      return runs;
    },
  };
}
