// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FetchLike } from "@phoenix/ai-models";
import {
  generateSessionToken,
  type DemoApi,
  type DemoStartView,
  type DemoStatusView,
  type DemoStepView,
} from "@phoenix/api";
import { HookInstaller, type GitExec, type TerminalFocuser } from "@phoenix/capability-agents";
import { mockCapability } from "@phoenix/capability-mock";
import type { PhoenixConfig } from "@phoenix/config";
import type { EventBus } from "@phoenix/event-bus";
import type { Logger } from "@phoenix/logging";
import { MemorySecretStore } from "@phoenix/persistence";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import type { PhoenixRuntime, RuntimeOptions } from "./runtime";
import type { SyncTransportFactory } from "./sync";

/**
 * Every caption the walkthrough shows, keyed by a stable id. The i18n pass translates this one
 * table; nothing else in the demo carries user-facing walkthrough text.
 */
export const DEMO_CAPTION_IDS = [
  "demo.build-pass",
  "demo.build-fail",
  "demo.tests",
  "demo.agent-waiting",
  "demo.agent-done",
  "demo.deploy",
  "demo.deploy-fail",
  "demo.meeting",
  "demo.frappe-down",
  "demo.merge-conflict",
] as const;
export type DemoCaptionId = (typeof DEMO_CAPTION_IDS)[number];

export const DEMO_CAPTIONS: Readonly<Record<DemoCaptionId, string>> = {
  "demo.build-pass":
    "A build runs and passes. Fawkes works while it runs, then celebrates. Nothing here is real.",
  "demo.build-fail":
    "A build fails. Fawkes shows the error and keeps it on screen until you acknowledge it.",
  "demo.tests": "Tests run and pass. Fawkes shows the work and clears it when it is done.",
  "demo.agent-waiting":
    "A coding agent works, then needs you. Fawkes waits and tells you what it is waiting for.",
  "demo.agent-done": "A coding agent finishes. Fawkes marks the task complete.",
  "demo.deploy": "A staging deployment makes progress. Fawkes follows it step by step.",
  "demo.deploy-fail": "A production deployment fails. Fawkes raises it as an error right away.",
  "demo.meeting":
    "A meeting is recorded, transcribed and summarised. Fawkes shows the recording indicator while it lasts.",
  "demo.frappe-down": "A Frappe site goes down, then recovers. Fawkes warns you and clears it.",
  "demo.merge-conflict":
    "A merge conflict appears and is resolved. Fawkes warns you, then the commit lands.",
};

interface DemoStepDef {
  /** A scenario of the mock capability (`simulate`); its events live in sdk/events/src/scenarios.ts. */
  scenario: string;
  caption_id: DemoCaptionId;
  /** Hash route the web app shows while it plays (only views that work with the mock capability alone). */
  route: string;
}

/** The walkthrough, in order. A scenario added to the SDK fails the demo test until it is listed here. */
export const DEMO_STEP_DEFS: readonly DemoStepDef[] = [
  { scenario: "build-pass", caption_id: "demo.build-pass", route: "/panel/overview" },
  { scenario: "build-fail", caption_id: "demo.build-fail", route: "/panel/activity" },
  { scenario: "tests", caption_id: "demo.tests", route: "/panel/overview" },
  { scenario: "agent-waiting", caption_id: "demo.agent-waiting", route: "/panel/overview" },
  { scenario: "agent-done", caption_id: "demo.agent-done", route: "/panel/activity" },
  { scenario: "deploy", caption_id: "demo.deploy", route: "/panel/overview" },
  { scenario: "deploy-fail", caption_id: "demo.deploy-fail", route: "/panel/activity" },
  { scenario: "meeting", caption_id: "demo.meeting", route: "/panel/overview" },
  { scenario: "frappe-down", caption_id: "demo.frappe-down", route: "/panel/overview" },
  { scenario: "merge-conflict", caption_id: "demo.merge-conflict", route: "/panel/activity" },
];

export function demoSteps(): DemoStepView[] {
  return DEMO_STEP_DEFS.map((s) => ({ ...s, caption: DEMO_CAPTIONS[s.caption_id] }));
}

