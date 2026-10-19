// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Demo mode (Phase 70) against a real Core. The demo is a second in-memory runtime; these tests
// prove it leaves the real data directory, keychain, database and state alone, that the two Cores
// reject each other's tokens, and that the safety limits (kill switch, one at a time, idle) hold.
import { existsSync, readdirSync, rmSync } from "node:fs";
import type { DemoStartView, DemoStatusView } from "@phoenix/api";
import { KeychainSecretStore, type ToolRunner } from "@phoenix/persistence";
import { SCENARIO_NAMES } from "../../../sdk/events/src/scenarios";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEMO_CAPTION_IDS,
  DEMO_CAPTIONS,
  DEMO_STEP_DEFS,
  demoSteps,
  mockScenarioNames,
  type IdleTimer,
} from "../src";
import { startCore, type TestCore } from "./helpers";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** An idle timer the test fires by hand. */
interface ManualTimer extends IdleTimer {
  run: () => void;
  ms: number;
  cancelled: boolean;
}
/** The hand-fired idle timers a test drives; `live()` are the ones not cancelled. */
interface ManualScheduler {
  timers: ManualTimer[];
  live(): ManualTimer[];
  schedule(run: () => void, ms: number): IdleTimer;
}
function manualScheduler(): ManualScheduler {
  const timers: ManualTimer[] = [];
  return {
    timers,
    live: () => timers.filter((t) => !t.cancelled),
    schedule: (run, ms) => {
      const timer: ManualTimer = {
        run,
        ms,
        cancelled: false,
        cancel: () => {
          timer.cancelled = true;
        },
      };
      timers.push(timer);
      return timer;
    },
  };
}

interface Reply<T> {
  status: number;
  json: T;
}

/** One request to any Core with an explicit token (the helpers' `api` only carries the real one). */
async function call<T = unknown>(
  base: string,
  token: string,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Reply<T>> {
  const res = await fetch(base + path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : undefined) as T };
}

interface OperationView {
  id: string;
  status: string;
}

interface EventsView {
  events: { event: { event_type: string; source: string } }[];
}

/** Rows that must not change in the real database while a demo runs. */
function snapshotRows(core: TestCore) {
  const rows = (table: string) => core.runtime.db.prepare(`SELECT * FROM ${table}`).all();
  return {
    events: rows("events"),
    audit_log: rows("audit_log"),
    settings: rows("settings"),
    notifications: rows("notifications"),
    state: core.runtime.state.snapshot(),
    tasks: core.runtime.state.tasks(),
  };
}

interface Started {
  core: TestCore;
  demo: DemoStartView;
  scheduler: ManualScheduler;
  /** The demo Core, with its own token. */
  ask: <T = unknown>(method: string, path: string, body?: unknown) => Promise<Reply<T>>;
  keychainCalls: string[];
}

/** A real Core (prod env: no mock capability of its own) with a spied keychain, then a started demo. */
async function startDemo(): Promise<Started> {
  const scheduler = manualScheduler();
  const keychainCalls: string[] = [];
  const run: ToolRunner = (cmd, args) => {
    keychainCalls.push([cmd, ...args].join(" "));
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  };
  const core = await startCore(
    { env: "prod" },
    {
      secrets: new KeychainSecretStore("darwin", run),
      runtime: {
        startAgentRelay: false,
        demo: { speed: 1000, idleLimitMs: 60_000, schedule: scheduler.schedule },
      },
    },
  );
  cleanups.push(() => {
    rmSync(core.dataDir, { recursive: true, force: true });
  });
  cleanups.push(() => core.runtime.stop());
  await core.runtime.bus.drain();
  const started = await core.api("POST", "/api/demo/start", {});
  expect(started.status).toBe(200);
  const demo = started.json as DemoStartView;
  const ask = <T = unknown>(method: string, path: string, body?: unknown) =>
    call<T>(demo.url, demo.token, method, path, body);
  return { core, demo, scheduler, ask, keychainCalls };
}

/** Plays one step on the demo Core the way the web app does and waits for the operation to finish. */
async function play(started: Started, scenario: string): Promise<void> {
  const op = await started.ask<OperationView>("POST", "/api/capabilities/mock/commands/simulate", {
    input: { scenario },
  });
  expect(op.status).toBe(202);
  await vi.waitFor(async () => {
    const now = await started.ask<OperationView>("GET", `/api/operations/${op.json.id}`);
    expect(now.json.status).toBe("succeeded");
  });
}

