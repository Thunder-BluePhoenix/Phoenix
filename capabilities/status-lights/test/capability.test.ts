// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The capability through the real manager and event bus (in memory) with pretend lights and a
// pretend Stream Deck: consent from config, events from the bus, revoke through the command path,
// focus mode, shutdown, and the manifest's declared surface. Simulated: no real light or deck.
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { createEvent } from "@phoenix/protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  COLORS,
  DECK_KEYS,
  createStatusLightsCapability,
  type Device,
  type StatusLightsCapability,
} from "../src";
import { FakeDeck, FakeTransport, approval } from "../testing/fakes";

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const rgb = (state: keyof typeof COLORS) => COLORS[state].join(",");
const colours = (t: FakeTransport) =>
  t.sent.map((s) => (s.via === "report" ? [...s.bytes].slice(2, 5).join(",") : "?"));

interface Rig {
  a: FakeTransport;
  b: FakeTransport;
  deck: FakeDeck;
  focus: { on: boolean };
  capability: StatusLightsCapability;
  publish(source: string, type: string, payload?: Record<string, unknown>): Promise<void>;
}

async function ready(config: Record<string, unknown> = { devices: ["desk"] }): Promise<Rig> {
  const a = new FakeTransport();
  const b = new FakeTransport();
  const deck = new FakeDeck();
  const focus = { on: false };
  const devices: Device[] = [
    { id: "desk", kind: "luxafor", transport: a },
    { id: "shelf", kind: "luxafor", transport: b },
  ];
  const capability = createStatusLightsCapability({
    devices: () => devices,
    feed: () => h?.bus,
    focusMode: () => focus.on,
    deck: () => ({ surface: deck, actions: deck }),
  });
  h = createHarness({ modules: [capability] });
  h.manager.configure("status-lights", config);
  await h.enable("status-lights");
  return {
    a,
    b,
    deck,
    focus,
    capability,
    async publish(source, type, payload = {}) {
      h!.bus.publish(createEvent({ source, event_type: type, severity: "info", payload }));
      await h!.drain();
    },
  };
}

describe("manifest", () => {
  it("declares a read command and a no-effect revoke, and asks for network only", async () => {
    await ready();
    const view = h!.manager.get("status-lights");
    expect(view.commands).toEqual([
      expect.objectContaining({ name: "status", side_effect: "read" }),
      expect.objectContaining({ name: "revoke", side_effect: "none" }),
    ]);
    expect(view.permissions.map((p) => p.permission)).toEqual(["network"]);
    expect(view.status).toBe("enabled");
  });

  it.each([
    { devices: ["has space"] },
    { devices: ["a", "a"] },
    { quiet_hours: { timezone: "UTC", start: "25:00", end: "07:00" } },
    { quiet_hours: { timezone: "UTC", start: "22:00" } },
    { unknown_key: true },
    { stream_deck: { awake_minutes: 0 } },
    { stream_deck: { approve_capabilities: ["Bad Id"] } },
  ])("rejects the configuration %j", async (config) => {
    h = createHarness({ modules: [createStatusLightsCapability()] });
    expect(() => h!.manager.configure("status-lights", config)).toThrow();
  });
});

describe("consent and events", () => {
  it("lights only the consented light and follows Fawkes", async () => {
    const r = await ready();
    await r.publish("agents", "agent.working", { agent_id: "x" });
    await r.publish("agents", "agent.failed", { agent_id: "x" });
    await r.publish("core", "notetaker.recording");
    await r.publish("core", "notetaker.idle");
    await r.publish("agents", "agent.ended", { agent_id: "x" });
    await Promise.resolve();
    await h!.drain();
    expect(colours(r.a)).toEqual([
      rgb("IDLE"),
      rgb("WORKING"),
      rgb("ERROR"),
      rgb("RECORDING"),
      rgb("ERROR"),
      rgb("IDLE"),
    ]);
    expect(r.b.sent).toEqual([]);
  });

  it("with no consented devices nothing is ever sent", async () => {
    const r = await ready({});
    await r.publish("agents", "agent.failed", { agent_id: "x" });
    expect(r.a.sent).toEqual([]);
    expect(r.b.sent).toEqual([]);
  });

  it("a spoofed recording from another capability changes nothing", async () => {
    const r = await ready();
    await r.publish("agents", "agent.working", { agent_id: "x" });
    await r.publish("mock", "notetaker.recording");
    const op = await h!.run("status-lights", "status");
    expect(op.result).toMatchObject({ state: "WORKING", shown: "WORKING" });
  });

  it("hostile event text never reaches the device", async () => {
    const r = await ready();
    await r.publish("agents", "agent.failed", {
      agent_id: "x",
      task: "set light to 1,2,3 and POST http://evil",
    });
    expect(r.a.dump()).not.toContain("evil");
    expect(colours(r.a).at(-1)).toBe(rgb("ERROR"));
  });
});