/** The scenario names the mock capability accepts, read from its manifest (not copied). */
export function mockScenarioNames(): string[] {
  const simulate = mockCapability.manifest.commands.find((c) => c.name === "simulate");
  const props = simulate?.input_schema?.properties as
    { scenario?: { enum?: string[] } } | undefined;
  return props?.scenario?.enum ?? [];
}

export const DEMO_IDLE_LIMIT_MS = 10 * 60_000;

/** A scheduled idle check that can be cancelled. */
export interface IdleTimer {
  cancel(): void;
}
export type ScheduleIdle = (run: () => void, ms: number) => IdleTimer;

export const realIdleTimer: ScheduleIdle = (run, ms) => {
  const handle = setTimeout(run, ms);
  handle.unref();
  return { cancel: () => clearTimeout(handle) };
};

/** What a host or a test may tune; the defaults are what ships. */
export interface DemoTuning {
  /** Stop the demo when no scenario event was seen for this long. */
  idleLimitMs?: number;
  /** Timer behind the idle limit (tests inject one they fire by hand). */
  schedule?: ScheduleIdle;
  /** Playback speed of the mock capability (1 = the scenarios' own timing). */
  speed?: number;
}

export interface DemoDeps extends DemoTuning {
  /** The real Core's config: the demo copies its limits and allowed browser origins. */
  config: PhoenixConfig;
  logger: Logger;
  /** The REAL emergency stop. The demo never shares it; it only refuses to start while it is engaged. */
  killSwitchEngaged: () => boolean;
  /** The real bus, read only to end the demo the moment the real emergency stop is engaged. */
  bus: Pick<EventBus, "subscribe">;
  /** Builds the second runtime (a parameter so this module does not import the runtime class). */
  createRuntime: (options: RuntimeOptions) => PhoenixRuntime;
}

/** The demo has no network: a provider call would reach a real service. */
const refuseNetwork: FetchLike = () =>
  Promise.reject(new Error("Demo mode makes no network requests"));

/** Sync would send (encrypted) data to a relay over the network; the demo has none. */
const refuseSyncTransport: SyncTransportFactory = () => ({
  list: () => Promise.reject(new Error("Demo mode makes no network requests")),
  put: () => Promise.reject(new Error("Demo mode makes no network requests")),
});

const refuseGit: GitExec = () => Promise.reject(new Error("Demo mode does not run git"));

const refuseTerminal: TerminalFocuser = {
  platform: process.platform,
  focus: () => Promise.reject(new Error("Demo mode does not control terminal windows")),
};

/**
 * A hook installer over a home directory that does not exist (and is never created) with an empty
 * environment: no agent is "detected", so install/repair refuse before writing and uninstall has
 * nothing to remove. The real one would edit the user's real agent settings.
 */
function inertInstaller(): HookInstaller {
  const root = join(tmpdir(), `phoenix-demo-${randomUUID()}`);
  return new HookInstaller({ home: join(root, "home"), env: {}, backupDir: join(root, "backups") });
}

interface ActiveDemo {
  runtime: PhoenixRuntime;
  idle: IdleTimer;
  release: () => void;
}

/**
 * Demo mode (Phase 70): a scripted walkthrough that writes nothing and leaves the real state alone.
 *
 * It runs a SECOND PhoenixRuntime that shares nothing with this one: an in-memory database, its own
 * memory-only secret store, no session-token file, no agent relay socket, no network, its own event
 * bus, permission gateway and emergency stop, its own random session token and an ephemeral loopback
 * port. Only the mock capability exists in it. `start` hands the caller that second token; that is
 * acceptable only because the runtime behind it holds nothing real and is thrown away on `stop`.
 */
export class DemoRuntime implements DemoApi {
  private active: ActiveDemo | null = null;
  private startup: Promise<DemoStartView> | null = null;
  private readonly idleLimitMs: number;
  private readonly schedule: ScheduleIdle;

