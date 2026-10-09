// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Builds the world one scenario runs in, out of the REAL pieces: the capability manager, the
// permission gateway and audit log, the policy engine, the tool gateway, the orchestrator and an
// AiService with a router and privacy gate. Only the leaves are fake: capabilities (copies of the
// real manifests that count every call) and the model provider (scripted, with a virtual clock).
import { ContextEngine } from "@phoenix/ai-context";
import { MemoryPipeline, MemoryStore, createDefaultPolicy, type Viewer } from "@phoenix/ai-memory";
import {
  AiService,
  ModelError,
  ProviderRegistry,
  processedByLabel,
  type GenerateRequest,
  type GenerateResult,
  type ModelProvider,
} from "@phoenix/ai-models";
import { Orchestrator, approvalFeed, type AgentDefinition } from "@phoenix/ai-orchestrator";
import {
  ToolGateway,
  ToolRegistry,
  approverFromPermissions,
  enabledManifests,
} from "@phoenix/ai-tool-gateway";
import { CapabilityManager } from "@phoenix/capability-manager";
import { EventBus } from "@phoenix/event-bus";
import { PermissionGateway } from "@phoenix/permissions";
import { EventStore, MemorySecretStore, openDatabase, type Database } from "@phoenix/persistence";
import { PolicyAdmin, PolicyEngine, PolicyStore } from "@phoenix/policy";
import type { PhoenixEvent } from "@phoenix/protocol";
import { StateEngine } from "@phoenix/state-engine";
import { createCiFailureAgent, type ModelCall } from "@phoenix/ai-agents";
import { fakeGit, fakeGithub, fakeOps, type FakeEnv } from "./fakes";
import type { ModelResponder, Setup } from "./types";

/** Fixed "now" of every scenario. */
export const SCENARIO_NOW = Date.parse("2026-10-09T12:00:00.000Z");
const DAY_MS = 86_400_000;

export interface PromptRecord {
  /** Every message of the request, joined with a newline. */
  text: string;
  privacy: string;
  purpose: string;
}

export interface ModelLog {
  prompts: PromptRecord[];
  inputTokens: number;
  outputTokens: number;
  /** Calls the cloud provider received. Must stay 0 in every offline scenario. */
  cloudCalls: number;
  /** Replies handed out, in order. */
  replies: string[];
}

export interface World {
  db: Database;
  env: FakeEnv;
  clock: { now: number };
  permissions: PermissionGateway;
  manager: CapabilityManager;
  gateway: ToolGateway;
  policy: PolicyEngine;
  admin: PolicyAdmin;
  orchestrator: Orchestrator;
  store: MemoryStore;
  engine: ContextEngine;
  viewer: Viewer;
  ai: AiService;
  model: ModelCall;
  modelLog: ModelLog;
  events: PhoenixEvent[];
  confirmations: { approved: number; rejected: number };
  close(): Promise<void>;
}

function scriptedProvider(
  responders: ModelResponder[],
  log: ModelLog,
  clock: { now: number },
): ModelProvider {
  const remaining = responders.map((r) => ({ r, used: false }));
  const provenance = {
    provider: "eval-fake",
    model: "scripted-1",
    locality: "local" as const,
    processedBy: processedByLabel("Scripted", "scripted-1", "local"),
  };
  return {
    id: "eval-fake",
    label: "Scripted",
    locality: "local",
    capabilities: { generate: true, stream: false, embed: false },
    costTier: 0,
    typicalLatencyMs: 1,
    models: () => Promise.resolve([]),
    health: () => Promise.resolve({ available: true, detail: "scripted" }),
    stream: () => {
      throw new ModelError("unsupported", "eval-fake", "no streams");
    },
    embed: () => Promise.reject(new ModelError("unsupported", "eval-fake", "no embeddings")),
    generate(req: GenerateRequest): Promise<GenerateResult> {
      const text = req.messages.map((m) => m.content).join("\n");
      log.prompts.push({ text, privacy: req.privacy, purpose: req.purpose });
      const hit = remaining.find(
        (x) => !x.used && (x.r.whenPromptHas === undefined || text.includes(x.r.whenPromptHas)),
      );
      if (!hit) {
        return Promise.reject(new ModelError("protocol", "eval-fake", "no scripted reply matched"));
      }
      if (hit.r.once) hit.used = true;
      clock.now += hit.r.latencyMs ?? 20;
      if (typeof hit.r.reply !== "string") {
        const kind = hit.r.reply.error === "timeout" ? "timeout" : "network";
        return Promise.reject(new ModelError(kind, "eval-fake", hit.r.reply.error));
      }
      const usage = hit.r.usage ?? {
        inputTokens: Math.ceil(text.length / 4),
        outputTokens: Math.ceil(hit.r.reply.length / 4),
      };
      log.inputTokens += usage.inputTokens;
      log.outputTokens += usage.outputTokens;
      log.replies.push(hit.r.reply);
      return Promise.resolve({ text: hit.r.reply, provenance, usage });
    },
  };
}

