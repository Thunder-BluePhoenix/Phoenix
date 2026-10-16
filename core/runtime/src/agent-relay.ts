// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 57, Core side: hosts the owner-only relay socket that coding-agent hooks talk to, and
// fronts the hook installers for the session-token HTTP routes. Which operations exist is decided
// by the relay's fixed allow-list; this class only decides what Core does for each of them. None
// of it is a capability command or tool, so an agent cannot install, remove or approve anything.
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AgentApprovalsApi,
  AgentRelayAction,
  AgentRelayAgentView,
  AgentRelayAppliedView,
  AgentRelayApi,
  AgentRelayPreviewView,
  AgentRelayStatusView,
} from "@phoenix/api";
import {
  HookInstaller,
  InstallError,
  RELAY_VERSION,
  RelayServer,
  RelayStartError,
  StaleFileError,
  type RelayServerOptions,
} from "@phoenix/capability-agents";
import type { EventBus } from "@phoenix/event-bus";
import type { Logger } from "@phoenix/logging";
import type { AuditLog } from "@phoenix/permissions";
import { createEvent, ErrorCode, PhoenixError } from "@phoenix/protocol";

type RelayHandler = (body: unknown) => unknown | Promise<unknown>;

/** Operations Core answers only once another subsystem registers for them (Phase 58). */
type RegisterableOp = "step" | "usage";

/** What the relay needs from the live-sessions subsystem. */
export interface AgentRelayLive {
  recordStep(body: unknown): unknown;
  recordUsage(body: unknown): unknown;
}

export interface AgentRelayDeps {
  dataDir: string;
  bus: EventBus;
  audit: AuditLog;
  logger: Logger;
  version: string;
  approvals: AgentApprovalsApi;
  /** Runs the `agents` capability's `report` command; the runtime supplies the invocation. */
  invokeReport: (input: unknown) => unknown;
  /** Default: the real installer over the user's home directory, built on first use. */
  installer?: HookInstaller;
  /** Transport knobs for tests (uid, timers, platform, limits). */
  relay?: Partial<Omit<RelayServerOptions, "dataDir" | "handlers">>;
  /**
   * Live sessions (Phase 58): when it returns a value at `start()`, `step` and `usage` are served
   * by it (it validates the bodies); otherwise those operations answer not_available.
   */
  live?: () => AgentRelayLive | undefined;
}

const AGENT_ID = /^[a-z0-9-]{1,24}$/;
const CONFIRM_HASH = /^[0-9a-f]{64}$/;
const CLIENT_LABEL = /^[A-Za-z0-9 _.:-]{1,40}$/;

const invalid = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);

const INSTALL_ERROR_CODES: Record<InstallError["code"], ErrorCode> = {
  unknown_agent: ErrorCode.RESOURCE_NOT_FOUND,
  unsupported: ErrorCode.INVALID_REQUEST,
  not_detected: ErrorCode.INVALID_REQUEST,
  invalid_file: ErrorCode.INVALID_REQUEST,
  nothing_to_do: ErrorCode.INVALID_REQUEST,
  io: ErrorCode.INTERNAL_ERROR,
};

interface ChangeBody {
  agent: string;
  confirmHash: string | undefined;
}

function parseChange(input: unknown): ChangeBody {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw invalid("Body must be a JSON object");
  }
  const body = input as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (key !== "agent" && key !== "confirm_hash") throw invalid(`Unknown field "${key}"`);
  }
  if (typeof body.agent !== "string" || !AGENT_ID.test(body.agent)) {
    throw invalid('"agent" must be a short lowercase agent id');
  }
  if (
    body.confirm_hash !== undefined &&
    (typeof body.confirm_hash !== "string" || !CONFIRM_HASH.test(body.confirm_hash))
  ) {
    throw invalid('"confirm_hash" must be the hash from the preview');
  }
  return { agent: body.agent, confirmHash: body.confirm_hash };
}

export class AgentRelay implements AgentRelayApi {
  private server: RelayServer | undefined;
  private installerInstance: HookInstaller | undefined;
  private error: string | undefined;
  private readonly registered: Partial<Record<RegisterableOp, RelayHandler>> = {};

  constructor(private readonly d: AgentRelayDeps) {
    this.installerInstance = d.installer;
  }

