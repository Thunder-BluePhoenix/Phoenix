// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Port & process radar (Phase 80): which dev servers listen on this computer, which project they
// belong to, how old they are, which look forgotten or heavy, and a guarded way to stop one.
// Read-only unless the user approves `stop_process` / `force_stop`, each of which asks every time.
// Polling is OFF by default; when the user turns `watch` on it runs only while something watches Core.
import { defineCapability, type CapabilityContext } from "@phoenix/sdk";
import { buildSnapshot, type PortsSnapshot } from "./snapshot";
import { DEFAULT_THRESHOLDS, type Thresholds } from "./policy";
import { realEnv } from "./real";
import { createStopper, parseTarget, type StopResult } from "./stop";
import { PortsError, type PortsEnv } from "./types";

export * from "./collect";
export * from "./parse";
export * from "./policy";
export * from "./project";
export * from "./real";
export * from "./snapshot";
export * from "./stop";
export * from "./types";

export const DEFAULT_POLL_MS = 15_000;
export const MIN_POLL_MS = 5_000;
export const MAX_POLL_MS = 600_000;

export interface PortsCapabilityOptions {
  /** The host machine; tests inject recording fakes. Default: the real machine. */
  env?: PortsEnv;
}

function numberIn(raw: unknown, min: number, max: number, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw)
    ? Math.min(max, Math.max(min, raw))
    : fallback;
}

export function thresholdsFrom(config: Readonly<Record<string, unknown>>): Thresholds {
  return {
    forgottenHours: numberIn(
      config.forgotten_after_hours,
      1,
      24 * 30,
      DEFAULT_THRESHOLDS.forgottenHours,
    ),
    heavyCpuPercent: numberIn(
      config.heavy_cpu_percent,
      10,
      10_000,
      DEFAULT_THRESHOLDS.heavyCpuPercent,
    ),
    heavyRssMb: numberIn(config.heavy_memory_mb, 64, 1 << 20, DEFAULT_THRESHOLDS.heavyRssMb),
  };
}

/** A string identifying the set of listeners and flags, so a poll announces a change once. */
export function fingerprint(s: PortsSnapshot): string {
  return s.ports
    .map(
      (p) => `${p.pid}:${p.port}:${p.start ?? ""}:${p.forgotten ? "f" : ""}${p.heavy ? "h" : ""}`,
    )
    .join("|");
}

const TARGET_PROPERTIES = {
  // Shown in the approval prompt: the user is approving THIS process on THIS port.
  pid: { type: "integer", minimum: 2, "x-phoenix-confirm": true },
  port: { type: "integer", minimum: 1, maximum: 65535, "x-phoenix-confirm": true },
  command: { type: "string", minLength: 1, maxLength: 1024, "x-phoenix-confirm": true },
  start: { type: "string", minLength: 10, maxLength: 40 },
  uid: { type: "integer", minimum: 0 },
} as const;

const TARGET_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pid", "port", "start", "command", "uid"],
  properties: TARGET_PROPERTIES,
} as const;