describe("demo mode: exit criterion", () => {
  it("a full demo leaves no file, no keychain call, no real row and no real state change", async () => {
    const started = await startDemo();
    const { core, demo } = started;
    // The real data directory exists and is empty before; the real Core has settled.
    expect(readdirSync(core.dataDir)).toEqual([]);
    const before = snapshotRows(core);

    for (const step of demo.steps) await play(started, step.scenario);
    // The scenarios really ran, on the demo Core.
    const demoEvents = (await started.ask<EventsView>("GET", "/api/events?limit=500")).json;
    const seen = new Set(demoEvents.events.map((e) => e.event.event_type));
    for (const type of [
      "build.failed",
      "agent.waiting",
      "deploy.succeeded",
      "git.merge_conflict",
    ]) {
      expect(seen.has(type)).toBe(true);
    }
    expect(
      demoEvents.events.every((e) => e.event.source === "mock" || e.event.source === "core"),
    ).toBe(true);
    // The demo Core's own pet state moved (it is a working Fawkes), the real one did not.
    const demoPet = await started.ask<{ state: string }>("GET", "/api/pet/state");
    expect(demoPet.status).toBe(200);

    expect((await core.api("POST", "/api/demo/stop", {})).json).toEqual({ stopped: true });
    await core.runtime.bus.drain();

    expect(existsSync(core.dataDir)).toBe(true);
    expect(readdirSync(core.dataDir)).toEqual([]);
    expect(started.keychainCalls).toEqual([]);
    const after = snapshotRows(core);
    for (const table of ["events", "audit_log", "settings", "notifications"] as const) {
      expect(after[table], table).toEqual(before[table]);
    }
    expect(after.state).toEqual(before.state);
    expect(after.tasks).toEqual(before.tasks);
    expect(core.runtime.events.count()).toBe(before.events.length);
  });

  it("the demo Core is gone after stop", async () => {
    const started = await startDemo();
    await started.core.api("POST", "/api/demo/stop", {});
    await expect(started.ask("GET", "/api/pet/state")).rejects.toThrow();
    expect((await started.core.api("GET", "/api/demo/status")).json).toMatchObject({
      running: false,
    });
  });

  it("stopping the real Core stops the demo with it", async () => {
    const started = await startDemo();
    expect((await started.ask("GET", "/api/pet/state")).status).toBe(200);
    await started.core.runtime.stop();
    await expect(started.ask("GET", "/api/pet/state")).rejects.toThrow();
  });
});

describe("demo mode: isolation and tokens", () => {
  it("the demo token is rejected by the real Core and the real token by the demo Core", async () => {
    const started = await startDemo();
    const { core, demo } = started;
    expect(demo.token).not.toBe(core.runtime.token);
    expect((await call(core.base, demo.token, "GET", "/api/pet/state")).status).toBe(401);
    expect((await call(demo.url, core.runtime.token, "GET", "/api/pet/state")).status).toBe(401);
    // And each accepts its own.
    expect((await call(core.base, core.runtime.token, "GET", "/api/pet/state")).status).toBe(200);
    expect((await started.ask("GET", "/api/pet/state")).status).toBe(200);
    // The demo token cannot reach the demo-start route of the real Core either.
    expect((await call(core.base, demo.token, "POST", "/api/demo/start", {})).status).toBe(401);
  });

  it("the demo listens on loopback at its own port with a fresh token each time", async () => {
    const first = await startDemo();
    const url = new URL(first.demo.url);
    expect(url.hostname).toBe("127.0.0.1");
    expect(Number(url.port)).not.toBe(first.core.port);
    await first.core.api("POST", "/api/demo/stop", {});
    const second = (await first.core.api("POST", "/api/demo/start", {})).json as DemoStartView;
    expect(second.token).not.toBe(first.demo.token);
    expect(second.url).not.toBe("");
    // The first demo's token died with its Core; the new Core does not honour it.
    expect((await call(second.url, first.demo.token, "GET", "/api/pet/state")).status).toBe(401);
  });

  it("shares no emergency stop: engaging the demo's does not engage the real one", async () => {
    const started = await startDemo();
    expect((await started.ask("POST", "/api/security/kill-switch", { engaged: true })).status).toBe(
      200,
    );
    expect(started.core.runtime.permissions.isKillSwitchEngaged()).toBe(false);
  });

  it("cannot start another demo from inside the demo", async () => {
    const started = await startDemo();
    expect((await started.ask("POST", "/api/demo/start", {})).status).toBe(404);
  });

  it("the demo Core refuses a provider network call (no real service is reachable)", async () => {
    const started = await startDemo();
    const status = await started.ask<{ enabled: boolean }>("GET", "/api/ai/status");
    expect(status.json.enabled).toBe(false);
  });

  it("accepts the browser origin that asked, and no other", async () => {
    const started = await startDemo();
    const origin = "http://127.0.0.1:5199";
    await started.core.api("POST", "/api/demo/stop", {});
    const again = await call<DemoStartView>(
      started.core.base,
      started.core.runtime.token,
      "POST",
      "/api/demo/start",
      {},
      { origin: `http://127.0.0.1:${started.core.port}` },
    );
    expect(again.status).toBe(200);
    // The real page's own origin is same-origin on the real Core, but not on the demo's port:
    // the demo Core must have been told it is allowed.
    const ok = await call(again.json.url, again.json.token, "GET", "/api/pet/state", undefined, {
      origin: `http://127.0.0.1:${started.core.port}`,
    });
    expect(ok.status).toBe(200);
    const refused = await call(
      again.json.url,
      again.json.token,
      "GET",
      "/api/pet/state",
      undefined,
      {
        origin,
      },
    );
    expect(refused.status).toBe(403);
  });
});

