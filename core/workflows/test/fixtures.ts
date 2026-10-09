// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A real Phoenix core in a test: SQLite file, EventBus, PermissionGateway, CapabilityManager,
// PolicyEngine, ToolGateway and the workflow engine, with one test capability ("deploys") that
// exposes read tools and state-changing tools, and records every call that reached it.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { PolicyAdmin, PolicyEngine, PolicyStore, type Actor } from "@phoenix/policy";
import { createEvent, type CapabilityManifest, type PhoenixEvent } from "@phoenix/protocol";
import { expect, vi } from "vitest";
import { StateEngine } from "../../state-engine/src";
import {
  approvalsFromPermissions,
  catalogFromGateway,
  WorkflowAdmin,
  WorkflowAdminStore,
  WorkflowEngine,
  WorkflowStore,
  type AiStep,
  type EngineDeps,
  type WorkflowDefinition,
} from "../src";

export const user: Actor = { kind: "user", id: "me", trustedByUser: true };
export const agent: Actor = { kind: "agent", id: "fawkes", trustedByUser: true };

export interface Calls {
  /** Every command that reached the capability, in order, with its input. */
  log: { command: string; input: unknown }[];
  /** The next N calls of `flaky` throw. */
  failFlaky: number;
  /** Commands that throw when they are called. */
  failCommands: Record<string, boolean>;
  /** Resolvers of calls held open by `hang` / `stuck_write`; released when the core closes. */
  held: (() => void)[];
  /** What `logs` returns (default: two short lines). */
  logLines?: string[];
}

export function deploysCapability(calls: Calls): CapabilityModule {
  const manifest: CapabilityManifest = {
    id: "deploys",
    name: "Deploys",
    version: "1.0.0",
    description: "Test deploy system",
    license: "GPL-3.0-or-later",
    events: ["deploy.*"],
    permissions: ["filesystem_write", "production_action"],
    commands: [
      { name: "logs", description: "Read deploy logs", side_effect: "read", timeout_ms: 1000 },
      { name: "flaky", description: "Read that may fail", side_effect: "read", timeout_ms: 1000 },
      {
        name: "hang",
        description: "Read that never answers",
        side_effect: "read",
        timeout_ms: 30_000,
      },
      {
        name: "restart",
        description: "Restart the service",
        side_effect: "write",
        permissions: ["filesystem_write"],
        timeout_ms: 1000,
      },
      {
        name: "stuck_write",
        description: "Write that never answers",
        side_effect: "write",
        permissions: ["filesystem_write"],
        timeout_ms: 30_000,
      },
      {
        name: "undo_restart",
        description: "Undo the restart",
        side_effect: "write",
        permissions: ["filesystem_write"],
        timeout_ms: 1000,
      },
      {
        name: "rollback",
        description: "Roll production back",
        side_effect: "production",
        permissions: ["production_action"],
        timeout_ms: 1000,
      },
      {
        name: "echo",
        description: "Write the given note",
        side_effect: "write",
        permissions: ["filesystem_write"],
        input_schema: {
          type: "object",
          additionalProperties: false,
          required: ["note"],
          properties: { note: { type: "string", maxLength: 500 } },
        },
      },
    ],
  };
  const run = (command: string, result: unknown) => (input: unknown) => {
    calls.log.push({ command, input });
    if (calls.failCommands[command]) throw new Error(`${command} failed on purpose`);
    return result;
  };
  return {
    manifest,
    commands: {
      logs: (input) => {
        calls.log.push({ command: "logs", input });
        return { lines: calls.logLines ?? ["ERROR migration 42 failed: column missing", "exit 1"] };
      },
      flaky: (input) => {
        calls.log.push({ command: "flaky", input });
        if (calls.failFlaky > 0) {
          calls.failFlaky--;
          throw new Error("flaky read failed");
        }
        return { ok: true };
      },
      hang: (input) => {
        calls.log.push({ command: "hang", input });
        const held = Promise.withResolvers<unknown>();
        calls.held.push(() => held.resolve({ released: true }));
        return held.promise;
      },
      stuck_write: (input) => {
        calls.log.push({ command: "stuck_write", input });
        const held = Promise.withResolvers<unknown>();
        calls.held.push(() => held.resolve({ released: true }));
        return held.promise;
      },
      restart: run("restart", { restarted: true }),
      undo_restart: run("undo_restart", { undone: true }),
      rollback: run("rollback", { rolledBack: true }),
      echo: (input) => {
        calls.log.push({ command: "echo", input });
        const note =
          typeof input === "object" && input !== null && "note" in input ? input.note : "";
        if (calls.failCommands["echo"] || (typeof note === "string" && note.includes("FAIL")))
          throw new Error("echo failed on purpose");
        return { echoed: true };
      },
    },
  };
}

