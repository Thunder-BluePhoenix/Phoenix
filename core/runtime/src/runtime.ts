// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  openDatabase,
  schemaVersion,
  SettingsStore,
  type Database,
  type SecretStore,
} from "@phoenix/persistence";
import { createEvent, ErrorCode, PhoenixError, PROTOCOL_VERSION } from "@phoenix/protocol";
import { StateEngine } from "@phoenix/state-engine";
import { collectDiagnostics, type Diagnostics } from "./diagnostics";
import { syncMeetings } from "./meetings";
import { PrivacyService } from "./privacy";

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
  readonly token: string;
  private pruner: NodeJS.Timeout | null = null;
  private readonly stopMeetingSync: () => void;
  private api: ApiServer | null = null;
  private ticker: NodeJS.Timeout | null = null;
  private readonly startedAt = Date.now();
  private stopping: Promise<void> | null = null;

  constructor(private readonly options: RuntimeOptions) {
    this.config = options.config;
    this.logger = options.logger ?? createLogger({ level: options.config.logLevel });
    this.db = openDatabase(options.databasePath ?? join(this.config.dataDir, "phoenix.sqlite"));
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

    this.privacy = new PrivacyService({
      dataDir: this.config.dataDir,
      settings: this.settings,
      events: this.events,
      notifications: this.notifications,
      meetings: this.meetings,
      capabilities: this.capabilities,
      audit: this.permissions.audit,
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
    this.pruner = setInterval(() => this.privacy.prune(), 3_600_000);
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
    });
  }

  /** Graceful shutdown: stop accepting requests, flush the bus, close the database. Idempotent. */
  stop(): Promise<void> {
    this.stopping ??= (async () => {
      if (this.ticker) clearInterval(this.ticker);
      if (this.pruner) clearInterval(this.pruner);
      await this.api?.close();
      await this.capabilities.close();
      this.stopMeetingSync();
      this.notifications.close();
      this.permissions.close();
      await this.bus.drain();
      this.bus.close();
      if (this.options.writeTokenFile ?? true) {
        rmSync(join(this.config.dataDir, SESSION_TOKEN_FILE), { force: true });
      }
      this.db.close();
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
