// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Awake capability (Phase 72): keeps the computer awake for a bounded time, without root.
// One capability, several modules: this file owns the session module (start / extend / end /
// status) and the registration seam. Later phases add an `AwakeModule` (recovery, lid actions,
// continuity) by appending it to MODULES below; `composeAwake` merges every module's commands,
// specs, events, state rules, config and lifecycle into the one manifest.
import {
  defineCapability,
  type CapabilityContext,
  type CapabilityModule,
  type Permission,
} from "@phoenix/sdk";
import {
  DEFAULT_BATTERY_FLOOR_PERCENT,
  DEFAULT_BATTERY_POLL_MS,
  MAX_BATTERY_FLOOR_PERCENT,
  MIN_BATTERY_FLOOR_PERCENT,
  createBatteryReader,
  floorFromConfig,
} from "./battery";
import { isRecord } from "./guards";
import { createInhibitor } from "./inhibit";
import {
  MAX_LABEL_LENGTH,
  MAX_SESSION_MINUTES,
  MIN_SESSION_MINUTES,
  SessionController,
  parseLabel,
  parseMinutes,
  type SessionEventFields,
  type SessionMode,
} from "./session";
import { continuityModule } from "./continuity";
import { lidActionsModule } from "./lid-actions";
import { recoveryModule } from "./power";
import {
  AwakeError,
  realEnv,
  type AgentEventFeed,
  type AwakeDeps,
  type AwakeEnv,
  type AwakeModule,
  type BatteryReading,
} from "./system";

export * from "./battery";
export * from "./inhibit";
export * from "./session";
export * from "./system";

/**
 * Modules added by later phases. Append yours here (one import, one entry):
 * Recovery73 `recoveryModule`, Lid74 `lidActionsModule`, Continuity75 `continuityModule`.
 */
export const MODULES: AwakeModule[] = [recoveryModule, lidActionsModule, continuityModule];

export interface ComposedAwake {
  events: string[];
  commandSpecs: AwakeModule["commandSpecs"];
  commands: AwakeModule["commands"];
  stateRules: AwakeModule["stateRules"];
  configProperties: Record<string, unknown>;
  secrets: NonNullable<AwakeModule["secrets"]>;
  /** `shell_command` (the session holds) plus whatever the modules declare, without repeats. */
  permissions: Permission[];
  /** Initialises every module; one module failing to start never stops the others. */
  init(ctx: CapabilityContext, deps: AwakeDeps): void;
  /** Shuts every module down in order; every module is attempted even if one throws. */
  shutdown(ctx: CapabilityContext): void;
}