export interface BootOptions {
  path: string;
  calls: Calls;
  ai?: AiStep;
  now?: () => number;
  sleep?: EngineDeps["sleep"];
  rate?: EngineDeps["rate"];
  maxConcurrent?: number;
  maxChainDepth?: number;
  /** Replace how the engine reads the bus (for delivering the same event twice). */
  events?: EngineDeps["events"];
  /** Answers every confirmation prompt as soon as it is raised. undefined = leave it pending. */
  autoAnswer?: (c: {
    id: string;
    capabilityId: string;
    command: string;
    summary: string;
  }) => boolean | undefined;
  /** Replaces the PermissionGateway-backed approval port (to script expiry). */
  approvals?: EngineDeps["approvals"];
}

export interface Core {
  db: Database;
  bus: EventBus;
  permissions: PermissionGateway;
  manager: CapabilityManager;
  gateway: ToolGateway;
  policyAdmin: PolicyAdmin;
  store: WorkflowStore;
  engine: WorkflowEngine;
  admin: WorkflowAdmin;
  seen: PhoenixEvent[];
  /** Resolves the oldest pending confirmation whose capability matches. */
  answer(approved: boolean, capabilityId?: string): Promise<void>;
  /** Simulates a crash: abandons runs without writing, closes the database. */
  crash(): Promise<void>;
  close(): Promise<void>;
}

const open: Core[] = [];

