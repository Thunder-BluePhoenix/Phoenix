// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The Phase 74 `DockerIdle` seam, fed by Phoenix's own Docker capability. Whether Docker Desktop may
// be frozen while the lid is closed is answered from the read-only `containers` command, so no new
// socket access and no second Docker client exists. The answer fails closed: only a complete list
// in which every container is known to be stopped says "idle". A disabled or unreachable Docker,
// a failed or slow call, a list cut at the command's row limit or a state this code does not know
// all say "unknown", and a container that is up, paused or restarting says "busy". Both "busy" and
// "unknown" mean Docker is not frozen.
import type { DockerIdleState } from "@phoenix/capability-awake";
import type { CapabilityManager } from "@phoenix/capability-manager";

/** The Docker capability's `containers` command returns at most this many rows (COMMAND_ROWS). */
export const DOCKER_LIST_LIMIT = 200;
/** Longest a lid-close decision waits for the container list. */
export const DOCKER_IDLE_TIMEOUT_MS = 5_000;

const RUNNING = new Set(["running", "paused", "restarting"]);
const STOPPED = new Set(["exited", "created", "dead"]);

/** Classifies the result of the `containers` command. Anything unrecognised is "unknown". */
export function classifyContainers(result: unknown): DockerIdleState {
  if (result === null || typeof result !== "object") return "unknown";
  const rows = (result as { containers?: unknown }).containers;
  if (!Array.isArray(rows)) return "unknown";
  let unknown = false;
  for (const row of rows) {
    const state =
      row !== null && typeof row === "object" ? (row as { state?: unknown }).state : undefined;
    if (typeof state !== "string") unknown = true;
    else if (RUNNING.has(state)) return "busy";
    else if (!STOPPED.has(state)) unknown = true;
  }
  // A full page may have been cut: a running container could be in the rows that were not returned.
  if (unknown || rows.length >= DOCKER_LIST_LIMIT) return "unknown";
  return "idle";
}

/** A `DockerIdle` that asks the Docker capability. Never throws and never prompts the user. */
export function dockerIdleFrom(
  capabilities: Pick<CapabilityManager, "invokeAndWait">,
  timeoutMs = DOCKER_IDLE_TIMEOUT_MS,
): () => Promise<DockerIdleState> {
  return async () => {
    try {
      const op = await capabilities.invokeAndWait(
        "docker",
        "containers",
        {},
        "awake",
        AbortSignal.timeout(timeoutMs),
      );
      return op.status === "succeeded" ? classifyContainers(op.result) : "unknown";
    } catch {
      return "unknown";
    }
  };
}