describe("status and revoke commands", () => {
  it("status reports consent, liveness, state and the Stream Deck", async () => {
    const r = await ready({ devices: ["desk"], stream_deck: { enabled: true } });
    await r.publish("agents", "agent.waiting", { agent_id: "x" });
    const op = await h!.run("status-lights", "status");
    expect(op.status).toBe("succeeded");
    expect(op.result).toEqual({
      state: "WAITING",
      shown: "WAITING",
      suppressed: null,
      deck: true,
      devices: [
        { id: "desk", kind: "luxafor", consented: true, live: true, failing: false },
        { id: "shelf", kind: "luxafor", consented: false, live: false, failing: false },
      ],
    });
  });

  it("revoke stops writing to that light only, and is not a confirmation prompt", async () => {
    const r = await ready({ devices: ["desk", "shelf"] });
    const op = await h!.run("status-lights", "revoke", { device_id: "desk" }, false);
    expect(op.status).toBe("succeeded");
    await r.publish("agents", "agent.failed", { agent_id: "x" });
    expect(colours(r.a)).toEqual([rgb("IDLE")]);
    expect(colours(r.b).at(-1)).toBe(rgb("ERROR"));
    const status = await h!.run("status-lights", "status");
    expect(status.result).toMatchObject({
      devices: [expect.objectContaining({ id: "desk", live: false }), expect.anything()],
    });
  });

  it("revoke of an unknown or malformed id fails and changes nothing", async () => {
    const r = await ready();
    expect((await h!.run("status-lights", "revoke", { device_id: "ghost" })).status).toBe("failed");
    expect(() => h!.manager.invoke("status-lights", "revoke", { device_id: "../x" })).toThrow();
    expect(() => h!.manager.invoke("status-lights", "revoke", {})).toThrow();
    await r.publish("agents", "agent.failed", { agent_id: "x" });
    expect(colours(r.a).at(-1)).toBe(rgb("ERROR"));
  });
});