  /** Never throws: a relay that cannot listen leaves Core running and says why in `status()`. */
  async start(): Promise<void> {
    if (this.server) return;
    const live = this.d.live?.();
    const server = new RelayServer({
      ...this.d.relay,
      dataDir: this.d.dataDir,
      coreVersion: this.d.version,
      logger: this.d.logger,
      handlers: {
        report: async (body) => {
          await this.d.invokeReport(body);
          return { accepted: true };
        },
        "approval.create": (body) => this.d.approvals.create(body, "relay"),
        "approval.wait": (body) => this.wait(body),
        ...(live
          ? {
              step: (body: unknown) => live.recordStep(body),
              usage: (body: unknown) => live.recordUsage(body),
            }
          : {}),
        ...this.registered,
      },
    });
    try {
      await server.start();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.d.logger.warn(
        err instanceof RelayStartError ? "agent relay not started" : "agent relay failed to listen",
        { error: this.error },
      );
      return;
    }
    this.error = undefined;
    this.server = server;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    await server?.stop();
  }

  /** Lets a later subsystem (live sessions, usage) answer an operation the relay otherwise refuses. */
  register(op: RegisterableOp, handler: RelayHandler): void {
    this.registered[op] = handler;
    this.server?.setHandler(op, handler);
  }

  status(): AgentRelayStatusView {
    return {
      running: this.server !== undefined,
      version: RELAY_VERSION,
      platform: this.d.relay?.platform ?? process.platform,
      ...(this.server ? { path: this.server.path } : {}),
      ...(this.error === undefined ? {} : { error: this.error }),
    };
  }

  agents(): { relay: AgentRelayStatusView; agents: AgentRelayAgentView[] } {
    return { relay: this.status(), agents: this.installer().list() };
  }

  /** Without `confirm_hash`: what would change, written nowhere. With it: that exact change. */
  change(
    action: AgentRelayAction,
    input: unknown,
    client?: string,
  ): AgentRelayPreviewView | AgentRelayAppliedView {
    const { agent, confirmHash } = parseChange(input);
    const installer = this.installer();
    if (confirmHash === undefined) return this.guarded(() => installer.preview(action, agent));

    const actor = `user:${client !== undefined && CLIENT_LABEL.test(client) ? client : "unknown"}`;
    try {
      const applied = installer.apply(action, agent, confirmHash);
      this.d.audit.record({
        actor,
        action: `agent_relay.${action}`,
        capabilityId: "agent_relay",
        decision: "allowed",
        details: {
          agent,
          path: applied.path,
          changed: applied.changed,
          kept_user_edits: applied.kept_user_edits,
        },
      });
      this.publishChanged();
      return applied;
    } catch (err) {
      const error =
        err instanceof InstallError
          ? err.code
          : err instanceof StaleFileError
            ? "stale"
            : "internal";
      this.d.audit.record({
        actor,
        action: `agent_relay.${action}`,
        capabilityId: "agent_relay",
        decision: "denied",
        details: { agent, error },
      });
      throw this.translate(err);
    }
  }

  private installer(): HookInstaller {
    this.installerInstance ??= new HookInstaller({
      home: homedir(),
      env: process.env,
      backupDir: join(this.d.dataDir, "agent-backups"),
    });
    return this.installerInstance;
  }

  private guarded<T>(run: () => T): T {
    try {
      return run();
    } catch (err) {
      throw this.translate(err);
    }
  }

  private translate(err: unknown): PhoenixError {
    if (err instanceof PhoenixError) return err;
    if (err instanceof StaleFileError) {
      return new PhoenixError(ErrorCode.ACTION_REQUIRES_CONFIRMATION, err.message);
    }
    if (err instanceof InstallError) {
      if (err.code !== "io") return new PhoenixError(INSTALL_ERROR_CODES[err.code], err.message);
      this.d.logger.warn("agent hook installer failed", { code: err.code, error: err.message });
      return new PhoenixError(
        ErrorCode.INTERNAL_ERROR,
        "Could not change the agent's settings file",
      );
    }
    this.d.logger.warn("agent hook installer failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return new PhoenixError(ErrorCode.INTERNAL_ERROR, "Could not change the agent's settings file");
  }

  private publishChanged(): void {
    const result = this.d.bus.publish(
      createEvent({
        event_type: "agent.relay.changed",
        source: "core",
        severity: "info",
        payload: {},
      }),
    );
    if (!result.ok) {
      this.d.logger.warn("agent relay event rejected", { code: result.error.code });
    }
  }

  /** The socket form of `POST /api/agent-approvals/:id/wait`: the id travels in the body. */
  private wait(input: unknown) {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw invalid("Body must be a JSON object");
    }
    const { id, nonce, wait_ms } = input as Record<string, unknown>;
    if (typeof id !== "string") throw invalid('"id" must be a string');
    if (typeof nonce !== "string") throw invalid('"nonce" must be a string');
    return this.d.approvals.wait(id, wait_ms === undefined ? { nonce } : { nonce, wait_ms });
  }
}