export async function boot(o: BootOptions): Promise<Core> {
  const db = openDatabase(o.path);
  const store = new EventStore(db);
  const bus = new EventBus({ store, retryDelayMs: 0 });
  const seen: PhoenixEvent[] = [];
  bus.subscribe("test.recorder", "*", (e) => void seen.push(e));
  const permissions = new PermissionGateway({ db, publish: (e) => void bus.publish(e) });
  if (o.autoAnswer) {
    const decide = o.autoAnswer;
    bus.subscribe("test.auto-answer", "security.confirmation.requested", () => {
      for (const c of permissions.pendingConfirmations()) {
        const verdict = decide(c);
        if (verdict !== undefined) permissions.resolveConfirmation(c.id, verdict);
      }
    });
  }
  const manager = new CapabilityManager({
    db,
    bus,
    events: store,
    permissions,
    state: new StateEngine(),
    secrets: new MemorySecretStore(),
    defaultHealthIntervalMs: 3_600_000,
  });
  manager.registerBuiltin(deploysCapability(o.calls));
  await manager.enable("deploys");
  const registry = new ToolRegistry({ manifests: enabledManifests(manager, db) });
  const policyStore = new PolicyStore(db);
  const policyAdmin = new PolicyAdmin({ store: policyStore, audit: permissions.audit });
  const policy = new PolicyEngine({
    store: policyStore,
    audit: permissions.audit,
    isKillSwitchEngaged: () => permissions.isKillSwitchEngaged(),
    isKnownTool: (t) => registry.has(t),
  });
  const gateway = new ToolGateway({
    host: {
      invokeAndWait: (id, cmd, input, actor) => manager.invokeAndWait(id, cmd, input, actor),
    },
    registry,
    policy,
    audit: permissions.audit,
    approver: approverFromPermissions(permissions),
  });
  const wfStore = new WorkflowStore(db);
  const catalog = catalogFromGateway(gateway);
  const engine = new WorkflowEngine({
    store: wfStore,
    events: o.events ?? bus,
    publish: (e) => bus.publish(e),
    gateway,
    approvals: o.approvals ?? approvalsFromPermissions(permissions),
    audit: permissions.audit,
    isKillSwitchEngaged: () => permissions.isKillSwitchEngaged(),
    // What the runtime wires too: withdraw the confirmation prompt of the call that was given up on.
    abandon: (tool) => {
      const [capability, command] = [
        tool.slice(0, tool.indexOf(".")),
        tool.slice(tool.indexOf(".") + 1),
      ];
      for (const c of permissions.pendingConfirmations())
        if (c.capabilityId === capability && c.command === command)
          permissions.resolveConfirmation(c.id, false, "workflow-abandon");
    },
    ...(o.ai ? { ai: o.ai } : {}),
    ...(o.now ? { now: o.now } : {}),
    ...(o.sleep ? { sleep: o.sleep } : {}),
    ...(o.rate ? { rate: o.rate } : {}),
    ...(o.maxConcurrent ? { maxConcurrent: o.maxConcurrent } : {}),
    ...(o.maxChainDepth ? { maxChainDepth: o.maxChainDepth } : {}),
  });
  const admin = new WorkflowAdmin({
    store: wfStore,
    writes: new WorkflowAdminStore(db),
    audit: permissions.audit,
    catalog,
    ...(o.now ? { now: o.now } : {}),
  });
  let closed = false;
  const core: Core = {
    db,
    bus,
    permissions,
    manager,
    gateway,
    policyAdmin,
    store: wfStore,
    engine,
    admin,
    seen,
    async answer(approved, capabilityId) {
      await vi.waitFor(() =>
        expect(
          permissions
            .pendingConfirmations()
            .some((c) => capabilityId === undefined || c.capabilityId === capabilityId),
        ).toBe(true),
      );
      const c = permissions
        .pendingConfirmations()
        .find((x) => capabilityId === undefined || x.capabilityId === capabilityId);
      if (c) permissions.resolveConfirmation(c.id, approved);
    },
    async crash() {
      if (closed) return;
      closed = true;
      await engine.stop();
      for (const release of o.calls.held.splice(0)) release();
      bus.close();
      permissions.close();
      await manager.close();
      db.close();
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const release of o.calls.held.splice(0)) release();
      permissions.close();
      await engine.idle();
      await engine.stop();
      await bus.drain();
      bus.close();
      await manager.close();
      db.close();
    },
  };
  open.push(core);
  return core;
}

export async function closeAll(): Promise<void> {
  for (const c of open.splice(0).reverse()) await c.close();
}

