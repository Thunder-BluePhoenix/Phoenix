// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import {
  CapabilityManager,
  type CapabilityModule,
  type Operation,
} from "@phoenix/capability-manager";
import { EventBus } from "@phoenix/event-bus";
import { PermissionGateway } from "@phoenix/permissions";
import { EventStore, openDatabase } from "@phoenix/persistence";
import type { PhoenixEvent } from "@phoenix/protocol";
import { StateEngine } from "@phoenix/state-engine";

export interface HarnessOptions {
  modules?: readonly CapabilityModule[];
  /** Per-call timeout for capability init/commands (default 2000 ms). */
  callTimeoutMs?: number;
}

/**
 * An in-memory Phoenix (bus, state engine, permissions, capability manager)
 * for testing capabilities without starting the core process.
 */
export function createHarness(options: HarnessOptions = {}) {
  const db = openDatabase(":memory:");
  const store = new EventStore(db);
  const bus = new EventBus({ store, retryDelayMs: 0 });
  const state = new StateEngine();
  const permissions = new PermissionGateway({ db, publish: (e) => void bus.publish(e) });
  const manager = new CapabilityManager({
    db,
    bus,
    events: store,
    permissions,
    state,
    callTimeoutMs: options.callTimeoutMs ?? 2000,
    defaultHealthIntervalMs: 3_600_000,
  });
  const events: PhoenixEvent[] = [];
  bus.subscribe("harness.recorder", "*", (e) => void events.push(e));
  bus.subscribe("harness.state", "*", (e) => void state.handle(e));
  for (const m of options.modules ?? []) manager.registerBuiltin(m);

  return {
    db,
    bus,
    state,
    permissions,
    manager,
    /** Every event published so far, in order. */
    events,
    /** Event types emitted by a given source (default: all). */
    types: (source?: string) =>
      events.filter((e) => !source || e.source === source).map((e) => e.event_type),
    drain: () => bus.drain(),
    enable: (id: string) => manager.enable(id),
    /**
     * Runs a command to completion. Confirmation prompts are answered with
     * `approve` (default true), as a user would in the Pet Panel.
     */
    async run(
      id: string,
      command: string,
      input: unknown = {},
      approve = true,
    ): Promise<Operation> {
      const op = manager.invoke(id, command, input);
      while (op.status === "pending" || op.status === "running") {
        for (const c of permissions.pendingConfirmations()) {
          if (c.capabilityId === id) permissions.resolveConfirmation(c.id, approve);
        }
        await new Promise((r) => setTimeout(r, 2));
      }
      await bus.drain();
      return op;
    },
    async close() {
      await manager.close();
      db.close();
    },
  };
}

export type Harness = ReturnType<typeof createHarness>;
