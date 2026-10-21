// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Lid observer (Phase 73). macOS only, read-only: `ioreg -r -k AppleClamshellState -d 4` is polled
// through the injected Runner while a session is active. `AppleClamshellState = Yes` is "closed".
// Anything else (no such key, both values, unfamiliar text, a failing command) is "unknown", and
// an unknown reading never produces an event. Other platforms report "unsupported".
import type { AwakeEnv } from "../system";

export type LidState = "open" | "closed" | "unknown" | "unsupported";
export type LidListener = (state: "open" | "closed") => void;

/** The state in `ioreg` output. Only an unambiguous single value counts. */
export function parseClamshell(output: string): "open" | "closed" | "unknown" {
  const values = new Set(
    [...output.matchAll(/"AppleClamshellState"\s*=\s*(Yes|No)\b/gi)].map((m) =>
      (m[1] ?? "").toLowerCase(),
    ),
  );
  if (values.size !== 1) return "unknown";
  return values.has("yes") ? "closed" : "open";
}

const IOREG_TIMEOUT_MS = 8_000;

export interface LidObserver {
  /** Reads once, updates the state and tells listeners about a change. Never throws. */
  poll(): Promise<LidState>;
  state(): LidState;
  /** False on platforms without a lid sensor Phoenix can read. */
  supported(): boolean;
  /** Called with "closed"/"opened" transitions (not the first reading). Returns an unsubscribe. */
  onLid(listener: LidListener): () => void;
}

export function createLidObserver(env: Pick<AwakeEnv, "platform" | "run">): LidObserver {
  const supported = env.platform === "darwin";
  let current: LidState = supported ? "unknown" : "unsupported";
  const listeners = new Set<LidListener>();
  return {
    supported: () => supported,
    state: () => current,
    async poll() {
      if (!supported) return current;
      let next: LidState = "unknown";
      try {
        const result = await env.run(
          "/usr/sbin/ioreg",
          ["-r", "-k", "AppleClamshellState", "-d", "4"],
          {
            timeoutMs: IOREG_TIMEOUT_MS,
          },
        );
        if (result.code === 0) next = parseClamshell(result.stdout);
      } catch {
        next = "unknown";
      }
      const before = current;
      current = next;
      if (next !== "unknown" && before !== "unknown" && before !== next) {
        for (const listener of [...listeners]) {
          try {
            listener(next);
          } catch {
            // One listener failing never stops the others or the observer.
          }
        }
      }
      return current;
    },
    onLid(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