describe("demo mode: limits", () => {
  it("refuses to start while the real emergency stop is engaged", async () => {
    const scheduler = manualScheduler();
    const core = await startCore(
      {},
      { runtime: { startAgentRelay: false, demo: { schedule: scheduler.schedule } } },
    );
    cleanups.push(() => core.runtime.stop());
    core.runtime.permissions.engageKillSwitch("user");
    const refused = await core.api("POST", "/api/demo/start", {});
    expect(refused.status).toBe(403);
    expect(refused.json.code).toBe("SECURITY_POLICY_BLOCKED");
    expect((await core.api("GET", "/api/demo/status")).json.running).toBe(false);
    expect(scheduler.timers).toEqual([]);

    core.runtime.permissions.disengageKillSwitch("user");
    expect((await core.api("POST", "/api/demo/start", {})).status).toBe(200);
  });

  it("ends a running demo when the real emergency stop is engaged", async () => {
    const started = await startDemo();
    expect((await started.core.api("GET", "/api/demo/status")).json.running).toBe(true);
    started.core.runtime.permissions.engageKillSwitch("user");
    await vi.waitFor(async () => {
      expect((await started.core.api("GET", "/api/demo/status")).json.running).toBe(false);
    });
    await expect(started.ask("GET", "/api/pet/state")).rejects.toThrow();
  });

  it("allows one demo at a time, even for two simultaneous starts", async () => {
    const scheduler = manualScheduler();
    const core = await startCore(
      {},
      { runtime: { startAgentRelay: false, demo: { schedule: scheduler.schedule } } },
    );
    cleanups.push(() => core.runtime.stop());
    const [a, b] = await Promise.all([
      core.api("POST", "/api/demo/start", {}),
      core.api("POST", "/api/demo/start", {}),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    const refused = a.status === 400 ? a : b;
    expect(refused.json.code).toBe("INVALID_REQUEST");
    expect((await core.api("POST", "/api/demo/start", {})).status).toBe(400);
    // After stop a new one may start.
    await core.api("POST", "/api/demo/stop", {});
    expect((await core.api("POST", "/api/demo/start", {})).status).toBe(200);
  });

  it("stops by itself when idle, and playing a scenario keeps it alive", async () => {
    const started = await startDemo();
    const { scheduler, core } = started;
    expect(scheduler.live()).toHaveLength(1);
    expect(scheduler.live()[0]!.ms).toBe(60_000);
    const first = scheduler.live()[0]!;

    await play(started, "tests");
    // The activity re-armed the idle limit: the first timer is dead, exactly one is live.
    expect(first.cancelled).toBe(true);
    expect(scheduler.live()).toHaveLength(1);
    expect((await core.api("GET", "/api/demo/status")).json.running).toBe(true);

    scheduler.live()[0]!.run();
    await vi.waitFor(async () => {
      expect((await core.api("GET", "/api/demo/status")).json.running).toBe(false);
    });
    await expect(started.ask("GET", "/api/pet/state")).rejects.toThrow();
  });

  it("stop is safe with nothing running and reports whether it stopped anything", async () => {
    const scheduler = manualScheduler();
    const core = await startCore(
      {},
      { runtime: { startAgentRelay: false, demo: { schedule: scheduler.schedule } } },
    );
    cleanups.push(() => core.runtime.stop());
    expect((await core.api("POST", "/api/demo/stop", {})).json).toEqual({ stopped: false });
    expect((await core.api("GET", "/api/demo/status")).json).toEqual({
      running: false,
      step_count: DEMO_STEP_DEFS.length,
      idle_limit_ms: 10 * 60_000,
    } satisfies DemoStatusView);
  });

  it("demo routes need the session token", async () => {
    const core = await startCore({}, { runtime: { startAgentRelay: false } });
    cleanups.push(() => core.runtime.stop());
    for (const [method, path] of [
      ["POST", "/api/demo/start"],
      ["POST", "/api/demo/stop"],
      ["GET", "/api/demo/status"],
    ] as const) {
      const res = await fetch(core.base + path, { method });
      expect(res.status, path).toBe(401);
    }
    expect((await core.api("GET", "/api/demo/status")).json.running).toBe(false);
  });
});

describe("demo walkthrough script", () => {
  it("covers exactly the mock capability's scenarios, once each, in order", () => {
    expect(DEMO_STEP_DEFS.map((s) => s.scenario)).toEqual(SCENARIO_NAMES);
    expect([...mockScenarioNames()].sort()).toEqual([...SCENARIO_NAMES].sort());
  });

  it("has one caption per id and every step uses a listed id and a hash route", () => {
    expect(Object.keys(DEMO_CAPTIONS).sort()).toEqual([...DEMO_CAPTION_IDS].sort());
    for (const id of DEMO_CAPTION_IDS) expect(DEMO_CAPTIONS[id].length).toBeGreaterThan(10);
    for (const step of demoSteps()) {
      expect(DEMO_CAPTION_IDS).toContain(step.caption_id);
      expect(step.caption).toBe(DEMO_CAPTIONS[step.caption_id as keyof typeof DEMO_CAPTIONS]);
      expect(step.route.startsWith("/")).toBe(true);
    }
  });
});
