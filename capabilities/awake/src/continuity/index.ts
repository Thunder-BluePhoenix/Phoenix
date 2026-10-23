// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 75, agent continuity. Four extras for long agent runs, ALL OFF by default and each
// separately opt-in (config key `continuity`): network watch, hotspot failover, tmux/session
// nudge, browser throttling check. Nothing here runs unless its switch is on AND its targets
// (hosts, SSID, panes, allowed commands) were chosen by the user; every OS effect goes through
// the injected Runner / clock / feed, so tests never touch tmux, networksetup or a browser.
//
// Fawkes: `awake.network.down` shows WARNING ("Network is down") and expires by itself after
// NETWORK_DOWN_TTL_MS if the matching `awake.network.up` is lost; `awake.network.up` clears it.
// WARNING was chosen because the machine still works but the agent run is at risk; no new state.
import { join } from "node:path";
import type { CapabilityContext, CommandSpec } from "@phoenix/sdk";
import { isRecord } from "../guards";
import { AwakeError, type AwakeDeps, type AwakeModule } from "../system";
import { defaultDataDir } from "../power";
import { nodeJournalFs, type JournalFs } from "../power/journal";
import {
  CONTINUITY_CONFIG,
  parseContinuityConfig,
  type ContinuityConfig,
  type ContinuityEmit,
} from "./config";
import { HotspotController, type JoinResult, type PreviousNetworkStore } from "./hotspot";
import { PREVIOUS_NETWORK_FILE, createFilePreviousNetwork } from "./previous-network";
import { NetworkWatch, createTcpProbe, type NetworkProbe, type OutageTransition } from "./network";
import {
  NudgeController,
  SessionTarget,
  TmuxPaneTarget,
  type AgentSessionInput,
  type NudgeReport,
  type NudgeTarget,
} from "./nudge";
import { trackProtected, type ProtectedTracker } from "./protected";
import { BROWSERS, ThrottleChecker } from "./throttle";

export * from "./config";
export * from "./hotspot";
export * from "./previous-network";
export * from "./network";
export * from "./nudge";
export * from "./protected";
export * from "./throttle";

/** A lost `awake.network.up` must not leave Fawkes warning forever. */
export const NETWORK_DOWN_TTL_MS = 6 * 60 * 60_000;

export const CONTINUITY_EVENTS: readonly string[] = [
  "awake.network.down",
  "awake.network.up",
  "awake.hotspot.joined",
  "awake.hotspot.failed",
  "awake.nudge.result",
  "awake.throttle.relaunched",
];

export const HOTSPOT_SECRET = "hotspot_password";

/** Seams a test (or a host) replaces. Defaults are the real thing. */
export interface ContinuityOptions {
  probe?: NetworkProbe;
  /** Replaces the file-backed previous-network store (tests). */
  previousNetwork?: PreviousNetworkStore;
  /** The Core data directory; the previous network goes in `<dir>/awake/`. Default: `defaultDataDir()`. */
  dir?: string;
  /** File access for the previous network. Default: the real file system (0700 dir, 0600 file). */
  fs?: JournalFs;
  /** Delivers text to Phoenix-tracked agent sessions. Absent: those targets report "unavailable". */
  sessionInput?: AgentSessionInput;
  /** Existence check used to find tmux in TMUX_PATHS. Default: the real filesystem. */
  fileExists?: (path: string) => boolean;
  /** Overrides the event-feed-based protected check. */
  isProtected?: () => boolean;
}

/** What the last network outage looked like. Ids and counts only. */
export interface OutageRecord {
  started_at: string;
  ended_at: string | null;
  hotspot: "not_tried" | "joined" | "failed" | "skipped";
  nudged: number;
}

/** What `continuity.status` answers. Counts and flags only; never a pane command, text or password. */
export interface ContinuityStatus {
  network_watch: { enabled: boolean; hosts: number; down: boolean };
  hotspot: {
    enabled: boolean;
    ssid_set: boolean;
    password_argv_allowed: boolean;
    password_saved: boolean;
    previous_network_saved: boolean;
  };
  nudge: {
    enabled: boolean;
    after_seconds: number;
    panes: number;
    sessions: number;
    enter: boolean;
    allowed_commands: number;
  };
  throttle_check: { enabled: boolean };
  ignored_config_entries: number;
  last_outage: OutageRecord | null;
}

