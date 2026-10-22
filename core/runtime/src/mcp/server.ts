// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The Phoenix MCP server (Phase 76), Core side. OFF by default. When the owner turns it on, a
// separate listener opens on 127.0.0.1 (never the session-token API port, never another interface).
// Clients are created in Settings: a 256-bit token is shown ONCE and only its SHA-256 is stored; a
// new client has no grants. docs/mcp-server.md is the contract.
import { randomBytes } from "node:crypto";
import type {
  McpApi,
  McpClientView,
  McpCreatedClientView,
  McpGrantsView,
  McpStatusView,
} from "@phoenix/api";
import type { EventBus } from "@phoenix/event-bus";
import type { Logger } from "@phoenix/logging";
import type { PermissionGateway } from "@phoenix/permissions";
import { McpClientStore, type Database, type SettingsStore } from "@phoenix/persistence";
import type { MappingRule } from "@phoenix/state-engine";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { HIDDEN_TEXT_CHARS } from "../agent-approvals";
import { isRecord } from "./guards";
import { parseGrants, readStoredGrants, noGrants, type McpGrants } from "./grants";
import { hashToken, McpHandler, TOKEN_PREFIX, type McpHandlerTuning } from "./handler";
import { McpListener, type McpRefusal } from "./listener";
import { RateWindow } from "./rate";
import { McpTools, type McpApprovals, type McpBackends } from "./tools";
import { MCP_STATE_RULES } from "./state-rules";

export const DEFAULT_MCP_PORT = 47822;
export const MAX_MCP_CLIENTS = 20;
const MAX_NAME_CHARS = 80;
const KEY_ENABLED = "mcp.enabled";
const KEY_PORT = "mcp.port";
const REFUSAL_AUDITS_PER_MINUTE = 20;

const invalid = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);

/** Tests inject the clock and a free port; production uses the defaults. */
export interface McpTuning extends McpHandlerTuning {
  now?: () => number;
  /** Default {@link DEFAULT_MCP_PORT}; 0 = any free port (tests). */
  port?: number;
}

export interface McpServerDeps extends McpTuning {
  /** True inside the demo runtime: it never opens a socket. */
  unavailable?: boolean;
  db: Database;
  settings: SettingsStore;
  bus: Pick<EventBus, "subscribe" | "publish">;
  permissions: PermissionGateway;
  approvals: McpApprovals;
  state: { addRules(rules: readonly MappingRule[]): void };
  backends: McpBackends;
  logger: Logger;
  version: string;
}

interface Running {
  listener: McpListener;
  port: number;
}

export class McpServer implements McpApi {
  readonly clientStore: McpClientStore;
  private readonly now: () => number;
  private readonly defaultPort: number;
  private readonly tools: McpTools;
  private readonly handler: McpHandler;
  private readonly refusalBudget = new RateWindow(REFUSAL_AUDITS_PER_MINUTE, 60_000);
  private running: Running | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private unsubscribe: (() => void) | null = null;
  private closed = false;

