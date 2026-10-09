// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Viewer } from "@phoenix/ai-memory";
import type { AgentDefinition } from "@phoenix/ai-orchestrator";
import type { FetchLike } from "@phoenix/ai-models";
import {
  approverFromPermissions,
  enabledManifests,
  ToolGateway,
  ToolRegistry,
} from "@phoenix/ai-tool-gateway";
import { ApiServer, generateSessionToken, type CoreServices } from "@phoenix/api";
import { CapabilityManager, type CapabilityModule } from "@phoenix/capability-manager";
import type { PhoenixConfig } from "@phoenix/config";
import { EventBus } from "@phoenix/event-bus";
import { createLogger, type Logger } from "@phoenix/logging";
import { NotificationService } from "@phoenix/notifications";
import { PermissionGateway } from "@phoenix/permissions";
import {
  DeadLetterStore,
  EventStore,
  MeetingStore,
  lockDatabaseFile,
  openDatabase,
  schemaVersion,
  SettingsStore,
  type Database,
  type SecretStore,
} from "@phoenix/persistence";
import { createEvent, ErrorCode, PhoenixError, PROTOCOL_VERSION } from "@phoenix/protocol";
import { PolicyAdmin, PolicyEngine, PolicyStore } from "@phoenix/policy";
import { StateEngine } from "@phoenix/state-engine";
import { AgentRuntime } from "./agents";
import { AiRuntime } from "./ai";
import { collectDiagnostics, type Diagnostics } from "./diagnostics";
import { MemoryRuntime } from "./memory";
import { GraphRuntime } from "./graph";
import { MeetingReviewRuntime } from "./meeting-review";
import { syncMeetings } from "./meetings";
import { PrivacyService, type DerivedInventory } from "./privacy";
import { RetrievalRuntime } from "./retrieval";

export interface PetSettings {
  /** "auto" follows the OS reduced-motion setting. */
  reduced_motion: "auto" | "on" | "off";
}

export const PHOENIX_VERSION = "0.1.0-dev";
export const SESSION_TOKEN_FILE = "session.token";

export interface RuntimeOptions {
  config: PhoenixConfig;
  logger?: Logger;
  /** Override the database path (":memory:" in tests). */
  databasePath?: string;
  /** Interval for expiring transient states. */
  tickMs?: number;
  /** Fixed session token (tests). A random one is generated otherwise. */
  token?: string;
  /** Write the session token to <dataDir>/session.token for local clients (default true). */
  writeTokenFile?: boolean;
  /** First-party capabilities to register at startup. */
  capabilities?: readonly CapabilityModule[];
  /** OS secret storage for capability credentials. Without it, secrets cannot be set. */
  secrets?: SecretStore;
  /** Network used by the AI providers. Tests pass a counting fake; production uses global fetch. */
  fetch?: FetchLike;
  /** Ollama base URL (loopback only). Defaults to http://127.0.0.1:11434. */
  ollamaUrl?: string;
  /** Anthropic base URL; tests only. */
  anthropicUrl?: string;
  /**
   * Who the memory browser, search and ask run as. Defaults to the device owner. Core has one
   * user, so this is the seam for a narrower view (and for the permission-scoping tests).
   */
  memoryViewer?: Viewer;
  /** Further agent kinds (embedding, tests). Automation is still off until the user enables it. */
  agents?: readonly AgentDefinition[];
}

/**
 * Phoenix Core process: owns persistence, the event bus, the state engine and
 * the permission gateway, and serves the HTTP/WebSocket API.
 */
export class PhoenixRuntime implements CoreServices {
  readonly config: PhoenixConfig;
  readonly logger: Logger;
  readonly db: Database;
  readonly events: EventStore;
  readonly settings: SettingsStore;
  readonly deadLetters: DeadLetterStore;
  readonly bus: EventBus;
  readonly state: StateEngine;
  readonly permissions: PermissionGateway;
  readonly capabilities: CapabilityManager;
  readonly notifications: NotificationService;
  readonly meetings: MeetingStore;
  readonly privacy: PrivacyService;
  readonly ai: AiRuntime;
  readonly memory: MemoryRuntime;
  /** Hybrid retrieval (Phase 37). Off until the user turns it on; needs AI on too. */
  readonly retrieval: RetrievalRuntime;
  /** Review of meeting decisions and action items (Phase 35). */
  readonly meetingReview: MeetingReviewRuntime;
  /** Knowledge graph and provenance (Phase 38). */
  readonly graph: GraphRuntime;
  /**
   * The only path from an agent to a capability (Phase 30). Phase 31 hands this, and nothing
   * else, to the agent runtime.
   */
  readonly toolGateway: ToolGateway;
  /**
   * Agent automation (Phase 31): off until the user turns it on. Holds the tool gateway and
   * nothing else that can reach a capability.
   */
  readonly agents: AgentRuntime;
  /**
   * Changes policy. Deliberately private and unused by any route: only code that holds the
   * runtime (never an agent, never a tool result) could reach it, and every method also refuses
   * any actor that is not a trusted user.
   */
  private readonly policyAdmin: PolicyAdmin;
  readonly token: string;
  private pruner: NodeJS.Timeout | null = null;
  private readonly stopMeetingSync: () => void;
  /** Gives up the claim on the data directory (see lockDatabaseFile). */
  private readonly releaseDatabase: () => void;
  private api: ApiServer | null = null;
  private ticker: NodeJS.Timeout | null = null;
  private readonly startedAt = Date.now();
  private stopping: Promise<void> | null = null;

