// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { EventBus, PublishResult } from "@phoenix/event-bus";
import { silentLogger, type Logger } from "@phoenix/logging";
import type { PermissionGateway } from "@phoenix/permissions";
import type { Database, EventStore, SecretStore } from "@phoenix/persistence";
import {
  compileSchema,
  createEvent,
  ErrorCode,
  eventDeclared,
  findSecrets,
  PERMISSION_DESCRIPTIONS,
  PhoenixError,
  validateEvent,
  validateManifest,
  type CapabilityManifest,
  type NewEvent,
} from "@phoenix/protocol";
import type { MappingRule, StateEngine } from "@phoenix/state-engine";
import { assertLoopbackEndpoint, ExternalClient } from "./external";
import { guarded, toPhoenixError } from "./guard";
import type {
  CapabilityContext,
  CapabilityKind,
  CapabilityModule,
  CapabilityStatus,
  CapabilityView,
  HealthResult,
  HealthStatus,
  Operation,
} from "./types";

export interface CapabilityManagerOptions {
  db: Database;
  bus: EventBus;
  events?: EventStore;
  permissions: PermissionGateway;
  state: StateEngine;
  logger?: Logger;
  /** Default timeout for init/shutdown/command calls. */
  callTimeoutMs?: number;
  defaultHealthIntervalMs?: number;
  defaultHealthTimeoutMs?: number;
  /** OS secret storage for capability credentials (ctx.secret). */
  secrets?: SecretStore;
}

const SECRET_NAME = /^[a-z][a-z0-9_]{0,63}$/;

interface Entry {
  manifest: CapabilityManifest;
  kind: CapabilityKind;
  module?: CapabilityModule;
  endpoint?: string;
  token?: string;
  client?: ExternalClient;
  status: CapabilityStatus;
  health: { status: HealthStatus; message?: string; checkedAt?: string };
  config: Record<string, unknown>;
  abort?: AbortController;
  ctx?: CapabilityContext;
  healthTimer?: NodeJS.Timeout;
  rules?: MappingRule[];
  lastError?: string;
  disabledReason?: string;
  /** Last reported availability, to emit events only on transitions. */
  available?: boolean;
  /** The user had this enabled when Phoenix last ran (restore() resumes it). */
  resume?: boolean;
}

const MAX_OPERATIONS = 500;
let opCounter = 0;

/**
 * Registers, authorises and runs capabilities through their lifecycle:
 * register → enable (grant + init) → health → run → disable → uninstall.
 */
export class CapabilityManager {
  private readonly entries = new Map<string, Entry>();
  private readonly operations = new Map<string, Operation>();
  private readonly logger: Logger;
  private readonly callTimeoutMs: number;
  private readonly healthIntervalMs: number;
  private readonly healthTimeoutMs: number;
  private readonly unsubscribe: () => void;
  private closed = false;

  constructor(private readonly o: CapabilityManagerOptions) {
    this.logger = (o.logger ?? silentLogger).child("capabilities");
    this.callTimeoutMs = o.callTimeoutMs ?? 10_000;
    this.healthIntervalMs = o.defaultHealthIntervalMs ?? 30_000;
    this.healthTimeoutMs = o.defaultHealthTimeoutMs ?? 5_000;
    this.unsubscribe = o.bus.subscribe(
      "capability-manager",
      "security.kill_switch.engaged",
      async () => {
        await this.disableAll("kill_switch");
      },
    );
  }

  // ── Registration ──────────────────────────────────────────────────────────

