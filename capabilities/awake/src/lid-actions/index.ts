// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 74, lid-close actions. While a keep-awake session runs and the lid closes, Phoenix saves
// power and quiets the machine: display off, chat apps frozen, sound muted, Low Power Mode on,
// optionally Docker Desktop frozen and App Nap off. When the lid opens, the session ends, the
// capability is disabled, the kill switch fires or Core exits, every one of those is undone.
//
// Safety, in the order it is built (see README-lid.md):
//   1. every change is journalled BEFORE it is made (Recovery's `change()`); no journal, no change;
//   2. each journal entry carries everything its undo needs, and the undo is registered with
//      Recovery, so a dead Phoenix's leftovers are undone by the next launch (reconcile);
//   3. a frozen process is resumed only if its pid, start time and command still match the entry;
//   4. the protected list (Phoenix, terminals, editors, running agents, meeting apps) is never
//      frozen, and an unknown meeting state means no freeze.
// Every OS effect goes through an injected seam (types.ts), so tests use recording fakes.
import type { CapabilityContext, CommandSpec } from "@phoenix/sdk";
import { isRecord } from "../guards";
import { powerServices, type PowerServices } from "../power";
import {
  AwakeError,
  type AwakeDeps,
  type AwakeModule,
  type SessionEndReason,
  type TimerHandle,
} from "../system";
import { trackActivity, type Activity } from "./activity";
import { createAppNap } from "./actions/app-nap";
import { createDisplay } from "./actions/display";
import { createDockerFreeze } from "./actions/docker-freeze";
import { createFreezeApps } from "./actions/freeze-apps";
import { createLowPower } from "./actions/low-power";
import { createMute } from "./actions/mute";
import { FREEZE_APPS } from "./apps";
import { LID_ACTIONS_SCHEMA, parseLidActionsConfig, type LidActionsConfig } from "./config";
import { LidEngine, lidReverters } from "./engine";
import { BUILT_IN_PROTECTED_LABELS } from "./protected";
import { createOsascriptAudio, createProcessLister, realSignaler, realStat } from "./real";
import {
  ACTION_IDS,
  type ActionId,
  type ActionSupport,
  type AudioControl,
  type DockerIdle,
  type FileStat,
  type LidAction,
  type LidSeams,
  type ProcessLister,
  type ProtectedState,
  type Signaler,
  type AgentPids,
} from "./types";

export * from "./activity";
export * from "./apps";
export * from "./config";
export * from "./engine";
export * from "./protected";
export * from "./real";
export * from "./types";
export * from "./actions/app-nap";
export * from "./actions/display";
export * from "./actions/docker-freeze";
export * from "./actions/freeze-apps";
export * from "./actions/freeze-core";
export * from "./actions/low-power";
export * from "./actions/mute";

export const LID_ACTION_EVENTS: readonly string[] = [
  "awake.lid_action.applied",
  "awake.lid_action.undone",
  "awake.lid_action.failed",
];

/** The longest `shutdown()` waits for the undo (the sudo helper and process table reads are bounded). */
export const SHUTDOWN_WAIT_MS = 10_000;

/** How often an end of session is looked for when no event announced it. */
export const SESSION_CHECK_MS = 5_000;

/** Seams a test (or a host) replaces. Defaults are the real thing or, where nothing real exists, fail closed. */
export interface LidActionsOptions {
  /** TEST SEAM. Adds `lid_actions.simulate_close` / `simulate_open`. Never true in production. */
  allowSimulation?: boolean;
  processes?: ProcessLister;
  signal?: Signaler;
  audio?: AudioControl;
  /** Phoenix's Docker capability's view. Default: "unknown" (so Docker is never frozen): see README-lid.md, GAP. */
  dockerIdle?: DockerIdle;
  /** Overrides the event-based meeting / recording / dictation state. */
  protectedState?: ProtectedState;
  /** Overrides the event-based pids of tracked coding agents. */
  agentPids?: AgentPids;
  selfPid?: number;
  /** Phoenix's user id. Default: `process.getuid()`; none available means no process is a target. */
  uid?: number;
  /** Owner and mode of a file (the brightness tool check). Default: the real one. */
  stat?: FileStat;
  /** Waits `ms` between undo retries and bounds the shutdown wait. Default: the host clock's timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Overrides Recovery's services (otherwise `powerServices(deps)`). */
  services?: (deps: AwakeDeps) => PowerServices | undefined;
}