  constructor(private readonly options: RuntimeOptions) {
    this.config = options.config;
    this.logger = options.logger ?? createLogger({ level: options.config.logLevel });
    const databasePath = options.databasePath ?? join(this.config.dataDir, "phoenix.sqlite");
    this.releaseDatabase = lockDatabaseFile(databasePath);
    try {
      this.db = openDatabase(databasePath);
    } catch (err) {
      this.releaseDatabase();
      throw err;
    }
    this.events = new EventStore(this.db, this.config.eventHistoryLimit);
    this.settings = new SettingsStore(this.db);
    this.deadLetters = new DeadLetterStore(this.db);
    this.bus = new EventBus({
      store: this.events,
      deadLetters: this.deadLetters,
      logger: this.logger,
      dedupWindow: this.config.dedupWindow,
    });
    this.state = new StateEngine();
    this.permissions = new PermissionGateway({
      db: this.db,
      logger: this.logger,
      publish: (event) => {
        const result = this.bus.publish(event);
        if (!result.ok) this.logger.warn("security event rejected", { code: result.error.code });
      },
    });
    this.token = options.token ?? generateSessionToken();
    this.capabilities = new CapabilityManager({
      db: this.db,
      bus: this.bus,
      events: this.events,
      permissions: this.permissions,
      state: this.state,
      logger: this.logger,
      ...(options.secrets ? { secrets: options.secrets } : {}),
    });
    for (const module of options.capabilities ?? []) this.capabilities.registerBuiltin(module);
    this.notifications = new NotificationService({
      db: this.db,
      bus: this.bus,
      state: this.state,
      logger: this.logger,
    });

    this.meetings = new MeetingStore(this.db);
    this.stopMeetingSync = syncMeetings({
      bus: this.bus,
      store: this.meetings,
      capabilities: this.capabilities,
      logger: this.logger,
    });

    this.ai = new AiRuntime({
      settings: this.settings,
      permissions: this.permissions,
      logger: this.logger,
      ...(options.secrets ? { secrets: options.secrets } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.ollamaUrl ? { ollamaUrl: options.ollamaUrl } : {}),
      ...(options.anthropicUrl ? { anthropicUrl: options.anthropicUrl } : {}),
    });
    this.memory = new MemoryRuntime({
      db: this.db,
      settings: this.settings,
      bus: this.bus,
      meetings: this.meetings,
      capabilities: this.capabilities,
      audit: this.permissions.audit,
      ai: this.ai.service,
      logger: this.logger,
      ...(options.memoryViewer ? { viewer: options.memoryViewer } : {}),
    });

    this.retrieval = new RetrievalRuntime({
      db: this.db,
      store: this.memory.store,
      settings: this.settings,
      ai: this.ai.service,
      embeddingProviders: () => this.ai.embeddingProviders(),
      aiEnabled: () => this.ai.aiSettings().enabled,
      audit: this.permissions.audit,
      logger: this.logger,
    });
    this.meetingReview = new MeetingReviewRuntime({
      db: this.db,
      meetings: this.meetings,
      memory: this.memory,
      retrieval: this.retrieval,
      audit: this.permissions.audit,
      ai: this.ai.service,
      aiEnabled: () => this.ai.aiSettings().enabled,
      logger: this.logger,
      onItemsChanged: () => this.graph.syncMeetings(),
    });
    this.graph = new GraphRuntime({
      db: this.db,
      bus: this.bus,
      capabilities: this.capabilities,
      store: this.memory.store,
      meetings: this.meetings,
      ai: this.ai.service,
      aiEnabled: () => this.ai.aiSettings().enabled,
      retrieval: this.retrieval,
      viewer: () => this.memory.agentContext().viewer,
      audit: this.permissions.audit,
      logger: this.logger,
      itemsOf: (meetingId) => this.meetingReview.service.items.list(meetingId),
      meetingsAllowed: () => this.memory.settings().allow_sensitive_meetings,
    });
    this.memory.attach({
      retrieval: this.retrieval,
      hooks: {
        rejectItems: (ids) => this.meetingReview.rejectForgotten(ids),
        meetingsAllowed: () => {
          this.meetingReview.resyncMemory();
          this.graph.syncMeetings();
        },
        meetingsRevoked: () => this.graph.removeMeetingData(),
      },
    });

    const policyStore = new PolicyStore(this.db);
    const registry = new ToolRegistry({ manifests: enabledManifests(this.capabilities, this.db) });
    const policy = new PolicyEngine({
      store: policyStore,
      audit: this.permissions.audit,
      isKillSwitchEngaged: () => this.permissions.isKillSwitchEngaged(),
      isKnownTool: (tool) => registry.has(tool),
    });
    this.policyAdmin = new PolicyAdmin({ store: policyStore, audit: this.permissions.audit });
    this.toolGateway = new ToolGateway({
      host: this.capabilities,
      registry,
      policy,
      audit: this.permissions.audit,
      approver: approverFromPermissions(this.permissions),
      logger: this.logger,
    });

    this.agents = new AgentRuntime({
      db: this.db,
      settings: this.settings,
      gateway: this.toolGateway,
      permissions: this.permissions,
      bus: this.bus,
      memory: this.memory,
      ai: this.ai.service,
      aiEnabled: () => this.ai.aiSettings().enabled,
      ...(options.agents ? { extraAgents: options.agents } : {}),
      logger: this.logger,
    });

    this.privacy = new PrivacyService({
      dataDir: this.config.dataDir,
      settings: this.settings,
      events: this.events,
      notifications: this.notifications,
      meetings: this.meetings,
      capabilities: this.capabilities,
      audit: this.permissions.audit,
      memory: this.memory,
      derived: () => this.derivedInventory(),
      externalAi: () => this.ai.describeExternalProcessing(),
    });

    this.bus.subscribe("state-engine", "*", (event) => {
      this.state.handle(event);
    });
    this.state.onChange((snapshot) => {
      this.bus.publish(
        createEvent({
          event_type: "pet.state.changed",
          source: "core",
          severity: "info",
          payload: {
            state: snapshot.state,
            explanation: snapshot.explanation,
            recording: snapshot.recording,
            since: snapshot.since,
          },
        }),
        { ephemeral: true },
      );
    });
    this.state.setSleeping(this.settings.get("pet.sleeping", false));
    if (this.permissions.isKillSwitchEngaged()) {
      // Re-raise the warning so an engaged emergency stop is visible after restart.
      this.state.handle(
        createEvent({
          event_type: "security.kill_switch.engaged",
          source: "core",
          severity: "warning",
        }),
      );
    }
  }