export function tempDir(): { dir: string; db: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "phoenix-workflows-"));
  return {
    dir,
    db: join(dir, "phoenix.db"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export const newCalls = (): Calls => ({ log: [], failFlaky: 0, failCommands: {}, held: [] });

let eventCounter = 0;
export function triggerEvent(
  type: string,
  payload: Record<string, unknown> = {},
  extra: Partial<PhoenixEvent> = {},
): PhoenixEvent {
  return createEvent({
    event_id: `evt_test${(eventCounter++).toString(36).padStart(8, "0")}`,
    event_type: type,
    source: "ci",
    severity: "error",
    payload,
    ...extra,
  });
}

/** The example of the phase doc: production deploy fails -> logs -> diagnose -> notify -> plan -> approval. */
export function deployFailedWorkflow(over: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: "deploy-failed",
    name: "Production deploy failed",
    version: 1,
    enabled: true,
    environment: "production",
    trigger: { event: "deploy.failed", where: 'event.payload.environment == "production"' },
    declares: { tools: ["deploys.logs", "deploys.rollback"], ai: true },
    steps: [
      { id: "logs", type: "action", tool: "deploys.logs", input: {} },
      {
        id: "diagnose",
        type: "ai",
        instruction: "Diagnose why the production deploy failed.",
        data: { service: "{{ event.payload.service }}", logs: "{{ steps.logs.lines }}" },
        output: {
          cause: { type: "string", max_length: 300 },
          severity: { type: "string", enum: ["low", "medium", "high"] },
        },
      },
      {
        id: "tell",
        type: "notify",
        title: "Deploy of {{ event.payload.service }} failed",
        message: "Likely cause: {{ steps.diagnose.cause }} ({{ steps.diagnose.severity }})",
        severity: "error",
        requires_action: true,
      },
      {
        id: "plan",
        type: "ai",
        instruction: "Propose a short recovery plan.",
        data: { cause: "{{ steps.diagnose.cause }}" },
        output: { plan: { type: "string", max_length: 500 } },
      },
      {
        id: "gate",
        type: "approval",
        summary: "Roll back {{ event.payload.service }}? Plan: {{ steps.plan.plan }}",
      },
      { id: "rollback", type: "action", tool: "deploys.rollback", input: {} },
      {
        id: "done",
        type: "result",
        outcome: "success",
        summary: "Rolled back {{ event.payload.service }}",
      },
    ],
    ...over,
  };
}

/** A fake model: answers each ai step with JSON by instruction keyword. */
export const fakeAi: AiStep = async ({ messages }) => {
  const text = messages.map((m) => m.content).join("\n");
  if (text.includes("recovery plan"))
    return { text: '{"plan": "roll back to the previous release"}', processedBy: "Fake · test" };
  return {
    text: '{"cause": "migration 42 failed", "severity": "high"}',
    processedBy: "Fake · test",
  };
};

/** A manual clock: `now()` and a sleeper whose timers fire only when the test advances time. */
export class ManualClock {
  private t: number;
  private readonly timers: { due: number; fire: () => void; id: number }[] = [];
  private nextId = 0;

  constructor(start = 1_800_000_000_000) {
    this.t = start;
  }

  readonly now = (): number => this.t;

  readonly sleep = (ms: number, signal: AbortSignal): Promise<void> => {
    const done = Promise.withResolvers<void>();
    if (signal.aborted) {
      done.reject(new Error("aborted"));
      return done.promise;
    }
    const entry = { due: this.t + ms, id: this.nextId++, fire: () => done.resolve() };
    this.timers.push(entry);
    signal.addEventListener(
      "abort",
      () => {
        const i = this.timers.indexOf(entry);
        if (i >= 0) this.timers.splice(i, 1);
        done.reject(new Error("aborted"));
      },
      { once: true },
    );
    return done.promise;
  };

  get pendingTimers(): number {
    return this.timers.length;
  }

  /** Moves time forward and fires every timer that falls due, earliest first. */
  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      this.timers.sort((a, b) => a.due - b.due || a.id - b.id);
      const next = this.timers[0];
      if (!next || next.due > target) break;
      this.timers.shift();
      this.t = Math.max(this.t, next.due);
      next.fire();
    }
    this.t = target;
  }
}

/** A small development workflow: trigger `ci.build.failed`, the given steps, the given tools. */
export function devWorkflow(
  id: string,
  steps: WorkflowDefinition["steps"],
  tools: string[],
  over: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  return {
    id,
    name: id,
    version: 1,
    enabled: true,
    environment: "dev",
    trigger: { event: "ci.build.failed" },
    declares: { tools, ai: false },
    steps,
    ...over,
  };
}

export const buildFailed = (
  payload: Record<string, unknown> = {},
  extra: Partial<PhoenixEvent> = {},
) => triggerEvent("ci.build.failed", { service: "api", ...payload }, extra);