/** Merges modules into one set of manifest parts. Duplicate command names, config keys or secrets throw. */
export function composeAwake(modules: readonly AwakeModule[]): ComposedAwake {
  const events = new Set<string>();
  const commandSpecs: ComposedAwake["commandSpecs"] = [];
  const commands: ComposedAwake["commands"] = {};
  const stateRules: ComposedAwake["stateRules"] = [];
  const configProperties: Record<string, unknown> = {};
  const secrets: ComposedAwake["secrets"] = [];
  const permissions = new Set<Permission>(["shell_command"]);
  for (const m of modules) {
    for (const e of m.events) events.add(e);
    for (const p of m.permissions ?? []) permissions.add(p);
    for (const spec of m.commandSpecs) {
      if (Object.hasOwn(commands, spec.name)) {
        throw new Error(`Awake command "${spec.name}" is defined by two modules`);
      }
      const handler = m.commands[spec.name];
      if (!handler) throw new Error(`Awake command "${spec.name}" has no handler`);
      commandSpecs.push(spec);
      commands[spec.name] = handler;
    }
    for (const name of Object.keys(m.commands)) {
      if (!m.commandSpecs.some((s) => s.name === name)) {
        throw new Error(`Awake handler "${name}" has no command spec`);
      }
    }
    stateRules.push(...m.stateRules);
    for (const [key, schema] of Object.entries(m.configProperties ?? {})) {
      if (Object.hasOwn(configProperties, key)) {
        throw new Error(`Awake config key "${key}" is defined by two modules`);
      }
      configProperties[key] = schema;
    }
    for (const secret of m.secrets ?? []) {
      if (secrets.some((s) => s.name === secret.name)) {
        throw new Error(`Awake secret "${secret.name}" is declared by two modules`);
      }
      secrets.push(secret);
    }
  }
  return {
    events: [...events],
    commandSpecs,
    commands,
    stateRules,
    configProperties,
    secrets,
    permissions: [...permissions],
    init(ctx, deps) {
      for (const m of modules) {
        try {
          m.init?.(ctx, deps);
        } catch (err) {
          ctx.logger.warn("awake module failed to start", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
    shutdown(ctx) {
      for (const m of modules) {
        try {
          m.shutdown?.();
        } catch (err) {
          ctx.logger.warn("awake module failed to shut down", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
  };
}

export interface AwakeCapabilityOptions {
  /** The host machine; tests inject a recording fake. Default: the real machine. */
  env?: AwakeEnv;
  /** Core's event bus (agent lifecycle, kill switch), read each time the capability is enabled. */
  feed?: () => AgentEventFeed | undefined;
  /** Battery source; default reads the platform's (`pmset`, /sys/class/power_supply, CIM). */
  battery?: () => Promise<BatteryReading>;
  batteryPollMs?: number;
  newId?: () => string;
  /** Replaces MODULES (tests). */
  modules?: readonly AwakeModule[];
}

const SESSION_EVENTS = [
  "awake.session.started",
  "awake.session.extended",
  "awake.session.ended",
] as const;

/** Reasons that mean the machine was left unprotected against sleep without the user asking. */
const WARNING_REASONS = new Set(["battery", "thermal", "inhibitor_lost"]);

const MODES: readonly SessionMode[] = ["timed", "agents_grace"];

function inputOf(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  const body = input === undefined ? {} : input;
  if (!isRecord(body)) throw new AwakeError("invalid", "input must be an object");
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw new AwakeError("invalid", `unknown field "${key}"`);
  }
  return body;
}

/** The session commands. `ref.controller` exists between init and shutdown. */
function sessionModule(ref: { controller: SessionController | undefined }): AwakeModule {
  const controller = (): SessionController => {
    if (!ref.controller) throw new AwakeError("unavailable", "The awake capability is not running");
    return ref.controller;
  };
  return {
    events: [...SESSION_EVENTS],
    stateRules: [],
    configProperties: {
      battery_floor_percent: {
        type: "integer",
        minimum: MIN_BATTERY_FLOOR_PERCENT,
        maximum: MAX_BATTERY_FLOOR_PERCENT,
        description: `A session ends when the battery falls below this percentage while on battery power (default ${DEFAULT_BATTERY_FLOOR_PERCENT}).`,
      },
    },
    commandSpecs: [
      {
        name: "start",
        description:
          "Keeps the computer awake for a set number of minutes (1 to 10080). Mode agents_grace holds while coding agents work and ends the given minutes after the last one finishes. Asks for confirmation every time.",
        side_effect: "execute",
        permissions: ["shell_command"],
        timeout_ms: 20_000,
        input_schema: {
          type: "object",
          additionalProperties: false,
          required: ["minutes"],
          properties: {
            minutes: {
              type: "integer",
              minimum: MIN_SESSION_MINUTES,
              maximum: MAX_SESSION_MINUTES,
              // Shown in the approval prompt: the user is approving how long, not just "start".
              "x-phoenix-confirm": true,
            },
            reason: { type: "string", minLength: 1, maxLength: MAX_LABEL_LENGTH },
            mode: { type: "string", enum: [...MODES] },
          },
        },
      },
      {
        name: "extend",
        description:
          "Adds minutes to the running timed session. The time left never exceeds 10080 minutes. Asks for confirmation every time.",
        side_effect: "execute",
        permissions: ["shell_command"],
        timeout_ms: 20_000,
        input_schema: {
          type: "object",
          additionalProperties: false,
          required: ["minutes"],
          properties: {
            minutes: {
              type: "integer",
              minimum: MIN_SESSION_MINUTES,
              maximum: MAX_SESSION_MINUTES,
              // Shown in the approval prompt: the user is approving how long, not just "start".
              "x-phoenix-confirm": true,
            },
          },
        },
      },
      {
        name: "end",
        description: "Ends the running keep-awake session and lets the computer sleep again.",
        side_effect: "execute",
        permissions: ["shell_command"],
        input_schema: { type: "object", additionalProperties: false, properties: {} },
      },
      {
        name: "status",
        description:
          "Whether a keep-awake session is running, when it ends, and the battery floor. Read-only.",
        side_effect: "read",
        input_schema: { type: "object", additionalProperties: false, properties: {} },
      },
    ],
    commands: {
      async start(input, ctx) {
        const body = inputOf(input, ["minutes", "reason", "mode"]);
        const minutes = parseMinutes(body.minutes);
        const label = parseLabel(body.reason);
        const mode = body.mode ?? "timed";
        if (mode !== "timed" && mode !== "agents_grace") {
          throw new AwakeError("invalid", "mode must be timed or agents_grace");
        }
        return await controller().start(mode, minutes, label, ctx.signal);
      },
      extend(input) {
        const body = inputOf(input, ["minutes"]);
        return controller().extend(parseMinutes(body.minutes));
      },
      end(input) {
        inputOf(input, []);
        const wasRunning = controller().end("cancelled");
        return { ended: wasRunning, ...controller().status() };
      },
      status(input) {
        inputOf(input, []);
        return controller().status();
      },
    },
    shutdown() {
      ref.controller?.shutdown();
    },
  };
}

function eventPayload(fields: SessionEventFields): Record<string, unknown> {
  const { label, ...rest } = fields;
  return { ...rest, ...(label ? { label } : {}) };
}

/** A fresh capability instance (its own session); Phoenix Core builds one per runtime. */
export function createAwakeCapability(options: AwakeCapabilityOptions = {}): CapabilityModule {
  const ref: { controller: SessionController | undefined } = { controller: undefined };
  const composed = composeAwake([sessionModule(ref), ...(options.modules ?? MODULES)]);
  let stopSignal: (() => void) | undefined;

  const module: CapabilityModule = defineCapability({
    manifest: {
      id: "awake",
      name: "Keep awake",
      version: "0.1.0",
      description:
        "Keeps this computer awake for a set time (1 minute to 7 days), without root: caffeinate on macOS, systemd-inhibit on Linux, SetThreadExecutionState via PowerShell on Windows (unverified). Always ends: on your say-so, when time is up, when the battery falls below a floor, or when Phoenix stops. Closing the lid still sleeps the machine.",
      license: "GPL-3.0-or-later",
      homepage: "https://github.com/Thunder-BluePhoenix/Phoenix",
      events: composed.events,
      permissions: composed.permissions,
      data_categories: ["keep-awake session times", "battery level"],
      healthcheck: { interval_ms: 30_000 },
      commands: composed.commandSpecs,
      config_schema: {
        type: "object",
        additionalProperties: false,
        properties: composed.configProperties,
      },
      ...(composed.secrets.length ? { secrets: composed.secrets } : {}),
      ...(composed.stateRules.length ? { state_rules: composed.stateRules } : {}),
    },
    init(ctx) {
      // A previous enable's session must never outlive it.
      ref.controller?.shutdown();
      stopSignal?.();
      const env = options.env ?? realEnv();
      const battery = options.battery ?? createBatteryReader(env);
      const batteryPollMs = options.batteryPollMs ?? DEFAULT_BATTERY_POLL_MS;
      const feed = options.feed?.();
      const controller = new SessionController({
        clock: env.clock,
        inhibitor: createInhibitor(env),
        battery,
        floor: floorFromConfig(ctx.config.battery_floor_percent),
        batteryPollMs,
        feed,
        newId: options.newId ?? (() => `awk_${crypto.randomUUID().replaceAll("-", "")}`),
        emit(type, fields) {
          const reason = fields.reason;
          const result = ctx.emit({
            event_type: type,
            severity: reason !== undefined && WARNING_REASONS.has(reason) ? "warning" : "info",
            subject: "Keep awake",
            correlation_id: fields.session_id,
            payload: eventPayload(fields),
          });
          if (!result.ok) ctx.logger.warn("awake event not published", { type });
        },
      });
      ref.controller = controller;
      // Disable and Core exit abort the capability's signal: release then, not only in shutdown().
      const onAbort = () => controller.end("disabled");
      if (ctx.signal.aborted) onAbort();
      else ctx.signal.addEventListener("abort", onAbort, { once: true });
      stopSignal = () => ctx.signal.removeEventListener("abort", onAbort);
      const deps: AwakeDeps = { env, session: controller, battery, feed, batteryPollMs };
      composed.init(ctx, deps);
    },
    commands: composed.commands,
    health(): { status: "healthy"; message: string } {
      const session = ref.controller?.status().session;
      if (!session) return { status: "healthy", message: "No keep-awake session running" };
      return {
        status: "healthy",
        message:
          session.remaining_seconds === null
            ? "Keeping the computer awake while agents work"
            : `Keeping the computer awake, ${Math.ceil(session.remaining_seconds / 60)} min left`,
      };
    },
    shutdown(ctx) {
      stopSignal?.();
      stopSignal = undefined;
      composed.shutdown(ctx);
    },
  });
  return module;
}