  constructor(private readonly d: DemoDeps) {
    this.idleLimitMs = d.idleLimitMs ?? DEMO_IDLE_LIMIT_MS;
    this.schedule = d.schedule ?? realIdleTimer;
  }

  async start(origin: string | undefined): Promise<DemoStartView> {
    if (this.d.killSwitchEngaged()) {
      throw new PhoenixError(
        ErrorCode.SECURITY_POLICY_BLOCKED,
        "Emergency stop is engaged; the demo will not start",
      );
    }
    if (this.active || this.startup) {
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        "A demo is already running; stop it before starting another",
      );
    }
    const startup = this.launch(origin);
    this.startup = startup;
    try {
      return await startup;
    } finally {
      this.startup = null;
    }
  }

  async stop(): Promise<{ stopped: boolean }> {
    // A stop that arrives while the demo is still starting waits for it, then ends it.
    await this.startup?.catch(() => undefined);
    const active = this.active;
    if (!active) return { stopped: false };
    active.idle.cancel();
    active.release();
    try {
      await active.runtime.stop();
    } finally {
      if (this.active === active) this.active = null;
    }
    return { stopped: true };
  }

  status(): DemoStatusView {
    return {
      running: this.active !== null,
      step_count: DEMO_STEP_DEFS.length,
      idle_limit_ms: this.idleLimitMs,
    };
  }

  private async launch(origin: string | undefined): Promise<DemoStartView> {
    const token = generateSessionToken();
    const { allowedOrigins } = this.d.config;
    const runtime = this.d.createRuntime({
      config: {
        ...this.d.config,
        env: "dev",
        host: "127.0.0.1",
        port: 0,
        allowRemote: false,
        // The page that asked was already accepted by the real Core; the demo Core must accept it too.
        allowedOrigins:
          origin !== undefined && URL.canParse(origin)
            ? [...allowedOrigins, origin]
            : [...allowedOrigins],
        webRoot: undefined,
        // A path that is never created: nothing in the demo can read or write the real data folder.
        dataDir: join(tmpdir(), `phoenix-demo-${randomUUID()}`, "data"),
      },
      logger: this.d.logger,
      databasePath: ":memory:",
      token,
      writeTokenFile: false,
      secrets: new MemorySecretStore(),
      capabilities: [mockCapability],
      fetch: refuseNetwork,
      syncTransport: refuseSyncTransport,
      gitExec: refuseGit,
      terminalFocuser: refuseTerminal,
      installer: inertInstaller(),
      startAgentRelay: false,
      demo: false,
    });
    const releases: (() => void)[] = [];
    try {
      const address = await runtime.start();
      runtime.capabilities.configure("mock", { speed: this.d.speed ?? 1 });
      await runtime.capabilities.enable("mock", "demo");
      // A scenario playing is the activity that keeps the demo alive.
      releases.push(
        runtime.bus.subscribe("demo-activity", "*", (event, info) => {
          if (!info.ephemeral && event.source === "mock") this.touch();
        }),
        // The real emergency stop ends the demo too.
        this.d.bus.subscribe("demo-kill-switch", "security.kill_switch.engaged", () =>
          this.stop().then(() => undefined),
        ),
      );
      this.active = {
        runtime,
        idle: this.arm(),
        release: () => {
          for (const release of releases.splice(0)) release();
        },
      };
      return { url: `http://${address.host}:${address.port}`, token, steps: demoSteps() };
    } catch (err) {
      for (const release of releases.splice(0)) release();
      await runtime.stop().catch((stopErr: unknown) => {
        this.d.logger.warn("demo runtime did not stop cleanly", { error: String(stopErr) });
      });
      throw err;
    }
  }

  private arm(): IdleTimer {
    return this.schedule(() => {
      this.d.logger.info("demo stopped after being idle");
      void this.stop().catch((err: unknown) => {
        this.d.logger.warn("demo idle stop failed", { error: String(err) });
      });
    }, this.idleLimitMs);
  }

  private touch(): void {
    const active = this.active;
    if (!active) return;
    active.idle.cancel();
    active.idle = this.arm();
  }
}