  async start(): Promise<{ host: string; port: number }> {
    this.api = new ApiServer({
      services: this,
      token: this.token,
      ...(this.config.webRoot ? { webRoot: this.config.webRoot } : {}),
    });
    const address = await this.api.listen(this.config.port, this.config.host);
    if (this.options.writeTokenFile ?? true) this.writeTokenFile();

    this.ticker = setInterval(() => this.state.tick(), this.options.tickMs ?? 1_000);
    this.ticker.unref();
    this.privacy.prune();
    // Not awaited: reading a large docs folder must not delay the API coming up.
    void this.memory.maintain().then(() => {
      this.graph.ingestMemory();
      this.graph.syncMeetings();
      this.meetingReview.importAll();
    });
    this.pruner = setInterval(() => {
      this.privacy.prune();
      void this.memory.maintain().then(() => this.graph.ingestMemory());
    }, 3_600_000);
    this.pruner.unref();
    await this.capabilities.restore();

    this.bus.publish(
      createEvent({
        event_type: "system.online",
        source: "core",
        severity: "info",
        payload: { version: PHOENIX_VERSION },
      }),
    );
    this.logger.info("Phoenix Core started", {
      url: `http://${address.address}:${address.port}`,
      env: this.config.env,
      dataDir: this.config.dataDir,
    });
    return { host: address.address, port: address.port };
  }