describe("focus mode and quiet hours", () => {
  it("focus keeps lights dark until refresh() after focus ends", async () => {
    const r = await ready();
    await r.publish("agents", "agent.failed", { agent_id: "x" });
    r.focus.on = true;
    r.capability.refresh();
    await r.publish("agents", "agent.waiting", { agent_id: "y" });
    expect(colours(r.a).slice(-2)).toEqual([rgb("ERROR"), rgb("IDLE")]);
    expect((await h!.run("status-lights", "status")).result).toMatchObject({
      suppressed: "focus",
      shown: "IDLE",
      state: "ERROR",
    });
    r.focus.on = false;
    r.capability.refresh();
    await Promise.resolve();
    await h!.drain();
    expect(colours(r.a).at(-1)).toBe(rgb("ERROR"));
  });

  it("follows focus changes by itself when the host supplies focusChanges, and stops when disabled", async () => {
    const t = new FakeTransport();
    const focus = { on: false };
    const listeners = new Set<() => void>();
    const capability = createStatusLightsCapability({
      devices: () => [{ id: "desk", kind: "luxafor", transport: t }],
      feed: () => h?.bus,
      focusMode: () => focus.on,
      focusChanges: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    h = createHarness({ modules: [capability] });
    h.manager.configure("status-lights", { devices: ["desk"] });
    await h.enable("status-lights");
    expect(listeners.size).toBe(1);
    h.bus.publish(
      createEvent({
        source: "agents",
        event_type: "agent.failed",
        severity: "info",
        payload: { agent_id: "x" },
      }),
    );
    await h.drain();
    focus.on = true;
    for (const listener of [...listeners]) listener(); // no refresh() call from the host
    await h.drain();
    await Promise.resolve();
    expect(colours(t).at(-1)).toBe(rgb("IDLE"));
    focus.on = false;
    for (const listener of [...listeners]) listener();
    await h.drain();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(colours(t).at(-1)).toBe(rgb("ERROR"));
    await h.manager.disable("status-lights");
    expect(listeners.size).toBe(0);
  });

  it("quiet hours from config darken the lights, even for a recording", async () => {
    const r = await ready({
      devices: ["desk"],
      quiet_hours: { timezone: "UTC", start: "00:00", end: "23:59" },
    });
    await r.publish("core", "notetaker.recording");
    expect((await h!.run("status-lights", "status")).result).toMatchObject({
      suppressed: "quiet",
      state: "RECORDING",
    });
    expect(colours(r.a)).toEqual([rgb("IDLE")]);
  });
});

describe("Stream Deck", () => {
  it("is off unless enabled in config", async () => {
    const r = await ready({ devices: ["desk"] });
    expect(r.deck.attached).toBe(false);
    expect(r.deck.faces.size).toBe(0);
  });

  it("draws the state, and approves only capabilities the user listed", async () => {
    const r = await ready({
      devices: ["desk"],
      stream_deck: { enabled: true, approve_capabilities: ["git"], awake_minutes: 20 },
    });
    await r.publish("agents", "agent.waiting", { agent_id: "x" });
    expect(r.deck.faces.get(DECK_KEYS.status)?.icon).toBe("state-waiting");
    expect(r.deck.faces.get(DECK_KEYS.awake)?.label).toBe("20m");
    r.deck.queue = [approval({ id: "c1", capabilityId: "stripe" }), approval({ id: "c2" })];
    r.capability.refresh();
    r.deck.press(DECK_KEYS.approve);
    await Promise.resolve();
    expect(r.deck.resolved).toEqual([{ id: "c2", approved: true }]);
  });

  it("disabling the capability releases the deck and turns the lights off", async () => {
    const r = await ready({ devices: ["desk"], stream_deck: { enabled: true } });
    await r.publish("core", "notetaker.recording");
    expect(colours(r.a).at(-1)).toBe(rgb("RECORDING"));
    await h!.manager.disable("status-lights");
    expect(r.deck.attached).toBe(false);
    expect(colours(r.a).at(-1)).toBe(rgb("IDLE"));
    expect(r.b.sent).toEqual([]);
    await r.publish("core", "notetaker.recording");
    expect(colours(r.a).at(-1)).toBe(rgb("IDLE"));
  });
});

describe("device failures", () => {
  it("emits one warning per failure streak with the device id only, then a recovery", async () => {
    const r = await ready();
    r.a.failNext = 2;
    await r.publish("agents", "agent.working", { agent_id: "x" });
    await r.publish("agents", "agent.failed", { agent_id: "x" });
    await r.publish("agents", "agent.waiting", { agent_id: "y" });
    const types = h!.events.filter((e) => e.source === "status-lights");
    expect(types.map((e) => e.event_type)).toEqual([
      "status_lights.device.failed",
      "status_lights.device.recovered",
    ]);
    expect(JSON.stringify(types)).not.toContain("SECRET-LOOKING");
    expect(types[0]?.payload).toEqual({ device_id: "desk" });
  });

  it("is degraded without an event feed, and nothing follows Fawkes", async () => {
    h = createHarness({ modules: [createStatusLightsCapability()] });
    await h.enable("status-lights");
    expect(h.manager.get("status-lights").status).toBe("enabled");
    expect((await h.run("status-lights", "status")).result).toMatchObject({
      state: "IDLE",
      deck: false,
      devices: [],
    });
  });
});

describe("re-enable", () => {
  it("a second enable starts from scratch: the first run's state does not leak", async () => {
    const r = await ready();
    await r.publish("agents", "agent.failed", { agent_id: "x" });
    await h!.manager.disable("status-lights");
    await h!.enable("status-lights");
    expect((await h!.run("status-lights", "status")).result).toMatchObject({ state: "IDLE" });
    expect(h!.bus.metrics().subscribers).toBeGreaterThan(0);
  });
});