interface Running {
  ctx: CapabilityContext;
  deps: AwakeDeps;
  config: LidActionsConfig;
  engine: LidEngine;
  actions: LidAction[];
  services: PowerServices;
  activity: Activity;
  seams: LidSeams;
  unsubscribe: (() => void)[];
  timer: TimerHandle | undefined;
  stopped: boolean;
}

const NO_INPUT = { type: "object", additionalProperties: false, properties: {} } as const;

function noInput(input: unknown): void {
  if (input === undefined) return;
  if (!isRecord(input) || Object.keys(input).length > 0) {
    throw new AwakeError("invalid", "this command takes no input");
  }
}

const STATUS_SPEC: CommandSpec = {
  name: "lid_actions.status",
  description:
    "Which lid-close actions are on, whether this computer can do them, the protected list and what the last lid event did. Read-only; it never changes anything.",
  side_effect: "read",
  permissions: ["shell_command"],
  timeout_ms: 30_000,
  input_schema: NO_INPUT,
};

const SIMULATION_SPECS: CommandSpec[] = [
  {
    name: "lid_actions.simulate_close",
    description:
      "TEST ONLY: runs the lid-close actions as if the lid had closed. Not available in production.",
    side_effect: "execute",
    permissions: ["shell_command"],
    timeout_ms: 60_000,
    input_schema: NO_INPUT,
  },
  {
    name: "lid_actions.simulate_open",
    description:
      "TEST ONLY: undoes the lid-close actions as if the lid had opened. Not available in production.",
    side_effect: "execute",
    permissions: ["shell_command"],
    timeout_ms: 60_000,
    input_schema: NO_INPUT,
  },
];

const END_WHY: Partial<
  Record<SessionEndReason, "kill_switch" | "disabled" | "shutdown" | "session_ended">
> = {
  kill_switch: "kill_switch",
  disabled: "disabled",
  shutdown: "shutdown",
};