  private reviewItemCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM meeting_items").get() as { n: number };
    return row.n;
  }

  /** Counts of what Phoenix derived from the data classes above (vectors, graph, review items). */
  private derivedCounts() {
    const retrieval = this.retrieval.status();
    const graph = this.graph.graph.stats();
    return {
      vectors: retrieval.embedded,
      graph_nodes: graph.nodes,
      graph_edges: graph.edges,
      meeting_items: this.reviewItemCount(),
    };
  }

  /** What the privacy inventory lists besides the data classes: derived, deleted with its source. */
  private derivedInventory(): DerivedInventory[] {
    const retrieval = this.retrieval.status();
    const graph = this.graph.graph.stats();
    return [
      {
        id: "vectors",
        description:
          "Numbers computed from memory text so Fawkes can find a reworded memory. They can reveal what the text was about, live in the same database file as the text and are deleted with it. Search by meaning is off unless AI and retrieval are both on.",
        count: retrieval.embedded,
        deleted_with: "memory",
        enabled: retrieval.active,
      },
      {
        id: "graph",
        description:
          "Who changed what, in which commit, issue, meeting or decision, with where each link came from. Built from your events, memories and meetings and deleted with them; people can also be forgotten by name.",
        count: graph.nodes,
        edges: graph.edges,
        provenance_rows: graph.provenance,
        deleted_with: "events, memory, meetings",
      },
      {
        id: "meeting_items",
        description:
          "Decisions and action items from meetings, with the quote they came from and whether you accepted them. Deleted with the meeting.",
        count: this.reviewItemCount(),
        deleted_with: "meetings",
      },
    ];
  }

  /** Fawkes appearance, shared by every Fawkes view (web, desktop). */
  petSettings(): PetSettings {
    return {
      reduced_motion: "auto",
      ...this.settings.get<Partial<PetSettings>>("pet.settings", {}),
    };
  }

  setPetSettings(input: unknown): PetSettings {
    const motion = (input as { reduced_motion?: unknown } | null)?.reduced_motion;
    if (motion !== "auto" && motion !== "on" && motion !== "off") {
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        '"reduced_motion" must be "auto", "on" or "off"',
      );
    }
    const next: PetSettings = { ...this.petSettings(), reduced_motion: motion };
    this.settings.set("pet.settings", next);
    return next;
  }

  setSleeping(sleeping: boolean): void {
    this.settings.set("pet.sleeping", sleeping);
    this.state.setSleeping(sleeping);
  }

  health() {
    const snapshot = this.state.snapshot();
    return {
      status: "ok" as const,
      version: PHOENIX_VERSION,
      protocol: PROTOCOL_VERSION,
      env: this.config.env,
      uptime_ms: Date.now() - this.startedAt,
      schema_version: schemaVersion(this.db),
      pet: { state: snapshot.state, recording: snapshot.recording },
      kill_switch: this.permissions.isKillSwitchEngaged(),
      active_tasks: this.state.tasks().length,
      capabilities: this.capabilities
        .list()
        .map((c) => ({ id: c.id, status: c.status, health: c.health.status })),
      bus: this.bus.metrics(),
      websocket: this.api?.hub.metrics() ?? null,
    };
  }

  /** A report safe to attach to a bug report: how Phoenix behaves, not what you were doing. */
  diagnostics(): Diagnostics {
    return collectDiagnostics({
      health: this.health(),
      capabilities: this.capabilities,
      events: this.events,
      deadLetters: this.deadLetters,
      audit: this.permissions.audit,
      counts: {
        events: this.events.count(),
        notifications: this.notifications.count(),
        meetings: this.meetings.count(),
        audit_entries: this.permissions.audit.count(),
      },
      derived: this.derivedCounts(),
    });
  }

  /** Graceful shutdown: stop accepting requests, flush the bus, close the database. Idempotent. */
  stop(): Promise<void> {
    this.stopping ??= (async () => {
      if (this.ticker) clearInterval(this.ticker);
      if (this.pruner) clearInterval(this.pruner);
      await this.api?.close();
      await this.agents.close();
      await this.graph.close();
      this.meetingReview.close();
      await this.retrieval.close();
      await this.capabilities.close();
      this.stopMeetingSync();
      await this.memory.close();
      this.notifications.close();
      this.permissions.close();
      await this.bus.drain();
      this.bus.close();
      if (this.options.writeTokenFile ?? true) {
        rmSync(join(this.config.dataDir, SESSION_TOKEN_FILE), { force: true });
      }
      this.db.close();
      this.releaseDatabase();
      this.logger.info("Phoenix Core stopped");
    })();
    return this.stopping;
  }

  private writeTokenFile(): void {
    mkdirSync(this.config.dataDir, { recursive: true });
    const path = join(this.config.dataDir, SESSION_TOKEN_FILE);
    writeFileSync(path, this.token + "\n", { mode: 0o600 });
    chmodSync(path, 0o600);
  }
}