function cloudProvider(log: ModelLog): ModelProvider {
  return {
    id: "eval-cloud",
    label: "Cloud (evaluation fake)",
    locality: "cloud",
    capabilities: { generate: true, stream: false, embed: false },
    costTier: 2,
    typicalLatencyMs: 1,
    models: () => Promise.resolve([]),
    health: () => Promise.resolve({ available: true, detail: "up" }),
    stream: () => {
      throw new ModelError("unsupported", "eval-cloud", "no streams");
    },
    embed: () => Promise.reject(new ModelError("unsupported", "eval-cloud", "no embeddings")),
    generate() {
      log.cloudCalls++;
      return Promise.reject(new ModelError("network", "eval-cloud", "must never be reached"));
    },
  };
}

export interface WorldOptions {
  setup: Setup;
  /** Agents beyond the CI agent; built with the world's model. */
  extraAgents?: (w: Pick<World, "model" | "engine" | "viewer">) => AgentDefinition[];
}

export async function buildWorld(options: WorldOptions): Promise<World> {
  const { setup } = options;
  const clock = { now: SCENARIO_NOW };
  const db = openDatabase(":memory:");
  const store = new EventStore(db);
  const bus = new EventBus({ store, retryDelayMs: 0 });
  const events: PhoenixEvent[] = [];
  bus.subscribe("eval.recorder", "*", (e) => void events.push(e));
  const permissions = new PermissionGateway({ db, publish: (e) => void bus.publish(e) });
  const confirmations = { approved: 0, rejected: 0 };
  const approvals = setup.approvals ?? "reject_all";
  // The simulated user answers every approval prompt the same way, like a very strict (or very
  // careless) person would. `none` answers nothing, so a run that needs one would hang: scenarios
  // that choose it must never need approval.
  bus.subscribe("eval.user", "security.confirmation.requested", (e) => {
    const id = e.payload.confirmation_id;
    if (typeof id !== "string" || approvals === "none") return;
    const ok = approvals === "approve_all";
    if (permissions.resolveConfirmation(id, ok, "eval-user")) confirmations[ok ? "approved" : "rejected"]++;
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

  const env: FakeEnv = {
    ci: setup.ci,
    notes: setup.notes ?? "Release 1.4.2 notes: no known issues.",
    faults: setup.faults ?? [],
    executed: [],
    auditCount: () => permissions.audit.count(),
    tick: (ms) => void (clock.now += ms),
  };
  manager.registerBuiltin(fakeGithub(env));
  manager.registerBuiltin(fakeGit(env));
  manager.registerBuiltin(fakeOps(env));
  for (const id of ["github", "git", "ops"]) {
    if (!(setup.disabled ?? []).includes(id)) await manager.enable(id);
  }

  const registry = new ToolRegistry({ manifests: enabledManifests(manager, db) });
  const policyStore = new PolicyStore(db);
  const policy = new PolicyEngine({
    store: policyStore,
    audit: permissions.audit,
    isKillSwitchEngaged: () => permissions.isKillSwitchEngaged(),
    isKnownTool: (t) => registry.has(t),
  });
  const admin = new PolicyAdmin({ store: policyStore, audit: permissions.audit });
  for (const rule of setup.policyRules ?? []) {
    admin.addRule({ kind: "user", id: "owner", trustedByUser: true }, rule);
  }
  const gateway = new ToolGateway({
    host: manager,
    registry,
    policy,
    audit: permissions.audit,
    approver: approverFromPermissions(permissions),
  });

  // Memory.
  const memClock = { now: new Date(SCENARIO_NOW) };
  const memStore = new MemoryStore(db, { now: () => memClock.now });
  const pipeline = new MemoryPipeline({
    store: memStore,
    owner: "me",
    policy: createDefaultPolicy({ isSourceEnabled: () => true, allowSensitive: () => true }),
  });
  for (const seed of setup.memory ?? []) {
    const kind = seed.kind ?? "doc";
    const observed = SCENARIO_NOW - (seed.ageDays ?? 1) * DAY_MS;
    memClock.now = new Date(observed);
    const out = pipeline.capture({
      source: kind === "meeting" ? "kage" : kind === "commit" ? "git" : "project-docs",
      sourceRef: seed.key,
      scope: seed.scope ?? (kind === "meeting" ? "meeting:eval" : "path:/docs"),
      contentType: kind === "meeting" ? "meeting_summary" : kind === "commit" ? "commit" : "doc",
      observedAt: new Date(observed).toISOString(),
      provenance: {},
      text: seed.text,
      dedupeKey: `eval:${seed.key}`,
      ...(seed.ttlDays === undefined ? {} : { freshnessTtlDays: seed.ttlDays }),
    });
    if (out.status !== "stored") throw new Error(`memory seed "${seed.key}" not stored: ${out.status}`);
  }
  memClock.now = new Date(SCENARIO_NOW);
  const ceiling = setup.viewerMaxSensitivity ?? "sensitive";
  const viewer: Viewer = { id: "me", grants: [{ scope: "*", maxSensitivity: ceiling }] };
  const engine = new ContextEngine({
    store: memStore,
    clock: { now: () => new Date(SCENARIO_NOW), timeZone: "UTC" },
  });

  // Model: a scripted provider behind the real AiService (router + privacy gate).
  const modelLog: ModelLog = { prompts: [], inputTokens: 0, outputTokens: 0, cloudCalls: 0, replies: [] };
  const registry2 = new ProviderRegistry();
  registry2.register(scriptedProvider(setup.model ?? [], modelLog, clock));
  registry2.register(cloudProvider(modelLog));
  const ai = new AiService({
    registry: registry2,
    policy: { allowed: () => false },
    settings: () => ({
      enabled: true,
      cloudOptIn: { public: false, internal: false, sensitive: false },
    }),
    sleep: () => Promise.resolve(),
    retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
    auditCloudSend: () => {},
  });
  const model: ModelCall = async (request, signal) =>
    (await ai.run({ kind: "generate", request, signal })).result;

  const base = { model, engine, viewer };
  const agents: AgentDefinition[] = [
    createCiFailureAgent({
      model,
      aiEnabled: () => true,
      context: { engine, viewer },
      nonce: () => "NONCE",
    }),
    ...(options.extraAgents?.(base) ?? []),
  ];
  let idCounter = 1;
  const orchestrator = new Orchestrator({
    db,
    gateway,
    audit: permissions.audit,
    isEnabled: () => true,
    isKillSwitchEngaged: () => permissions.isKillSwitchEngaged(),
    publish: (e) =>
      void bus.publish({
        ...e,
        event_id: undefined,
        version: "1.1",
        timestamp: new Date(clock.now).toISOString(),
        payload: e.payload ?? {},
      }),
    approvals: approvalFeed(bus, permissions),
    agents,
    now: () => clock.now,
    newId: (prefix) => `${prefix}_${(idCounter++).toString(16).padStart(32, "0")}`,
  });

  return {
    db,
    env,
    clock,
    permissions,
    manager,
    gateway,
    policy,
    admin,
    orchestrator,
    store: memStore,
    engine,
    viewer,
    ai,
    model,
    modelLog,
    events,
    confirmations,
    async close() {
      await orchestrator.close();
      await manager.close();
      permissions.close();
      await bus.drain();
      db.close();
    },
  };
}
