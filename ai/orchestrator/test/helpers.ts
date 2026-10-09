// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import {
  approverFromPermissions,
  enabledManifests,
  ToolGateway,
  ToolRegistry,
} from "@phoenix/ai-tool-gateway";
import { CapabilityManager, type CapabilityModule } from "@phoenix/capability-manager";
import { EventBus } from "@phoenix/event-bus";
import { PermissionGateway } from "@phoenix/permissions";
import { EventStore, MemorySecretStore, openDatabase, type Database } from "@phoenix/persistence";
import { PolicyEngine, PolicyStore } from "@phoenix/policy";
import type { AgentTask, PhoenixEvent } from "@phoenix/protocol";
import { StateEngine } from "@phoenix/state-engine";
import { vi } from "vitest";
import { defineCapability } from "@phoenix/sdk";
import {
  approvalFeed,
  Orchestrator,
  type AgentDefinition,
  type Limits,
  type RunContext,
  type SetTimer,
} from "../src";

/** A capability with a read tool (`ops.read_state`) and a write tool (`ops.restart`). */
export interface OpsLog {
  reads: number;
  restarts: number;
  /** What `read_state` reports. */
  running: boolean;
  /** When true `restart` succeeds but does not actually start the service. */
  restartDoesNothing: boolean;
  /** When set, `read_state` waits for it (to test cancellation of in-flight calls). */
  gate: PromiseWithResolvers<void> | null;
}

export function opsCapability(log: OpsLog): CapabilityModule {
  return defineCapability({
    manifest: {
      id: "ops",
      name: "Ops",
      version: "1.0.0",
      description: "Test capability with a read tool and a write tool",
      license: "GPL-3.0-or-later",
      events: ["ops.*"],
      permissions: ["filesystem_write"],
      data_categories: [],
      commands: [
        { name: "read_state", description: "Read the service state", side_effect: "read" },
        {
          name: "restart",
          description: "Restart the service",
          side_effect: "write",
          permissions: ["filesystem_write"],
        },
        { name: "other_read", description: "Another read", side_effect: "read" },
      ],
    },
    commands: {
      async read_state() {
        log.reads++;
        if (log.gate) await log.gate.promise;
        return { running: log.running };
      },
      restart() {
        log.restarts++;
        if (!log.restartDoesNothing) log.running = true;
        return { restarted: true };
      },
      other_read: () => ({ ok: true }),
    },
  });
}

export const newOpsLog = (): OpsLog => ({
  reads: 0,
  restarts: 0,
  running: false,
  restartDoesNothing: false,
  gate: null,
});

export interface Timers {
  setTimer: SetTimer;
  /** Fires every scheduled deadline now. */
  fire(): void;
  scheduled: number[];
}

export function manualTimers(): Timers {
  const pending: { ms: number; fn: () => void; live: boolean }[] = [];
  const scheduled: number[] = [];
  return {
    scheduled,
    setTimer: (ms, fn) => {
      const t = { ms, fn, live: true };
      pending.push(t);
      scheduled.push(ms);
      return { cancel: () => (t.live = false) };
    },
    fire: () => {
      for (const t of pending) if (t.live) t.fn();
    },
  };
}

export interface BootOptions {
  modules?: CapabilityModule[];
  agents: AgentDefinition[];
  enabled?: boolean;
  limits?: Partial<Limits>;
  setTimer?: SetTimer;
  now?: () => number;
  confirmationTimeoutMs?: number;
  /** The feed never tells the orchestrator about confirmations (a cancel that beats the bus). */
  deafApprovals?: boolean;
  /** Reuse an existing database (restart tests). */
  databasePath?: string;
}

export interface PublishedEvent {
  event_type: string;
  payload: Record<string, unknown>;
  correlation_id?: string;
  requires_action?: boolean;
}

export interface Booted {
  db: Database;
  bus: EventBus;
  events: PhoenixEvent[];
  published: PublishedEvent[];
  permissions: PermissionGateway;
  manager: CapabilityManager;
  gateway: ToolGateway;
  orchestrator: Orchestrator;
  state: { enabled: boolean };
  close(): Promise<void>;
}

export async function boot(options: BootOptions): Promise<Booted> {
  const db = openDatabase(options.databasePath ?? ":memory:");
  const store = new EventStore(db);
  const bus = new EventBus({ store, retryDelayMs: 0 });
  const events: PhoenixEvent[] = [];
  bus.subscribe("test.recorder", "*", (e) => void events.push(e));
  const permissions = new PermissionGateway({
    db,
    publish: (e) => void bus.publish(e),
    ...(options.confirmationTimeoutMs
      ? { confirmationTimeoutMs: options.confirmationTimeoutMs }
      : {}),
  });
  const manager = new CapabilityManager({
    db,
    bus,
    events: store,
    permissions,
    state: new StateEngine(),
    secrets: new MemorySecretStore(),
    defaultHealthIntervalMs: 3_600_000,
  });
  for (const m of options.modules ?? []) manager.registerBuiltin(m);
  const registry = new ToolRegistry({ manifests: enabledManifests(manager, db) });
  const policy = new PolicyEngine({
    store: new PolicyStore(db),
    audit: permissions.audit,
    isKillSwitchEngaged: () => permissions.isKillSwitchEngaged(),
    isKnownTool: (t) => registry.has(t),
  });
  const gateway = new ToolGateway({
    host: manager,
    registry,
    policy,
    audit: permissions.audit,
    approver: approverFromPermissions(permissions),
  });
  const state = { enabled: options.enabled ?? true };
  const published: PublishedEvent[] = [];
  const orchestrator = new Orchestrator({
    db,
    gateway,
    audit: permissions.audit,
    isEnabled: () => state.enabled,
    isKillSwitchEngaged: () => permissions.isKillSwitchEngaged(),
    publish: (e) => {
      published.push({
        event_type: e.event_type,
        payload: e.payload ?? {},
        ...(e.correlation_id ? { correlation_id: e.correlation_id } : {}),
        ...(e.requires_action ? { requires_action: true } : {}),
      });
      bus.publish({
        ...e,
        event_id: undefined,
        version: "1.1",
        timestamp: new Date().toISOString(),
        payload: e.payload ?? {},
      });
    },
    approvals: options.deafApprovals
      ? { ...approvalFeed(bus, permissions), subscribe: () => () => {} }
      : approvalFeed(bus, permissions),
    agents: options.agents,
    ...(options.limits ? { limits: options.limits } : {}),
    ...(options.setTimer ? { setTimer: options.setTimer } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  return {
    db,
    bus,
    events,
    published,
    permissions,
    manager,
    gateway,
    orchestrator,
    state,
    async close() {
      await orchestrator.close();
      await manager.close();
      permissions.close();
      await bus.drain();
      db.close();
    },
  };
}

/** Answers the next pending confirmation, like the Pet Panel would. */
export async function waitForConfirmation(b: Booted): Promise<string> {
  return vi.waitFor(() => {
    const first = b.permissions.pendingConfirmations()[0];
    if (!first) throw new Error("no pending confirmation yet");
    return first.id;
  });
}

export const taskInput = (extra: Record<string, unknown> = {}) => ({
  kind: "test",
  input: { name: "svc", ...extra },
  requestedBy: "user",
});

export function stubRc(task: AgentTask): Pick<RunContext, "task"> {
  return { task };
}