interface Running {
  ctx: CapabilityContext;
  deps: AwakeDeps;
  config: ContinuityConfig;
  emit: ContinuityEmit;
  watch: NetworkWatch | undefined;
  nudge: NudgeController | undefined;
  hotspot: HotspotController;
  previous: PreviousNetworkStore;
  throttle: ThrottleChecker;
  tracker: ProtectedTracker;
  outage: OutageRecord | null;
}

const NO_INPUT_SCHEMA = { type: "object", additionalProperties: false, properties: {} } as const;

function noInput(input: unknown): void {
  if (input === undefined) return;
  if (!isRecord(input) || Object.keys(input).length > 0) {
    throw new AwakeError("invalid", "this command takes no input");
  }
}

const COMMAND_SPECS: CommandSpec[] = [
  {
    name: "continuity.status",
    description:
      "Which agent-continuity extras are on and the last network outage. Read-only; never includes the hotspot password.",
    side_effect: "read",
    input_schema: NO_INPUT_SCHEMA,
  },
  {
    name: "hotspot.join_now",
    description:
      "Join the iPhone hotspot you chose, now. Needs hotspot failover turned on. Changes which Wi-Fi network this Mac uses. If you allowed the saved password to be used, it is passed to macOS on a command line that other programs on this Mac can read for that moment. Asks for confirmation every time.",
    side_effect: "execute",
    permissions: ["shell_command"],
    timeout_ms: 90_000,
    input_schema: NO_INPUT_SCHEMA,
  },
  {
    name: "hotspot.rejoin_previous",
    description:
      "Rejoin the Wi-Fi network this Mac was on before Phoenix joined the hotspot. Asks for confirmation every time.",
    side_effect: "execute",
    permissions: ["shell_command"],
    timeout_ms: 90_000,
    input_schema: NO_INPUT_SCHEMA,
  },
  {
    name: "throttle.status",
    description:
      "Which Chromium-based browsers (Chrome, Arc, Comet, Edge, Brave) are running with background throttling on. Read-only: it only reports and never changes a browser.",
    side_effect: "read",
    permissions: ["shell_command"],
    input_schema: NO_INPUT_SCHEMA,
  },
  {
    name: "throttle.relaunch",
    description:
      "Quit one browser and reopen it with background throttling switched off. The browser's tabs reload and unsaved page content may be lost. Refused during a meeting or dictation. Asks for confirmation every time.",
    side_effect: "execute",
    permissions: ["shell_command"],
    timeout_ms: 60_000,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["bundle_id"],
      properties: { bundle_id: { type: "string", enum: BROWSERS.map((b) => b.bundleId) } },
    },
  },
];

