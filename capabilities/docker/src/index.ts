// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Docker capability (Phase 24). Watches the local Docker Engine for container lifecycle and
// health changes and emits docker.* events. Strictly read-only: it only ever sends GET requests
// to the Engine's unix socket (engine.ts enforces this structurally).
//
// Why polling and not the /events stream: the stream is a long-lived connection that needs
// reconnect, resume-from-timestamp and de-duplication logic to be reliable, and it does not
// carry health transitions for containers started before Phoenix connected. A GET of
// /containers/json every few seconds is stateless, cheap, and makes a missed event impossible
// to get stuck on; the cost is up to one poll interval of latency and that a container which
// starts and stops entirely between two polls is not seen.
import { homedir } from "node:os";
import { defineCapability, type CapabilityContext, type HealthResult } from "@phoenix/sdk";
import {
  DockerError,
  dockerJson,
  findSocket,
  MAX_INSPECT_BYTES,
  socketCandidates,
  type SocketLookup,
} from "./engine";
import {
  byId,
  diffContainers,
  needsExitDetails,
  parseContainerList,
  parseExitDetails,
  summarise,
  type ContainerSnapshot,
  type ExitDetails,
} from "./monitor";

export * from "./engine";
export * from "./monitor";

/** Inspect calls per poll (one per container that just stopped). The rest fall back to Status. */
const MAX_INSPECTS_PER_POLL = 20;
const COMMAND_ROWS = 200;
const LIST_PATH = "/containers/json?all=true";

export interface DockerCapabilityOptions {
  /** Environment used for $DOCKER_HOST discovery (default process.env). */
  env?: NodeJS.ProcessEnv;
  /** Home directory used for Docker Desktop / Colima / OrbStack sockets (default os.homedir()). */
  home?: string;
}

/** A fresh capability instance (its own watcher state); Phoenix Core uses `dockerCapability`. */
export function createDockerCapability(options: DockerCapabilityOptions = {}) {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  let previous: Record<string, ContainerSnapshot> | undefined;
  let lookup: SocketLookup | undefined;
  /** Set while the last poll failed; cleared by the next success. */
  let problem: string | undefined;
  let containerCount: number | undefined;

  function locate(ctx: CapabilityContext): SocketLookup {
    const configured =
      typeof ctx.config.socket_path === "string" ? ctx.config.socket_path : undefined;
    lookup = findSocket(socketCandidates(configured, env, home));
    return lookup;
  }

  function notRunning(found: SocketLookup): DockerError {
    const notes = found.notes.length ? ` ${found.notes.join(". ")}.` : "";
    return new DockerError(
      "not_running",
      `Docker is not running (no Docker socket found; looked at ${found.tried.join(", ")}).${notes}`,
    );
  }

  async function list(
    ctx: CapabilityContext,
  ): Promise<{ socket: string; list: ContainerSnapshot[] }> {
    const found = locate(ctx);
    if (!found.path) throw notRunning(found);
    const raw = await dockerJson(found.path, LIST_PATH, { signal: ctx.signal });
    try {
      return { socket: found.path, list: parseContainerList(raw) };
    } catch (err) {
      throw new DockerError("invalid", (err as Error).message);
    }
  }

  async function exitDetails(
    ctx: CapabilityContext,
    socket: string,
    stopped: ContainerSnapshot[],
  ): Promise<Record<string, ExitDetails>> {
    const out: Record<string, ExitDetails> = {};
    for (const c of stopped.slice(0, MAX_INSPECTS_PER_POLL)) {
      try {
        const raw = await dockerJson(socket, `/containers/${c.fullId}/json`, {
          signal: ctx.signal,
          maxBytes: MAX_INSPECT_BYTES,
        });
        const details = parseExitDetails(raw);
        if (details) out[c.id] = details;
      } catch (err) {
        // The container may have been removed in between; the Status text is the fallback.
        ctx.logger.debug("docker inspect failed", { error: (err as Error).message });
      }
    }
    return out;
  }

  async function poll(ctx: CapabilityContext): Promise<void> {
    try {
      const { socket, list: containers } = await list(ctx);
      if (ctx.signal.aborted) return;
      const next = byId(containers);
      const exits = previous
        ? await exitDetails(ctx, socket, needsExitDetails(previous, next))
        : {};
      if (ctx.signal.aborted) return;
      const events = diffContainers(previous, next, exits);
      previous = next;
      containerCount = containers.length;
      problem = undefined;
      for (const event of events) ctx.emit(event);
    } catch (err) {
      if (ctx.signal.aborted) return;
      // A failed poll never throws out of the timer; it degrades health and keeps the baseline,
      // so a Docker restart is diffed against what was there before.
      problem = err instanceof Error ? err.message : String(err);
      containerCount = undefined;
    }
  }

  return defineCapability({
    manifest: {
      id: "docker",
      name: "Docker",
      version: "0.1.0",
      description:
        "Watches local Docker containers for starts, stops, crashes and failing health checks.",
      license: "GPL-3.0-or-later",
      events: ["docker.*"],
      // container_access: read container state from the Engine's unix socket. filesystem_read is
      // deliberately not requested: connecting to a socket is not reading a file, and the only
      // file-system call is a stat() of the candidate socket paths.
      permissions: ["container_access"],
      data_categories: ["container names", "image names", "container health and exit codes"],
      healthcheck: { interval_ms: 10_000 },
      commands: [
        {
          name: "containers",
          description: "List containers with their state and health (names and images only)",
          side_effect: "read",
          permissions: ["container_access"],
        },
      ],
      config_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          socket_path: {
            type: "string",
            pattern: "^/[^\\u0000]+$",
            maxLength: 500,
            description:
              "Absolute path of the Docker unix socket. Default: $DOCKER_HOST (unix:// only), then the usual Docker, Colima and OrbStack locations",
          },
          poll_ms: { type: "integer", minimum: 250, maximum: 60_000 },
        },
      },
      state_rules: [
        {
          match: "docker.container.unhealthy",
          effect: { state: "WARNING", explain: "Container {subject} is unhealthy" },
        },
        {
          match: "docker.container.died",
          effect: {
            state: "ERROR",
            explain: "Container {subject} exited with code {payload.exit_code}",
          },
        },
        { match: "docker.container.healthy", effect: { clear: true } },
        { match: "docker.container.started", effect: { clear: true } },
        { match: "docker.container.stopped", effect: { clear: true } },
        { match: "docker.container.removed", effect: { clear: true } },
      ],
    },
    init(ctx) {
      previous = undefined;
      lookup = undefined;
      problem = undefined;
      containerCount = undefined;
      const interval = (ctx.config.poll_ms as number | undefined) ?? 3_000;
      void (async () => {
        while (!ctx.signal.aborted) {
          await poll(ctx);
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, interval);
            ctx.signal.addEventListener("abort", () => (clearTimeout(t), resolve()), {
              once: true,
            });
          });
        }
      })();
    },
    commands: {
      async containers(_input, ctx) {
        // Failures (Docker not running, ...) surface as CAPABILITY_UNAVAILABLE with the message.
        const { list: containers } = await list(ctx);
        return { containers: containers.slice(0, COMMAND_ROWS).map(summarise) };
      },
    },
    health(): HealthResult {
      if (problem) return { status: "degraded", message: problem };
      if (!lookup) return { status: "healthy", message: "Connecting to Docker…" };
      return {
        status: "healthy",
        message: `Connected to Docker at ${lookup.path}${containerCount === undefined ? "" : ` · ${containerCount} containers`}`,
      };
    },
  });
}

export const dockerCapability = createDockerCapability();