  constructor(private readonly d: McpServerDeps) {
    this.clientStore = new McpClientStore(d.db);
    this.now = d.now ?? Date.now;
    this.defaultPort = d.port ?? DEFAULT_MCP_PORT;
    this.tools = new McpTools({
      backends: d.backends,
      approvals: d.approvals,
      bus: d.bus,
      clients: this.clientStore,
      logger: d.logger,
      now: this.now,
    });
    // Fawkes' reaction to `phoenix_notify` (own `mcp.agent.*` events, every state expires).
    d.state.addRules(MCP_STATE_RULES);
    this.handler = new McpHandler({
      store: this.clientStore,
      tools: this.tools,
      audit: d.permissions.audit,
      isKillSwitchEngaged: () => d.permissions.isKillSwitchEngaged(),
      now: this.now,
      logger: d.logger,
      version: d.version,
      ...(d.callsPerMinute === undefined ? {} : { callsPerMinute: d.callsPerMinute }),
      ...(d.maxInFlight === undefined ? {} : { maxInFlight: d.maxInFlight }),
    });
    // Returned, so `bus.drain()` waits for the listener to be closed.
    this.unsubscribe = d.bus.subscribe("mcp-server", "security.kill_switch.engaged", () =>
      this.shutDownForKillSwitch(),
    );
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Called once at Core start: reopens the listener only if the owner left it enabled. */
  async start(): Promise<void> {
    if (!this.d.settings.get<boolean>(KEY_ENABLED, false)) return;
    if (this.d.permissions.isKillSwitchEngaged()) {
      this.d.settings.set(KEY_ENABLED, false);
      return;
    }
    try {
      await this.serialise(() => this.open());
    } catch (err) {
      this.d.logger.warn("MCP server could not start", { error: (err as Error).message });
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.serialise(() => this.shut());
  }

  private serialise<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private configuredPort(): number {
    return this.d.settings.get<number>(KEY_PORT, this.defaultPort);
  }

  private async open(): Promise<void> {
    if (this.running || this.closed) return;
    if (this.d.unavailable)
      throw new PhoenixError(
        ErrorCode.CAPABILITY_UNAVAILABLE,
        "The MCP server is not available in demo mode",
      );
    if (this.d.permissions.isKillSwitchEngaged())
      throw new PhoenixError(ErrorCode.SECURITY_POLICY_BLOCKED, "Emergency stop is engaged");
    const listener = new McpListener({
      handler: this.handler,
      logger: this.d.logger,
      refused: (reason) => this.auditRefusal(reason),
    });
    let bound: { port: number };
    try {
      bound = await listener.listen(this.configuredPort());
    } catch (err) {
      this.d.logger.warn("MCP server could not bind", { error: (err as Error).message });
      throw new PhoenixError(
        ErrorCode.CAPABILITY_UNAVAILABLE,
        `The MCP server could not listen on 127.0.0.1:${this.configuredPort()}`,
      );
    }
    this.running = { listener, port: bound.port };
  }

  private async shut(): Promise<void> {
    const running = this.running;
    this.running = null;
    this.handler.reset();
    if (running) await running.listener.close();
  }

  private async shutDownForKillSwitch(): Promise<void> {
    await this.serialise(async () => {
      const wasEnabled = this.d.settings.get<boolean>(KEY_ENABLED, false);
      const wasRunning = this.running !== null;
      this.d.settings.set(KEY_ENABLED, false);
      await this.shut();
      if (wasEnabled || wasRunning) {
        this.d.permissions.audit.record({
          actor: "core",
          action: "mcp.listener.closed",
          decision: "info",
          details: { reason: "kill_switch" },
        });
      }
    });
  }

  private auditRefusal(reason: McpRefusal): void {
    if (!this.refusalBudget.take("transport", this.now())) return;
    this.d.permissions.audit.record({
      actor: "mcp:unknown",
      action: "mcp.call.denied",
      decision: "denied",
      details: { reason },
    });
  }

  // ── Owner API (session token) ─────────────────────────────────────────────

  status(): McpStatusView {
    const enabled = this.d.settings.get<boolean>(KEY_ENABLED, false);
    const port = this.running?.port ?? this.configuredPort();
    return {
      enabled,
      listening: this.running !== null,
      port,
      url: this.running ? `http://127.0.0.1:${this.running.port}/mcp` : null,
      kill_switch: this.d.permissions.isKillSwitchEngaged(),
      clients: this.clientStore.countActive(),
      unavailable: this.d.unavailable === true,
    };
  }

  async configure(input: unknown): Promise<McpStatusView> {
    if (!isRecord(input)) throw invalid("Settings must be an object");
    for (const key of Object.keys(input)) {
      if (key !== "enabled" && key !== "port") throw invalid(`Unknown field "${key.slice(0, 40)}"`);
    }
    const { enabled, port } = input;
    if (enabled !== undefined && typeof enabled !== "boolean")
      throw invalid('"enabled" must be true or false');
    if (
      port !== undefined &&
      !(typeof port === "number" && Number.isInteger(port) && port >= 1024 && port <= 65535) &&
      !(this.d.port === 0 && port === 0)
    )
      throw invalid('"port" must be an integer from 1024 to 65535');
    await this.serialise(async () => {
      const reopen = port !== undefined && port !== this.configuredPort();
      if (port !== undefined) this.d.settings.set(KEY_PORT, port);
      if (enabled === false || reopen) {
        await this.shut();
        if (enabled === false) this.d.settings.set(KEY_ENABLED, false);
      }
      if (enabled === false) {
        this.d.permissions.audit.record({
          actor: "user",
          action: "mcp.listener.disabled",
          decision: "info",
          details: {},
        });
      }
      if (enabled === true || (reopen && this.d.settings.get<boolean>(KEY_ENABLED, false))) {
        await this.open();
        this.d.settings.set(KEY_ENABLED, true);
        if (enabled === true)
          this.d.permissions.audit.record({
            actor: "user",
            action: "mcp.listener.enabled",
            decision: "info",
            details: { port: this.running?.port },
          });
      }
    });
    return this.status();
  }

  clients(): McpClientView[] {
    return this.clientStore.list().map((c) => this.view(c));
  }

  createClient(input: unknown): McpCreatedClientView {
    if (!isRecord(input)) throw invalid("Body must be an object");
    for (const key of Object.keys(input)) {
      if (key !== "name") throw invalid(`Unknown field "${key.slice(0, 40)}"`);
    }
    const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
    if (name.length === 0 || name.length > MAX_NAME_CHARS || HIDDEN_TEXT_CHARS.test(name))
      throw invalid(`"name" must be 1 to ${MAX_NAME_CHARS} visible characters`);
    if (this.clientStore.countActive() >= MAX_MCP_CLIENTS)
      throw invalid(
        `At most ${MAX_MCP_CLIENTS} active clients; revoke one first (revoked clients do not count)`,
      );
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const id = `mcp_${randomBytes(6).toString("hex")}`;
    const createdAt = new Date(this.now()).toISOString();
    this.clientStore.create({
      id,
      name,
      tokenHash: hashToken(token),
      grants: noGrants(),
      createdAt,
    });
    this.d.permissions.audit.record({
      actor: "user",
      action: "mcp.client.created",
      decision: "info",
      details: { client: id },
    });
    return {
      client: this.view({
        id,
        name,
        grants: noGrants(),
        createdAt,
        lastUsedAt: null,
        revokedAt: null,
      }),
      token,
    };
  }

  setGrants(id: string, input: unknown): McpClientView {
    const grants = parseGrants(input);
    const found = this.clientStore.get(id);
    if (!found || found.revokedAt !== null || !this.clientStore.setGrants(id, grants))
      throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Client not found");
    this.d.permissions.audit.record({
      actor: "user",
      action: "mcp.client.grants_changed",
      decision: "info",
      details: {
        client: id,
        tools: grants.tools,
        memory_scopes: grants.memory.length,
        request_approval: grants.request_approval,
        notify: grants.notify,
      },
    });
    return this.view({ ...found, grants });
  }

  revokeClient(id: string): { id: string; revoked: true } {
    if (!this.clientStore.revoke(id, new Date(this.now()).toISOString()))
      throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Client not found");
    this.tools.forget(id);
    this.d.permissions.audit.record({
      actor: "user",
      action: "mcp.client.revoked",
      decision: "info",
      details: { client: id },
    });
    return { id, revoked: true };
  }

  /** "Delete all" for MCP data: every client goes, the listener closes, the setting is cleared. */
  deleteAll(): { deleted: number } {
    const deleted = this.clientStore.deleteAll();
    this.d.settings.set(KEY_ENABLED, false);
    this.tools.forgetAll();
    void this.serialise(() => this.shut());
    return { deleted };
  }

  private view(c: {
    id: string;
    name: string;
    grants: unknown;
    createdAt: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
  }): McpClientView {
    const grants: McpGrants = readStoredGrants(c.grants);
    const view: McpGrantsView = {
      tools: grants.tools,
      memory: grants.memory.map((m) => ({
        scope: m.scope,
        max_sensitivity: m.max_sensitivity,
        ...(m.domains === undefined ? {} : { domains: m.domains }),
      })),
      request_approval: grants.request_approval,
      notify: grants.notify,
    };
    return {
      id: c.id,
      name: c.name,
      grants: view,
      created_at: c.createdAt,
      last_used_at: c.lastUsedAt,
      revoked_at: c.revokedAt,
    };
  }
}