  /** Registers a first-party in-process capability. */
  registerBuiltin(module: CapabilityModule): CapabilityView {
    const manifest = this.validate(module.manifest);
    if (this.entries.has(manifest.id)) {
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        `Capability "${manifest.id}" is already registered`,
      );
    }
    const missing = manifest.commands.filter((c) => !module.commands?.[c.name]).map((c) => c.name);
    if (missing.length) {
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        "Declared commands have no handler",
        missing,
      );
    }
    const stored = this.loadRow(manifest.id);
    const entry: Entry = {
      manifest,
      kind: "builtin",
      module,
      status: "installed",
      health: { status: "unknown" },
      config: stored?.config ?? {},
      resume: stored?.status === "enabled",
    };
    this.entries.set(manifest.id, entry);
    this.persist(entry);
    this.emit("capability.registered", entry);
    return this.view(entry);
  }

  /**
   * Registers (or re-registers) an external capability process.
   *
   * Credentials are per direction (ADR-0016):
   * - the returned `token` authenticates capability → core calls (events);
   * - `callbackSecret`, chosen by the capability, authenticates core → capability
   *   calls. Because the capability knows it before registering, core can call
   *   back immediately (e.g. to resume it) without racing the registration reply.
   *   When omitted, the issued token is used in both directions.
   */
  async registerExternal(
    manifestInput: unknown,
    endpoint: string,
    callbackSecret?: string,
  ): Promise<{ capability: CapabilityView; token: string }> {
    const manifest = this.validate(manifestInput);
    assertLoopbackEndpoint(endpoint);
    if (
      callbackSecret !== undefined &&
      (typeof callbackSecret !== "string" || callbackSecret.length < 32)
    ) {
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        "callback_secret must be at least 32 characters",
      );
    }
    const existing = this.entries.get(manifest.id);
    if (existing?.kind === "builtin") {
      throw new PhoenixError(
        ErrorCode.SECURITY_POLICY_BLOCKED,
        `"${manifest.id}" is a builtin capability`,
      );
    }
    if (existing && existing.status === "enabled") await this.disable(manifest.id, "re-registered");

    const stored = this.loadRow(manifest.id);
    const token = randomBytes(32).toString("base64url");
    const entry: Entry = {
      manifest,
      kind: "external",
      endpoint,
      token,
      client: new ExternalClient(endpoint, callbackSecret ?? token),
      status: "installed",
      health: { status: "unknown" },
      config: stored?.config ?? {},
    };
    this.entries.set(manifest.id, entry);
    this.persist(entry);
    this.emit("capability.registered", entry);

    // Resume a capability the user had enabled, unless it now asks for more permissions.
    if (stored?.status === "enabled" && this.permissionsAlreadyGranted(manifest)) {
      await this.enable(manifest.id, "system").catch(() => {});
    }
    return { capability: this.view(entry), token };
  }

  /** Re-enables builtin capabilities that were enabled before a restart. */
  async restore(): Promise<void> {
    for (const entry of this.entries.values()) {
      if (entry.kind !== "builtin" || !entry.resume) continue;
      delete entry.resume;
      if (this.permissionsAlreadyGranted(entry.manifest)) {
        await this.enable(entry.manifest.id, "system").catch(() => {});
      }
    }
    // External capabilities keep their stored status; they resume when their process re-registers.
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  list(): CapabilityView[] {
    const views = [...this.entries.values()].map((e) => this.view(e));
    // External capabilities known from earlier runs but not connected to this process.
    const rows = this.o.db
      .prepare("SELECT manifest, config FROM capabilities WHERE kind = 'external'")
      .all() as { manifest: string; config: string | null }[];
    for (const row of rows) {
      const manifest = JSON.parse(row.manifest) as CapabilityManifest;
      if (this.entries.has(manifest.id)) continue;
      views.push(
        this.view({
          manifest,
          kind: "external",
          status: "disconnected",
          health: { status: "unknown" },
          config: row.config ? JSON.parse(row.config) : {},
        }),
      );
    }
    return views.sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): CapabilityView {
    const entry = this.entries.get(id);
    if (entry) return this.view(entry);
    const known = this.list().find((c) => c.id === id); // e.g. a disconnected external capability
    if (!known)
      throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, `Capability "${id}" not found`);
    return known;
  }

  operation(id: string): Operation {
    const op = this.operations.get(id);
    if (!op) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Operation not found");
    return op;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async enable(id: string, by = "user"): Promise<CapabilityView> {
    const entry = this.require(id);
    if (this.o.permissions.isKillSwitchEngaged()) {
      throw new PhoenixError(ErrorCode.SECURITY_POLICY_BLOCKED, "Emergency stop is engaged");
    }
    if (entry.status === "enabled") return this.view(entry);
    this.validateConfig(entry, entry.config);

    const missing = this.o.permissions.grants.missing(id, entry.manifest.permissions);
    if (missing.length) {
      if (by === "system") {
        throw new PhoenixError(
          ErrorCode.PERMISSION_DENIED,
          "New permissions need user approval",
          missing,
        );
      }
      this.o.permissions.grant(id, missing, by);
    }

    const abort = new AbortController();
    entry.abort = abort;
    entry.ctx = this.context(entry, abort.signal);
    try {
      if (entry.kind === "builtin") {
        if (entry.module?.init)
          await guarded(() => entry.module!.init!(entry.ctx!), this.callTimeoutMs);
      } else {
        await entry.client!.lifecycle("enable", entry.config, this.callTimeoutMs);
      }
    } catch (err) {
      const e = toPhoenixError(err);
      abort.abort();
      entry.status = "failed";
      entry.lastError = e.message;
      this.persist(entry);
      this.emit("capability.failed", entry, "error", { error: e.message });
      this.logger.warn("capability failed to enable", { id, error: e.message });
      throw new PhoenixError(
        ErrorCode.CAPABILITY_UNAVAILABLE,
        `${entry.manifest.name} failed to start: ${e.message}`,
      );
    }

    if (entry.manifest.state_rules?.length) {
      entry.rules = entry.manifest.state_rules as unknown as MappingRule[];
      this.o.state.addRules(entry.rules);
    }
    entry.status = "enabled";
    delete entry.lastError;
    delete entry.disabledReason;
    entry.available = undefined;
    this.persist(entry);
    this.emit("capability.enabled", entry, "success");
    this.startHealth(entry);
    return this.view(entry);
  }

  async disable(id: string, reason = "user"): Promise<CapabilityView> {
    const entry = this.require(id);
    if (entry.status !== "enabled") return this.view(entry);
    this.stopHealth(entry);
    entry.abort?.abort();
    try {
      if (entry.kind === "builtin") {
        if (entry.module?.shutdown)
          await guarded(() => entry.module!.shutdown!(entry.ctx!), this.callTimeoutMs);
      } else {
        await entry.client!.lifecycle("disable", undefined, this.callTimeoutMs);
      }
    } catch (err) {
      this.logger.warn("capability shutdown failed", { id, error: toPhoenixError(err).message });
    }
    if (entry.rules) this.o.state.removeRules(entry.rules);
    delete entry.rules;
    // A stopped capability is no longer working, recording or warning about anything.
    this.o.state.clearSource(id);
    entry.status = "disabled";
    entry.disabledReason = reason;
    entry.health = { status: "unknown" };
    this.persist(entry);
    this.emit("capability.disabled", entry, "info", { reason });
    return this.view(entry);
  }

  async disableAll(reason: string): Promise<void> {
    await Promise.all(
      [...this.entries.values()]
        .filter((e) => e.status === "enabled")
        .map((e) => this.disable(e.manifest.id, reason)),
    );
  }

  /** Stores validated configuration. Secrets are not allowed in config (use the secret store). */
  configure(id: string, config: unknown): CapabilityView {
    const entry = this.require(id);
    if (config === null || typeof config !== "object" || Array.isArray(config)) {
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, "config must be an object");
    }
    const cfg = config as Record<string, unknown>;
    const secrets = findSecrets(cfg, "$.config");
    if (secrets.length) {
      throw new PhoenixError(
        ErrorCode.SECURITY_POLICY_BLOCKED,
        "Configuration must not contain secrets",
        secrets,
      );
    }
    this.validateConfig(entry, cfg);
    entry.config = cfg;
    this.persist(entry);
    return this.view(entry);
  }

  // ── Secrets ───────────────────────────────────────────────────────────────

  /** Stores a credential in OS secret storage; the database only keeps its name. */
  async setSecret(id: string, name: string, value: string, by = "user"): Promise<CapabilityView> {
    const entry = this.require(id);
    const store = this.secretStore();
    if (!SECRET_NAME.test(name)) {
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Invalid secret name");
    }
    if (!value || value.length > 8192) {
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Secret value must be 1-8192 characters");
    }
    await store.set(secretRef(id, name), value);
    this.o.db
      .prepare(
        `INSERT INTO credentials (id, capability_id, secret_ref, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET created_at = excluded.created_at`,
      )
      .run(`${id}/${name}`, id, secretRef(id, name), new Date().toISOString());
    this.o.permissions.audit.record({
      actor: by,
      action: "secret.set",
      capabilityId: id,
      decision: "info",
      details: { name },
    });
    return this.view(entry);
  }

  async deleteSecret(id: string, name: string, by = "user"): Promise<CapabilityView> {
    const entry = this.require(id);
    await this.secretStore().delete(secretRef(id, name));
    this.o.db.prepare("DELETE FROM credentials WHERE id = ?").run(`${id}/${name}`);
    this.o.permissions.audit.record({
      actor: by,
      action: "secret.deleted",
      capabilityId: id,
      decision: "info",
      details: { name },
    });
    return this.view(entry);
  }

  private secretNames(id: string): string[] {
    return (
      this.o.db
        .prepare("SELECT id FROM credentials WHERE capability_id = ? ORDER BY id")
        .all(id) as { id: string }[]
    ).map((r) => r.id.slice(id.length + 1));
  }

  private secretStore(): SecretStore {
    if (!this.o.secrets) {
      throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "No secret storage is available");
    }
    return this.o.secrets;
  }

  /** Disables, revokes permissions and removes the capability (and its secrets). */
  async uninstall(id: string, options: { retainData?: boolean } = {}): Promise<void> {
    const entry = this.require(id);
    await this.disable(id, "uninstall");
    this.o.permissions.revoke(id);
    for (const name of this.secretNames(id)) await this.deleteSecret(id, name, "uninstall");
    if (!options.retainData) this.o.events?.deleteBySource(id);
    this.entries.delete(id);
    this.o.db.prepare("DELETE FROM capabilities WHERE id = ?").run(id);
    this.emit("capability.uninstalled", entry, "info", {
      retain_data: Boolean(options.retainData),
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    for (const e of this.entries.values()) {
      if (e.status !== "enabled") continue;
      this.stopHealth(e);
      e.abort?.abort();
      if (e.kind === "builtin" && e.module?.shutdown) {
        await guarded(() => e.module!.shutdown!(e.ctx!), this.callTimeoutMs).catch(() => {});
      }
    }
  }

  // ── Commands ──────────────────────────────────────────────────────────────

  /**
   * Starts a command and returns its operation immediately. The operation
   * passes the permission gateway (which may wait for user confirmation)
   * before the capability is called. Completion is reported through
   * capability.command.completed / .failed events with correlation_id = operation id.
   */
  invoke(id: string, command: string, input: unknown = {}, actor = "user"): Operation {
    const entry = this.require(id);
    if (entry.status !== "enabled") {
      throw new PhoenixError(
        ErrorCode.CAPABILITY_DISABLED,
        `${entry.manifest.name} is not enabled`,
      );
    }
    const spec = entry.manifest.commands.find((c) => c.name === command);
    if (!spec) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, `Unknown command "${command}"`);
    if (spec.input_schema) {
      const problems = compileSchema(spec.input_schema)(input);
      if (problems.length)
        throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Invalid command input", problems);
    }
    const secrets = findSecrets(input, "$.input");
    if (secrets.length) {
      throw new PhoenixError(
        ErrorCode.SECURITY_POLICY_BLOCKED,
        "Command input must not contain secrets",
        secrets,
      );
    }

    const now = new Date().toISOString();
    const op: Operation = {
      id: `op_${Date.now().toString(36)}${(opCounter++).toString(36)}${randomBytes(4).toString("hex")}`,
      capabilityId: id,
      command,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };
    this.remember(op);

    void (async () => {
      let action;
      try {
        action = await this.o.permissions.authorize({
          capabilityId: id,
          command,
          permissions: spec.permissions ?? [],
          sideEffect: spec.side_effect,
          summary: `${entry.manifest.name}: ${spec.description}`,
          details: { actor, operation_id: op.id },
        });
        this.update(op, { status: "running" });
        const timeout = spec.timeout_ms ?? this.callTimeoutMs;
        const result =
          entry.kind === "builtin"
            ? await guarded(() => entry.module!.commands![command]!(input, entry.ctx!), timeout)
            : await entry.client!.command(command, input, op.id, timeout);
        this.update(op, { status: "succeeded", result });
        if (this.closed) return;
        this.o.permissions.recordOutcome(action, "succeeded", { operation_id: op.id });
        // Commands without side effects (status reads, terminal reports) stay out of the
        // activity history; the audit log still records them.
        this.emitOp(
          "capability.command.completed",
          entry,
          op,
          "success",
          {},
          {
            ephemeral: spec.side_effect === "none",
          },
        );
      } catch (err) {
        const e = toPhoenixError(err);
        this.update(op, { status: "failed", error: e.toJSON() });
        if (this.closed) return;
        if (action)
          this.o.permissions.recordOutcome(action, "failed", {
            operation_id: op.id,
            error: e.message,
          });
        this.emitOp("capability.command.failed", entry, op, "warning", { code: e.code });
      }
    })();
    return op;
  }

  /** Convenience for callers that want to await the outcome. */
  async invokeAndWait(
    id: string,
    command: string,
    input: unknown = {},
    actor = "user",
  ): Promise<Operation> {
    const op = this.invoke(id, command, input, actor);
    while (op.status === "pending" || op.status === "running") {
      await new Promise((r) => setTimeout(r, 5));
    }
    return op;
  }

  // ── External event ingestion ──────────────────────────────────────────────

  /** Verifies a capability token (constant-time). */
  authenticate(id: string, token: string | undefined): boolean {
    const entry = this.entries.get(id);
    if (!entry?.token || !token) return false;
    const a = Buffer.from(entry.token);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Accepts an event from an external capability that presented its token. */
  ingest(id: string, token: string | undefined, event: unknown): PublishResult {
    if (!this.authenticate(id, token))
      throw new PhoenixError(ErrorCode.UNAUTHENTICATED, "Invalid capability token");
    const entry = this.require(id);
    return this.publishAs(entry, event);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private publishAs(entry: Entry, event: unknown, ephemeral = false): PublishResult {
    if (entry.status !== "enabled") {
      return { ok: false, error: new PhoenixError(ErrorCode.CAPABILITY_DISABLED) };
    }
    const v = validateEvent(event);
    if (!v.ok) return { ok: false, error: v.error };
    if (v.event.source !== entry.manifest.id) {
      return {
        ok: false,
        error: new PhoenixError(
          ErrorCode.SECURITY_POLICY_BLOCKED,
          `Source must be "${entry.manifest.id}"`,
        ),
      };
    }
    if (!eventDeclared(entry.manifest.events, v.event.event_type)) {
      return {
        ok: false,
        error: new PhoenixError(
          ErrorCode.SECURITY_POLICY_BLOCKED,
          `Event type "${v.event.event_type}" is not declared in the manifest`,
        ),
      };
    }
    return this.o.bus.publish(v.event, { expectedSource: entry.manifest.id, ephemeral });
  }

  private context(entry: Entry, signal: AbortSignal): CapabilityContext {
    return {
      id: entry.manifest.id,
      config: Object.freeze({ ...entry.config }),
      logger: this.logger.child(entry.manifest.id),
      signal,
      secret: async (name) =>
        this.o.secrets && SECRET_NAME.test(name)
          ? this.o.secrets.get(secretRef(entry.manifest.id, name))
          : undefined,
      emit: (event, options) =>
        signal.aborted
          ? { ok: false, error: new PhoenixError(ErrorCode.CAPABILITY_DISABLED) }
          : this.publishAs(
              entry,
              createEvent({ ...event, source: entry.manifest.id } as NewEvent),
              options?.ephemeral,
            ),
    };
  }

  private startHealth(entry: Entry): void {
    this.stopHealth(entry);
    const interval = entry.manifest.healthcheck?.interval_ms ?? this.healthIntervalMs;
    const check = () => void this.checkHealth(entry.manifest.id).catch(() => {});
    entry.healthTimer = setInterval(check, interval);
    entry.healthTimer.unref();
    check();
  }

  private stopHealth(entry: Entry): void {
    if (entry.healthTimer) clearInterval(entry.healthTimer);
    delete entry.healthTimer;
  }

  /** Runs one health check now. Emits availability events only on transitions. */
  async checkHealth(id: string): Promise<CapabilityView> {
    const entry = this.require(id);
    if (entry.status !== "enabled") return this.view(entry);
    const timeout = entry.manifest.healthcheck?.timeout_ms ?? this.healthTimeoutMs;
    let result: HealthResult;
    try {
      if (entry.kind === "builtin") {
        result = entry.module?.health
          ? await guarded(() => entry.module!.health!(entry.ctx!), timeout)
          : { status: "healthy" };
      } else {
        result = await entry.client!.health(timeout);
      }
    } catch (err) {
      result = { status: "unhealthy", message: toPhoenixError(err).message };
    }
    if (entry.status !== "enabled" || this.closed) return this.view(entry); // disabled while checking

    entry.health = { ...result, checkedAt: new Date().toISOString() };
    const available = result.status !== "unhealthy";
    if (entry.available !== available) {
      entry.available = available;
      this.emit(
        available ? "capability.available" : "capability.unavailable",
        entry,
        available ? "success" : "warning",
        {
          health: result.status,
          ...(result.message ? { message: result.message } : {}),
        },
      );
    }
    this.emit("capability.health", entry, "info", { health: result.status }, { ephemeral: true });
    return this.view(entry);
  }

  private validate(manifest: unknown): CapabilityManifest {
    const r = validateManifest(manifest);
    if (!r.ok) throw r.error;
    return r.manifest;
  }

  private validateConfig(entry: Entry, config: Record<string, unknown>): void {
    if (!entry.manifest.config_schema) return;
    const problems = compileSchema(entry.manifest.config_schema)(config);
    if (problems.length)
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Invalid configuration", problems);
  }

  private permissionsAlreadyGranted(manifest: CapabilityManifest): boolean {
    return this.o.permissions.grants.missing(manifest.id, manifest.permissions).length === 0;
  }

  private require(id: string): Entry {
    const entry = this.entries.get(id);
    if (!entry)
      throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, `Capability "${id}" not found`);
    return entry;
  }

  private remember(op: Operation): void {
    this.operations.set(op.id, op);
    if (this.operations.size > MAX_OPERATIONS) {
      const oldest = this.operations.keys().next().value;
      if (oldest) this.operations.delete(oldest);
    }
  }

  private update(op: Operation, patch: Partial<Operation>): void {
    Object.assign(op, patch, { updatedAt: new Date().toISOString() });
  }

  private loadRow(id: string): { status: string; config: Record<string, unknown> } | undefined {
    const row = this.o.db
      .prepare("SELECT status, config FROM capabilities WHERE id = ?")
      .get(id) as { status: string; config: string | null } | undefined;
    return row
      ? { status: row.status, config: row.config ? JSON.parse(row.config) : {} }
      : undefined;
  }

  private persist(entry: Entry): void {
    if (this.closed) return;
    this.o.db
      .prepare(
        `INSERT INTO capabilities (id, version, status, manifest, config, updated_at, kind, endpoint)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET version = excluded.version, status = excluded.status,
           manifest = excluded.manifest, config = excluded.config, updated_at = excluded.updated_at,
           kind = excluded.kind, endpoint = excluded.endpoint`,
      )
      .run(
        entry.manifest.id,
        entry.manifest.version,
        entry.status,
        JSON.stringify(entry.manifest),
        JSON.stringify(entry.config),
        new Date().toISOString(),
        entry.kind,
        entry.endpoint ?? null,
      );
  }

  private emit(
    type: string,
    entry: Entry,
    severity: "info" | "success" | "warning" | "error" = "info",
    extra: Record<string, unknown> = {},
    options: { ephemeral?: boolean } = {},
  ): void {
    if (this.closed) return;
    const r = this.o.bus.publish(
      createEvent({
        event_type: type,
        source: "core",
        severity,
        subject: entry.manifest.id,
        payload: { capability: entry.manifest.id, name: entry.manifest.name, ...extra },
      }),
      options,
    );
    if (!r.ok) this.logger.warn("failed to publish capability event", { type, code: r.error.code });
  }

  private emitOp(
    type: string,
    entry: Entry,
    op: Operation,
    severity: "success" | "warning",
    extra: Record<string, unknown> = {},
    options: { ephemeral?: boolean } = {},
  ): void {
    if (this.closed) return;
    this.o.bus.publish(
      createEvent({
        event_type: type,
        source: "core",
        severity,
        subject: entry.manifest.id,
        correlation_id: op.id,
        payload: {
          operation_id: op.id,
          capability: entry.manifest.id,
          command: op.command,
          ...extra,
        },
      }),
      options,
    );
  }

  private view(e: Entry): CapabilityView {
    const granted = new Set(this.o.permissions.grants.list(e.manifest.id).map((g) => g.permission));
    return {
      id: e.manifest.id,
      name: e.manifest.name,
      version: e.manifest.version,
      description: e.manifest.description,
      license: e.manifest.license,
      kind: e.kind,
      status: e.status,
      health: e.health,
      permissions: e.manifest.permissions.map((p) => ({
        permission: p,
        description: PERMISSION_DESCRIPTIONS[p],
        granted: granted.has(p),
      })),
      commands: e.manifest.commands.map((c) => ({
        name: c.name,
        description: c.description,
        side_effect: c.side_effect,
      })),
      events: e.manifest.events,
      data_categories: e.manifest.data_categories ?? [],
      config: e.config,
      secrets: this.secretNames(e.manifest.id),
      ...(e.lastError ? { lastError: e.lastError } : {}),
      ...(e.disabledReason ? { disabledReason: e.disabledReason } : {}),
    };
  }
}

const secretRef = (id: string, name: string) => `capability.${id}.${name}`;