/** The continuity module. Create one per capability instance; tests build their own. */
export function createContinuityModule(options: ContinuityOptions = {}): AwakeModule {
  let running: Running | undefined;

  const need = (): Running => {
    if (!running) throw new AwakeError("unavailable", "The awake capability is not running");
    return running;
  };

  function stop(): void {
    const r = running;
    running = undefined;
    if (!r) return;
    r.watch?.stop();
    r.nudge?.stop();
    r.tracker.stop();
  }

  function onNudgeReport(r: Running, report: NudgeReport): void {
    if (r.outage) r.outage.nudged += report.outcome === "sent" ? 1 : 0;
    // Audit record: the pane / session id and the outcome. Never the text sent, never output.
    r.emit("awake.nudge.result", report.outcome === "sent" ? "info" : "warning", {
      target: report.target,
      kind: report.kind,
      outcome: report.outcome,
    });
  }

  function reportJoin(r: Running, result: JoinResult): void {
    if (result.joined) {
      r.emit("awake.hotspot.joined", "info", {
        mode: result.mode,
        already: result.already,
        previous_saved: r.previous.get() !== null,
      });
    } else {
      r.emit("awake.hotspot.failed", "warning", { reason: result.reason });
    }
  }

  async function autoJoin(r: Running): Promise<void> {
    if (r.outage === null) return;
    // Automatic join: feature on, a keep-awake session is active, an outage is confirmed.
    if (!r.config.hotspot.enabled || r.deps.session.active() === null) {
      r.outage.hotspot = "skipped";
      return;
    }
    const result = await r.hotspot.join();
    r.outage.hotspot = result.joined ? "joined" : "failed";
    reportJoin(r, result);
  }

  function onTransition(r: Running, t: OutageTransition): void {
    if (t.kind === "down") {
      r.outage = {
        started_at: new Date(t.failingSince).toISOString(),
        ended_at: null,
        hotspot: "not_tried",
        nudged: 0,
      };
      r.emit("awake.network.down", "warning", { since: r.outage.started_at });
      r.nudge?.onDown(t.failingSince);
      void autoJoin(r).catch(() => {
        if (r.outage) r.outage.hotspot = "failed";
      });
    } else {
      if (r.outage) r.outage.ended_at = new Date(t.at).toISOString();
      r.nudge?.onUp();
      r.emit("awake.network.up", "info", { outage_seconds: Math.round(t.outageMs / 1000) });
    }
  }

  return {
    events: [...CONTINUITY_EVENTS],
    permissions: ["network"],
    secrets: [
      {
        name: HOTSPOT_SECRET,
        description:
          "Password of the iPhone hotspot. Used only if you allow it in the hotspot settings. macOS takes it on a command line that other programs on this Mac can read for a moment.",
      },
    ],
    stateRules: [
      {
        match: "awake.network.down",
        group: "awake.network",
        effect: { state: "WARNING", explain: "Network is down", ttlMs: NETWORK_DOWN_TTL_MS },
      },
      { match: "awake.network.up", group: "awake.network", effect: { clear: true } },
    ],
    configProperties: CONTINUITY_CONFIG,
    commandSpecs: COMMAND_SPECS,
    commands: {
      async "continuity.status"(input): Promise<ContinuityStatus> {
        noInput(input);
        const r = need();
        const c = r.config;
        return {
          network_watch: {
            enabled: c.network.enabled,
            hosts: c.network.hosts.length,
            down: r.watch?.detector.down ?? false,
          },
          hotspot: {
            enabled: c.hotspot.enabled,
            ssid_set: c.hotspot.ssid !== null,
            password_argv_allowed: c.hotspot.allowPasswordArgv,
            password_saved: (await r.ctx.secret(HOTSPOT_SECRET)) !== undefined,
            previous_network_saved: r.previous.get() !== null,
          },
          nudge: {
            enabled: c.nudge.enabled,
            after_seconds: c.nudge.afterSeconds,
            panes: c.nudge.panes.length,
            sessions: c.nudge.sessions.length,
            enter: c.nudge.enter,
            allowed_commands: c.nudge.allowedCommands.length,
          },
          throttle_check: { enabled: c.throttle.enabled },
          ignored_config_entries: c.dropped,
          last_outage: r.outage,
        };
      },
      async "hotspot.join_now"(input) {
        noInput(input);
        const r = need();
        if (!r.config.hotspot.enabled) {
          throw new AwakeError("unavailable", "Hotspot failover is turned off");
        }
        const result = await r.hotspot.join();
        reportJoin(r, result);
        return result;
      },
      async "hotspot.rejoin_previous"(input) {
        noInput(input);
        const r = need();
        if (!r.config.hotspot.enabled) {
          throw new AwakeError("unavailable", "Hotspot failover is turned off");
        }
        const result = await r.hotspot.rejoinPrevious();
        reportJoin(r, result);
        return result;
      },
      async "throttle.status"(input) {
        noInput(input);
        const r = need();
        if (!r.config.throttle.enabled) return { enabled: false, browsers: [] };
        if (r.deps.env.platform !== "darwin") {
          return { enabled: true, supported: false, browsers: [] };
        }
        const browsers = await r.throttle.status();
        if (browsers === null)
          throw new AwakeError("unavailable", "Could not list running programs");
        return { enabled: true, supported: true, browsers };
      },
      async "throttle.relaunch"(input) {
        const r = need();
        if (!isRecord(input) || typeof input.bundle_id !== "string") {
          throw new AwakeError("invalid", "bundle_id is required");
        }
        if (!r.config.throttle.enabled) {
          throw new AwakeError("unavailable", "The browser throttling check is turned off");
        }
        if (r.deps.env.platform !== "darwin") {
          throw new AwakeError("unavailable", "Relaunching a browser is only supported on macOS");
        }
        const result = await r.throttle.relaunch(input.bundle_id);
        if (result.relaunched) {
          r.emit("awake.throttle.relaunched", "info", { bundle_id: result.bundle_id });
        }
        return result;
      },
    },
    init(ctx, deps) {
      stop();
      const config = parseContinuityConfig(ctx.config.continuity);
      const emit: ContinuityEmit = (type, severity, payload) => {
        const published = ctx.emit({ event_type: type, severity, subject: "Network", payload });
        if (!published.ok) ctx.logger.warn("continuity event not published", { type });
      };
      const tracker = trackProtected(deps.feed, deps.env.clock);
      const isProtected = options.isProtected ?? tracker.isProtected;
      const run = deps.env.run;
      const previous =
        options.previousNetwork ??
        createFilePreviousNetwork({
          path: join(options.dir ?? defaultDataDir(), "awake", PREVIOUS_NETWORK_FILE),
          fs: options.fs ?? nodeJournalFs,
          now: () => deps.env.clock.now(),
          onError: (reason) => ctx.logger.warn("previous network not persisted", { reason }),
        });
      // The user turned hotspot use off: whatever was remembered for it goes with it.
      if (!config.hotspot.enabled) previous.clear();
      const hotspot = new HotspotController({
        run,
        platform: deps.env.platform,
        ssid: config.hotspot.ssid,
        allowPasswordArgv: config.hotspot.allowPasswordArgv,
        secret: () => ctx.secret(HOTSPOT_SECRET),
        store: previous,
        now: () => deps.env.clock.now(),
      });
      const throttle = new ThrottleChecker({
        run,
        isProtected: () => isProtected(),
        sleep(ms) {
          const done = Promise.withResolvers<void>();
          deps.env.clock.setTimer(() => done.resolve(), ms);
          return done.promise;
        },
      });
      const r: Running = {
        ctx,
        deps,
        config,
        emit,
        watch: undefined,
        nudge: undefined,
        hotspot,
        previous,
        throttle,
        tracker,
        outage: null,
      };
      running = r;

      const targets: NudgeTarget[] = [];
      if (config.nudge.enabled) {
        const allowed = new Set(config.nudge.allowedCommands);
        for (const pane of config.nudge.panes) {
          targets.push(new TmuxPaneTarget(pane, run, allowed, options.fileExists));
        }
        for (const id of config.nudge.sessions)
          targets.push(new SessionTarget(id, options.sessionInput));
        if (targets.length > 0) {
          r.nudge = new NudgeController({
            clock: deps.env.clock,
            targets,
            afterMs: config.nudge.afterSeconds * 1000,
            enter: config.nudge.enter,
            isProtected,
            onReport: (report) => onNudgeReport(r, report),
          });
        }
      }

      // The outage detector is shared: hotspot failover and the nudge both key off it.
      const wantsDetector = config.network.enabled && config.network.hosts.length > 0;
      if (wantsDetector) {
        r.watch = new NetworkWatch({
          clock: deps.env.clock,
          probe: options.probe ?? createTcpProbe(),
          hosts: config.network.hosts,
          intervalMs: config.network.intervalSeconds * 1000,
          failuresRequired: config.network.failuresRequired,
          onTransition: (t) => onTransition(r, t),
        });
        r.watch.start();
      }
    },
    shutdown: stop,
  };
}

/** The instance appended to MODULES in ../index.ts. */
export const continuityModule: AwakeModule = createContinuityModule();