/** A fresh capability instance (its own polling state and SIGTERM records). */
export function createPortsCapability(options: PortsCapabilityOptions = {}) {
  const env = options.env ?? realEnv();
  let latest: PortsSnapshot | undefined;
  let lastFingerprint = "";
  let stopping = false;
  let emitted: CapabilityContext["emit"] | undefined;
  const stopper = createStopper(env, (r: StopResult) => announce(r));

  function announce(r: StopResult): void {
    // The command line is never put in an event: only the file name, pid, port and signal.
    emitted?.({
      event_type: "ports.process.signalled",
      severity: "info",
      subject: "Port radar",
      payload: {
        pid: r.pid,
        port: r.port,
        name: r.name,
        signal: r.signal,
        outcome: r.outcome,
        exited: r.exited,
      },
    });
  }

  async function refresh(ctx: CapabilityContext): Promise<PortsSnapshot> {
    const snapshot = await buildSnapshot(env, thresholdsFrom(ctx.config));
    latest = snapshot;
    return snapshot;
  }

  function startWatching(ctx: CapabilityContext): void {
    if (ctx.config.watch !== true) return;
    const pollMs = numberIn(ctx.config.poll_ms, MIN_POLL_MS, MAX_POLL_MS, DEFAULT_POLL_MS);
    void (async () => {
      while (!ctx.signal.aborted) {
        await ctx.untilWatched();
        if (ctx.signal.aborted) break;
        try {
          const snapshot = await refresh(ctx);
          const print = fingerprint(snapshot);
          if (print !== lastFingerprint) {
            lastFingerprint = print;
            ctx.emit(
              {
                event_type: "ports.radar.changed",
                severity: "info",
                subject: "Port radar",
                payload: {
                  ports: snapshot.ports.length,
                  forgotten: snapshot.ports.filter((p) => p.forgotten).length,
                  heavy: snapshot.ports.filter((p) => p.heavy).length,
                },
              },
              { ephemeral: true },
            );
          }
        } catch (err) {
          ctx.logger.warn("port radar poll failed", {
            error: err instanceof PortsError ? err.kind : "unknown",
          });
        }
        await env.sleep(pollMs, ctx.signal);
      }
    })();
  }

  async function once<T>(work: () => Promise<T>): Promise<T> {
    if (stopping) throw new PortsError("unavailable", "Another stop is in progress. Try again.");
    stopping = true;
    try {
      return await work();
    } finally {
      stopping = false;
    }
  }

  return defineCapability({
    manifest: {
      id: "ports",
      name: "Port & process radar",
      version: "0.1.0",
      description:
        "Lists the TCP ports listening on this computer with process, project folder and age, flags forgotten dev servers and heavy processes, and stops one only after you approve. Stopping asks every time, works only on your own non-system dev processes, sends SIGTERM first; force stop is a separate approval. No restart. Polling is off unless you turn it on.",
      license: "GPL-3.0-or-later",
      homepage: "https://github.com/Thunder-BluePhoenix/Phoenix",
      events: ["ports.*"],
      permissions: ["shell_command", "filesystem_read"],
      data_categories: [
        "listening port numbers",
        "process names and ids",
        "process start times and resource use",
        "project folder names",
      ],
      healthcheck: { interval_ms: 60_000 },
      commands: [
        {
          name: "list",
          description:
            "The TCP ports listening on this computer with process, project folder name, age and flags. Read-only.",
          side_effect: "read",
          permissions: ["shell_command", "filesystem_read"],
          timeout_ms: 30_000,
          input_schema: { type: "object", additionalProperties: false, properties: {} },
        },
        {
          name: "stop_process",
          description:
            "Asks a listening dev process to quit (SIGTERM). Asks for confirmation every time. Re-reads the process table first and refuses unless the pid, start time, command and user id still match what the radar showed. Never stops system processes, other users' processes or Phoenix itself.",
          side_effect: "execute",
          permissions: ["shell_command"],
          timeout_ms: 30_000,
          input_schema: TARGET_SCHEMA,
        },
        {
          name: "force_stop",
          description:
            "Kills (SIGKILL) a process that Phoenix asked to quit with stop_process and that is still running. Asks for confirmation every time, separately from stop_process, and only after a wait. Same identity and safety checks.",
          side_effect: "execute",
          permissions: ["shell_command"],
          timeout_ms: 30_000,
          input_schema: TARGET_SCHEMA,
        },
      ],
      config_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          watch: {
            type: "boolean",
            description:
              "Refresh the list in the background, only while Phoenix is being watched (default off)",
          },
          poll_ms: {
            type: "integer",
            minimum: MIN_POLL_MS,
            maximum: MAX_POLL_MS,
            description: `Milliseconds between background refreshes when watching (default ${DEFAULT_POLL_MS})`,
          },
          forgotten_after_hours: {
            type: "integer",
            minimum: 1,
            maximum: 720,
            description: `A listening process in a project folder older than this is flagged as forgotten (default ${DEFAULT_THRESHOLDS.forgottenHours})`,
          },
          heavy_cpu_percent: {
            type: "integer",
            minimum: 10,
            maximum: 10000,
            description: `ps CPU percent at or above which a process is flagged heavy (default ${DEFAULT_THRESHOLDS.heavyCpuPercent})`,
          },
          heavy_memory_mb: {
            type: "integer",
            minimum: 64,
            maximum: 1048576,
            description: `Resident memory in MB at or above which a process is flagged heavy (default ${DEFAULT_THRESHOLDS.heavyRssMb})`,
          },
        },
      },
    },
    init(ctx) {
      emitted = ctx.emit;
      latest = undefined;
      lastFingerprint = "";
      stopper.reset();
      ctx.signal.addEventListener("abort", () => stopper.reset(), { once: true });
      startWatching(ctx);
    },
    commands: {
      async list(input, ctx) {
        if (input !== undefined && input !== null && Object.keys(input as object).length > 0) {
          throw new PortsError("invalid", "list takes no input");
        }
        return await refresh(ctx);
      },
      stop_process(input, ctx) {
        const target = parseTarget(input);
        return once(() => stopper.stop(target, ctx.signal));
      },
      force_stop(input, ctx) {
        const target = parseTarget(input);
        return once(() => stopper.force(target, ctx.signal));
      },
    },
    health() {
      return {
        status: "healthy" as const,
        message: latest ? `${latest.ports.length} listening ports at the last scan` : "No scan yet",
      };
    },
    shutdown() {
      stopper.reset();
      emitted = undefined;
    },
  });
}