/** A lid-actions module. Create one per capability instance; tests build their own. */
export function createLidActionsModule(options: LidActionsOptions = {}): AwakeModule {
  let running: Running | undefined;

  const need = (): Running => {
    if (!running) throw new AwakeError("unavailable", "The awake capability is not running");
    return running;
  };

  function emit(
    r: Running,
    type: string,
    severity: "info" | "warning",
    payload: Record<string, unknown>,
  ): void {
    try {
      const result = r.ctx.emit({ event_type: type, severity, subject: "Lid actions", payload });
      if (!result.ok) r.ctx.logger.warn("lid action event not published", { type });
    } catch {
      // A rejected event never stops an undo.
    }
  }

  function stop(): Running | undefined {
    const r = running;
    running = undefined;
    if (!r) return undefined;
    r.stopped = true;
    if (r.timer !== undefined) r.deps.env.clock.clearTimer(r.timer);
    for (const off of r.unsubscribe) off();
    r.activity.stop();
    return r;
  }

  /** The session ended, or Phoenix is stopping: the lid actions go with it. */
  function release(
    r: Running,
    session: string | null,
    why: "session_ended" | "disabled" | "kill_switch" | "shutdown",
  ): void {
    if (r.engine.closedSession === null) return;
    const id = session ?? r.engine.closedSession;
    void r.engine.endSession(id, why);
  }

  function checkSession(r: Running): void {
    // A lid that opened while the observer's reading was "unknown" is never announced as a change.
    void r.engine.lidReading(r.services.lid.state());
    const closed = r.engine.closedSession;
    if (closed !== null && r.deps.session.active()?.id !== closed)
      release(r, closed, "session_ended");
  }

  function arm(r: Running): void {
    if (r.stopped) return;
    r.timer = r.deps.env.clock.setTimer(() => {
      checkSession(r);
      arm(r);
    }, SESSION_CHECK_MS);
  }

  async function supportOf(r: Running, id: ActionId): Promise<ActionSupport> {
    const action = r.actions.find((a) => a.id === id);
    if (!action) return { supported: false };
    try {
      return await action.support();
    } catch {
      return { supported: false };
    }
  }

  const specs: CommandSpec[] = options.allowSimulation
    ? [STATUS_SPEC, ...SIMULATION_SPECS]
    : [STATUS_SPEC];

  const commands: AwakeModule["commands"] = {
    async "lid_actions.status"(input) {
      noInput(input);
      const r = need();
      const c = r.config;
      const switches: Record<ActionId, boolean> = {
        display: c.display,
        freeze_apps: c.freezeApps,
        mute: c.mute,
        low_power: c.lowPower,
        docker_freeze: c.dockerFreeze,
        app_nap: c.appNap,
      };
      const actions: Record<string, unknown>[] = [];
      for (const id of ACTION_IDS) {
        const enabled = c.enabled && switches[id];
        // Nothing is asked of the machine for an action that is off.
        const support = enabled ? await supportOf(r, id) : null;
        actions.push({
          id,
          enabled,
          ...(support ? { supported: support.supported } : {}),
          ...(support?.reason ? { reason: support.reason } : {}),
          ...(support?.limits ? { limits: support.limits } : {}),
        });
      }
      return {
        enabled: c.enabled,
        closed: r.engine.closedSession !== null,
        actions,
        freeze_list: c.freezeList,
        freezable: FREEZE_APPS.map((a) => a.key),
        app_nap_apps: c.appNapList,
        protected: { built_in: [...BUILT_IN_PROTECTED_LABELS], extra: c.protectedExtra },
        ignored_config_entries: c.dropped,
        last: r.engine.last,
        simulation: options.allowSimulation === true,
      };
    },
    async "lid_actions.simulate_close"(input) {
      noInput(input);
      if (options.allowSimulation !== true)
        throw new AwakeError("unavailable", "Simulation is not available");
      const r = need();
      const session = r.deps.session.active();
      if (!session) throw new AwakeError("no_session", "No keep-awake session is running");
      return await r.engine.close(session.id);
    },
    async "lid_actions.simulate_open"(input) {
      noInput(input);
      if (options.allowSimulation !== true)
        throw new AwakeError("unavailable", "Simulation is not available");
      return await need().engine.open("simulated");
    },
  };
  if (options.allowSimulation !== true) {
    delete commands["lid_actions.simulate_close"];
    delete commands["lid_actions.simulate_open"];
  }

  return {
    events: [...LID_ACTION_EVENTS],
    stateRules: [],
    configProperties: { lid_actions: LID_ACTIONS_SCHEMA },
    commandSpecs: specs,
    commands,
    init(ctx, deps) {
      stop();
      const services = (options.services ?? powerServices)(deps);
      if (!services) {
        // Recovery owns the journal; without it nothing may be changed.
        ctx.logger.warn("lid actions need the recovery module; they are off");
        return;
      }
      const config = parseLidActionsConfig(ctx.config.lid_actions);
      const activity = trackActivity(deps.feed, deps.env.clock);
      const selfPid = options.selfPid ?? process.pid;
      const run = deps.env.run;
      const seams: LidSeams = {
        platform: deps.env.platform,
        run,
        processes: options.processes ?? createProcessLister(run),
        signal: options.signal ?? realSignaler,
        audio: options.audio ?? createOsascriptAudio(run),
        dockerIdle: options.dockerIdle ?? (() => Promise.resolve("unknown")),
        protectedState: options.protectedState ?? activity.protectedState,
        agentPids: options.agentPids ?? activity.agentPids,
        selfPid,
        uid: options.uid ?? (typeof process.getuid === "function" ? process.getuid() : -1),
        stat: options.stat ?? realStat,
        helper: services.helper,
        pendingKinds: () => services.recovery.canQuit().pending.map((p) => p.kind),
      };
      const sleep =
        options.sleep ??
        ((ms: number) => {
          const done = Promise.withResolvers<void>();
          deps.env.clock.setTimer(() => done.resolve(), ms);
          return done.promise;
        });
      const extra = new Set(config.protectedExtra);
      const actions: LidAction[] = [
        createAppNap(seams, () => config.appNapList),
        createFreezeApps(
          seams,
          () => config.freezeList,
          () => extra,
        ),
        createDockerFreeze(seams, () => extra),
        createMute(seams),
        createLowPower(seams),
        createDisplay(seams),
      ];
      const enabled = new Set<ActionId>();
      if (config.enabled) {
        const switches: Record<ActionId, boolean> = {
          display: config.display,
          freeze_apps: config.freezeApps && config.freezeList.length > 0,
          mute: config.mute,
          low_power: config.lowPower,
          docker_freeze: config.dockerFreeze,
          app_nap: config.appNap && config.appNapList.length > 0,
        };
        for (const id of ACTION_IDS) if (switches[id]) enabled.add(id);
      }
      const engine = new LidEngine({
        actions,
        enabled,
        recovery: services.recovery,
        processes: seams.processes,
        now: () => deps.env.clock.now(),
        sleep,
        emit: (type, severity, payload) => emit(r, type, severity, payload),
      });
      // Every kind is registered even when its action is off: what an earlier run left must be undone.
      for (const [kind, reverter] of Object.entries(lidReverters(actions, engine.sink))) {
        services.registerReverter(kind, reverter);
      }
      const r: Running = {
        ctx,
        deps,
        config,
        engine,
        actions,
        services,
        activity,
        seams,
        unsubscribe: [],
        timer: undefined,
        stopped: false,
      };
      running = r;
      r.unsubscribe.push(
        services.lid.onLid((state) => {
          if (state === "closed") {
            const session = deps.session.active();
            if (session) void engine.close(session.id, true);
          } else {
            void engine.open("lid_opened");
          }
        }),
      );
      try {
        const off = deps.feed?.subscribe(
          "awake.lid.session",
          ["awake.session.ended", "security.kill_switch.engaged"],
          (event) => {
            const reason = event.payload?.reason;
            if (event.event_type === "security.kill_switch.engaged")
              release(r, null, "kill_switch");
            else
              release(
                r,
                null,
                (typeof reason === "string" ? END_WHY[reason as SessionEndReason] : undefined) ??
                  "session_ended",
              );
          },
        );
        if (off) r.unsubscribe.push(off);
      } catch {
        // The timer below still notices an end of session.
      }
      arm(r);
      const onAbort = () => release(r, null, "disabled");
      if (ctx.signal.aborted) onAbort();
      else {
        ctx.signal.addEventListener("abort", onAbort, { once: true });
        r.unsubscribe.push(() => ctx.signal.removeEventListener("abort", onAbort));
      }
    },
    /**
     * Stops and undoes, and returns once the undo is done or SHUTDOWN_WAIT_MS has passed (a host
     * that awaits `shutdown()` is not held up longer). The session-end mark is written first (the
     * backstop and the next launch read it); Recovery's own shutdown also undoes.
     */
    shutdown(): Promise<void> {
      const r = stop();
      if (!r) return Promise.resolve();
      const session = r.engine.closedSession;
      if (session === null) return Promise.resolve();
      const capped = Promise.withResolvers<void>();
      const timer = r.deps.env.clock.setTimer(() => capped.resolve(), SHUTDOWN_WAIT_MS);
      const undone = r.engine.endSession(session, "shutdown").then(
        () => undefined,
        () => undefined,
      );
      return Promise.race([undone, capped.promise]).then(() => r.deps.env.clock.clearTimer(timer));
    },
  };
}

/** The instance appended to MODULES in ../index.ts. */
export const lidActionsModule: AwakeModule = createLidActionsModule();
