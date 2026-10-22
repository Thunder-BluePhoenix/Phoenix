// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderUnavailableError } from "@phoenix/ai-proactive/engineering";
import { EventBus } from "@phoenix/event-bus";
import { NotificationService } from "@phoenix/notifications";
import { openDatabase, SettingsStore } from "@phoenix/persistence";
import { createEvent } from "@phoenix/protocol";
import { StateEngine } from "@phoenix/state-engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EngineeringSignalsRuntime,
  ENGINEERING_SIGNALS_ROOTS_KEY,
} from "../src/engineering-signals";

const now = Date.parse("2026-10-22T12:00:00Z");
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function repo() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "phoenix-core-signals-")));
  dirs.push(dir);
  await writeFile(join(dir, ".env.example"), "PUBLIC_NAME=example\nMISSING_NAME=example\n");
  await writeFile(join(dir, ".env"), "PUBLIC_NAME=private-content-must-not-escape\n");
  return dir;
}
function rig() {
  const db = openDatabase(":memory:");
  const settings = new SettingsStore(db);
  const bus = new EventBus({ retryDelayMs: 0 });
  const notifications = new NotificationService({
    db,
    bus,
    state: new StateEngine(),
    now: () => now,
  });
  let enabled = false;
  let killed = false;
  const callbacks = new Map<number, () => void>();
  let next = 0;
  const timer = {
    set: vi.fn((callback: () => void, _delayMs: number) => {
      const id = ++next;
      callbacks.set(id, callback);
      return id;
    }),
    clear: vi.fn((id: unknown) => {
      callbacks.delete(id as number);
    }),
  };
  const lookup = vi.fn(async () => []);
  const history = vi.fn(async () => []);
  const options = {
    settings,
    bus,
    notifications,
    userId: () => "local-user",
    killSwitchEngaged: () => killed,
    capabilityEnabled: () => enabled,
    advisories: { lookup },
    history: { list: history },
    clock: { now: () => now },
    timer,
  };
  const service = new EngineeringSignalsRuntime(options);
  return {
    db,
    settings,
    bus,
    notifications,
    timer,
    callbacks,
    lookup,
    history,
    service,
    enable: () => {
      enabled = true;
    },
    disable: () => {
      enabled = false;
    },
    kill: () => {
      killed = true;
    },
    revive: () => {
      killed = false;
    },
    reopen: () => new EngineeringSignalsRuntime(options),
  };
}
const optIn = (r: { notifications: NotificationService }) =>
  r.notifications.setProactivePreferences("local-user", {
    enabled: true,
    capabilities: ["engineering-signals"],
    cadenceMinutes: 30,
  });

describe("EngineeringSignalsRuntime", () => {
  it("persists explicit canonical roots, restores them, scans manually without scheduling or leaking env values", async () => {
    const root = await repo();
    const r = rig();
    const initial = await r.service.status();
    expect(initial).toMatchObject({
      watchedRoots: [],
      signals: [],
      availability: { advisories: { available: false }, history: { available: false } },
    });
    expect(r.timer.set).not.toHaveBeenCalled();
    const snapshot = await r.service.setWatchedRoots([root, root]);
    expect(snapshot.watchedRoots).toEqual([root]);
    expect(snapshot.signals).toMatchObject([{ kind: "config_drift", subject: "MISSING_NAME" }]);
    expect(JSON.stringify(snapshot)).not.toContain("private-content-must-not-escape");
    expect(r.settings.get(ENGINEERING_SIGNALS_ROOTS_KEY, [])).toEqual([root]);
    expect(r.timer.set).not.toHaveBeenCalled();
    expect((await r.reopen().status()).watchedRoots).toEqual([root]);
    expect(r.notifications.list().notifications).toEqual([]);
    r.notifications.close();
    r.db.close();
  });

  it("rejects invalid roots atomically and never persists rejected input", async () => {
    const root = await repo();
    const r = rig();
    await r.service.setWatchedRoots([root]);
    for (const roots of [
      [root, "relative"],
      [root, "/missing-phoenix-signals-root"],
      "invalid",
      [null],
    ]) {
      await expect(r.service.setWatchedRoots(roots)).rejects.toMatchObject({
        code: "INVALID_REQUEST",
      });
      expect((await r.service.status()).watchedRoots).toEqual([root]);
      expect(r.settings.get(ENGINEERING_SIGNALS_ROOTS_KEY, [])).toEqual([root]);
    }
    r.notifications.close();
    r.db.close();
  });

  it("keeps manual config-drift scans working and reports unknown when providers are unavailable", async () => {
    const root = await repo();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ dependencies: { left: "1.0.0" } }),
    );
    const r = rig();
    r.lookup.mockRejectedValue(new ProviderUnavailableError("No vetted advisory source"));
    r.history.mockRejectedValue(new ProviderUnavailableError("History incomplete"));
    const snapshot = await r.service.setWatchedRoots([root]);
    expect(snapshot.signals).toMatchObject([{ kind: "config_drift", subject: "MISSING_NAME" }]);
    expect(snapshot.availability).toEqual({
      advisories: { available: false, reason: "No vetted advisory source" },
      history: { available: false, reason: "History incomplete" },
    });
    r.notifications.close();
    r.db.close();
  });

  it("arms only after full consent, uses selected cadence, and cancels on opt-out, capability disable, kill and shutdown", async () => {
    const root = await repo();
    const r = rig();
    await r.service.setWatchedRoots([root]);
    await r.service.startScheduler();
    expect(r.callbacks.size).toBe(0);
    optIn(r);
    r.service.consentChanged();
    expect(r.callbacks.size).toBe(0);
    r.enable();
    r.service.consentChanged();
    expect(r.callbacks.size).toBe(1);
    expect(r.timer.set).toHaveBeenCalledWith(expect.any(Function), 30 * 60_000);
    r.notifications.setProactivePreferences("local-user", { enabled: false });
    r.service.consentChanged();
    expect(r.callbacks.size).toBe(0);
    optIn(r);
    r.service.consentChanged();
    expect(r.callbacks.size).toBe(1);
    r.kill();
    r.bus.publish(
      createEvent({
        event_type: "security.kill_switch.engaged",
        source: "core",
        severity: "warning",
        payload: {},
      }),
    );
    await r.bus.drain();
    expect(r.callbacks.size).toBe(0);
    r.revive();
    r.service.consentChanged();
    expect(r.callbacks.size).toBe(1);
    r.disable();
    r.bus.publish(
      createEvent({
        event_type: "capability.disabled",
        source: "core",
        subject: "engineering-signals",
        severity: "info",
        payload: {},
      }),
    );
    await r.bus.drain();
    expect(r.callbacks.size).toBe(0);
    r.enable();
    r.service.consentChanged();
    expect(r.callbacks.size).toBe(1);
    r.service.stopScheduler();
    expect(r.callbacks.size).toBe(0);
    r.notifications.close();
    r.db.close();
  });

  it("sends scheduled findings through Phase 52 policy, never from manual scan", async () => {
    const root = await repo();
    const r = rig();
    await r.service.setWatchedRoots([root]);
    await r.service.status();
    expect(r.notifications.list().notifications).toHaveLength(0);
    r.enable();
    optIn(r);
    await r.service.startScheduler();
    const tick = [...r.callbacks.values()][0]!;
    tick();
    await vi.waitFor(() => expect(r.notifications.list().notifications).toHaveLength(1));
    expect(r.notifications.list().notifications[0]).toMatchObject({
      source: "engineering-signals",
    });
    r.service.stopScheduler();
    r.notifications.close();
    r.db.close();
  });
});
