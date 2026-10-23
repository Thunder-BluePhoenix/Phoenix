// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Event → colour mapping, per-device consent and revoke, focus mode / quiet hours, failing and
// stuck devices, and the guarantee that no event text reaches a device. Simulated: fake feed and
// recording transports, an injected clock; no timer, socket or real light is used.
import { describe, expect, it } from "vitest";
import {
  COLORS,
  StatusLightsController,
  isQuiet,
  mapEvent,
  type Device,
  type QuietHours,
} from "../src";
import { FakeFeed, FakeTransport, HUE_RESOURCE, agent, core } from "../testing/fakes";

const AT_23_UTC = Date.UTC(2026, 9, 22, 23, 0);
const NIGHT: QuietHours = { timezone: "UTC", start: "22:00", end: "07:00" };

interface Rig {
  c: StatusLightsController;
  feed: FakeFeed;
  lights: Record<string, FakeTransport>;
  consent: Set<string>;
  settings: { focus: boolean; quiet: QuietHours | null; now: number };
  errors: string[];
  written: string[];
}

function rig(ids: readonly string[] = ["a"], consented: readonly string[] = ids): Rig {
  const feed = new FakeFeed();
  const lights: Record<string, FakeTransport> = {};
  const devices: Device[] = ids.map((id) => {
    lights[id] = new FakeTransport();
    return { id, kind: "luxafor", transport: lights[id] };
  });
  const consent = new Set(consented);
  const settings = { focus: false, quiet: null as QuietHours | null, now: AT_23_UTC };
  const errors: string[] = [];
  const written: string[] = [];
  const c = new StatusLightsController({
    devices,
    feed,
    policy: {
      permitted: (id) => consent.has(id),
      focusMode: () => settings.focus,
      quietHours: () => settings.quiet,
    },
    now: () => settings.now,
    onError: (id) => errors.push(id),
    onWritten: (id) => written.push(id),
  });
  return { c, feed, lights, consent, settings, errors, written };
}

/** The colours written to a Luxafor-style light, in order. */
function colours(t: FakeTransport): string[] {
  return t.sent.map((s) => (s.via === "report" ? [...s.bytes].slice(2, 5).join(",") : "?"));
}
const rgb = (state: keyof typeof COLORS) => COLORS[state].join(",");

describe("mapEvent", () => {
  it.each([
    ["agents", "agent.working", "WORKING"],
    ["agents", "agent.waiting", "WAITING"],
    ["agents", "agent.failed", "ERROR"],
    ["agents", "agent.completed", "IDLE"],
    ["agents", "agent.ended", "IDLE"],
    ["agents", "agent.idle", "IDLE"],
    ["core", "notetaker.recording", "RECORDING"],
    ["core", "notetaker.idle", "IDLE"],
  ])("%s %s → %s", (source, event_type, state) => {
    expect(mapEvent({ source, event_type })).toBe(state);
  });

  it.each([
    ["mock", "agent.failed"],
    ["core", "agent.failed"],
    ["agents", "notetaker.recording"],
    ["ports", "notetaker.recording"],
    [undefined, "agent.working"],
    ["agents", "agent.started"],
    ["agents", "build.failed"],
  ])("ignores %s %s: a name from the wrong source is not trusted", (source, event_type) => {
    expect(mapEvent({ ...(source ? { source } : {}), event_type })).toBeUndefined();
  });
});

describe("following Fawkes", () => {
  it("starts dark, then follows IDLE → WORKING → ERROR → RECORDING → IDLE on a consented light", async () => {
    const r = rig();
    r.c.start();
    await r.c.writes.drained();
    r.feed.emit(agent("agent.working", { agent_id: "x" }));
    await r.c.writes.drained();
    r.feed.emit(agent("agent.failed", { agent_id: "x" }));
    await r.c.writes.drained();
    r.feed.emit(core("notetaker.recording"));
    await r.c.writes.drained();
    r.feed.emit(core("notetaker.idle"));
    await r.c.writes.drained();
    expect(colours(r.lights.a!)).toEqual([
      rgb("IDLE"),
      rgb("WORKING"),
      rgb("ERROR"),
      rgb("RECORDING"),
      rgb("ERROR"), // the failed agent is still failed once the recording ends
    ]);
  });

  it("subscribes only to the status event names", () => {
    const r = rig();
    r.c.start();
    expect(r.feed.patterns).toContain("notetaker.recording");
    expect(r.feed.patterns.every((p) => !p.includes("*"))).toBe(true);
    expect(r.feed.listeners.size).toBe(1);
  });

  it("shows the most urgent of several agents, and recovers as they finish", async () => {
    const r = rig();
    r.c.start();
    r.feed.emit(agent("agent.working", { agent_id: "one" }));
    r.feed.emit(agent("agent.waiting", { agent_id: "two" }));
    expect(r.c.snapshot().shown).toBe("WAITING");
    r.feed.emit(agent("agent.failed", { agent_id: "three" }));
    expect(r.c.snapshot().shown).toBe("ERROR");
    r.feed.emit(agent("agent.completed", { agent_id: "three" }));
    r.feed.emit(agent("agent.completed", { agent_id: "two" }));
    expect(r.c.snapshot().shown).toBe("WORKING");
    r.feed.emit(agent("agent.ended", { agent_id: "one" }));
    expect(r.c.snapshot().shown).toBe("IDLE");
    await r.c.writes.drained();
  });

  it("recording outranks everything while it lasts", async () => {
    const r = rig();
    r.c.start();
    r.feed.emit(agent("agent.failed", { agent_id: "x" }));
    r.feed.emit(core("notetaker.recording"));
    expect(r.c.snapshot().shown).toBe("RECORDING");
    r.feed.emit(core("notetaker.idle"));
    expect(r.c.snapshot().shown).toBe("ERROR");
    await r.c.writes.drained();
  });

  it("does not resend an unchanged colour", async () => {
    const r = rig();
    r.c.start();
    await r.c.writes.drained();
    r.feed.emit(agent("agent.working", { agent_id: "x" }));
    r.feed.emit(agent("agent.working", { agent_id: "y" }));
    r.feed.emit(agent("agent.working", { agent_id: "x" }));
    await r.c.writes.drained();
    expect(colours(r.lights.a!)).toEqual([rgb("IDLE"), rgb("WORKING")]);
  });

  it("bounds the agent table: an agent flood cannot grow memory, only evict the oldest", async () => {
    const r = rig();
    r.c.start();
    r.feed.emit(agent("agent.failed", { agent_id: "first" }));
    for (let i = 0; i < 200; i++) r.feed.emit(agent("agent.working", { agent_id: `a${i}` }));
    // The flood pushed the old failure out; it is the bounded behaviour, not a crash.
    expect(r.c.snapshot().state).toBe("WORKING");
    await r.c.writes.drained();
  });

  it("stop() unsubscribes and nothing more is written", async () => {
    const r = rig();
    r.c.start();
    await r.c.writes.drained();
    r.c.stop();
    r.feed.emit(agent("agent.failed"));
    r.c.handle(agent("agent.failed"));
    await r.c.writes.drained();
    expect(r.feed.listeners.size).toBe(0);
    expect(colours(r.lights.a!)).toEqual([rgb("IDLE")]);
  });

  it("start() twice subscribes once", () => {
    const r = rig();
    r.c.start();
    r.c.start();
    expect(r.feed.listeners.size).toBe(1);
  });
});

describe("per-device consent", () => {
  it("never contacts a light that has no consent, even though it is provisioned", async () => {
    const r = rig(["a", "b"], ["a"]);
    r.c.start();
    await r.c.writes.drained();
    r.feed.emit(agent("agent.failed", { agent_id: "x" }));
    await r.c.writes.drained();
    expect(colours(r.lights.a!)).toEqual([rgb("IDLE"), rgb("ERROR")]);
    expect(r.lights.b!.sent).toEqual([]);
    expect(r.c.isLive("a")).toBe(true);
    expect(r.c.isLive("b")).toBe(false);
  });

  it("revoke() stops writes at once and a later event does not bring the light back", async () => {
    const r = rig();
    r.c.start();
    await r.c.writes.drained();
    r.c.revoke("a");
    r.feed.emit(agent("agent.failed", { agent_id: "x" }));
    await r.c.writes.drained();
    expect(colours(r.lights.a!)).toEqual([rgb("IDLE")]);
    expect(r.c.isLive("a")).toBe(false);
  });

  it("revoke() aborts a write that is stuck on the device", async () => {
    const r = rig();
    r.lights.a!.hang = true;
    r.c.start();
    await Promise.resolve();
    expect(r.lights.a!.hung).toHaveLength(1);
    r.c.revoke("a");
    await r.c.writes.drained();
    expect(r.lights.a!.aborted).toBe(1);
    expect(r.errors).toEqual([]); // an abort we caused is not a device failure
  });

  it("a consent withdrawn in settings is honoured even before anyone calls revoke()", async () => {
    const r = rig();
    r.c.start();
    await r.c.writes.drained();
    r.consent.delete("a");
    r.feed.emit(agent("agent.failed", { agent_id: "x" }));
    await r.c.writes.drained();
    expect(colours(r.lights.a!)).toEqual([rgb("IDLE")]);
    expect(r.c.isLive("a")).toBe(false);
  });

  it("a write already queued is dropped if consent is withdrawn before it runs", async () => {
    const r = rig();
    r.c.start();
    r.feed.emit(agent("agent.failed", { agent_id: "x" })); // queued behind the first write
    r.consent.delete("a");
    await r.c.writes.drained();
    expect(colours(r.lights.a!)).not.toContain(rgb("ERROR"));
  });

  it("fresh consent after a revoke re-lights the device with the current colour", async () => {
    const r = rig();
    r.c.start();
    await r.c.writes.drained();
    r.feed.emit(agent("agent.waiting", { agent_id: "x" }));
    await r.c.writes.drained();
    r.c.revoke("a");
    r.consent.delete("a");
    r.consent.add("a"); // the person opts in again
    r.c.consentChanged("a");
    await r.c.writes.drained();
    expect(colours(r.lights.a!)).toEqual([rgb("IDLE"), rgb("WAITING"), rgb("WAITING")]);
    expect(r.c.isLive("a")).toBe(true);
  });

  it("consentChanged with consent removed revokes", async () => {
    const r = rig();
    r.c.start();
    r.consent.delete("a");
    r.c.consentChanged("a");
    expect(r.c.isLive("a")).toBe(false);
    await r.c.writes.drained();
  });

  it("rejects unknown device ids", () => {
    const r = rig();
    expect(() => r.c.revoke("nope")).toThrow("Unknown device");
    expect(() => r.c.consentChanged("nope")).toThrow("Unknown device");
  });

  it("rejects duplicate and malformed device ids when built", () => {
    const transport = new FakeTransport();
    const make = (ids: string[]) =>
      new StatusLightsController({
        devices: ids.map((id) => ({ id, kind: "luxafor" as const, transport })),
        feed: new FakeFeed(),
        policy: { permitted: () => true, focusMode: () => false, quietHours: () => null },
      });
    expect(() => make(["a", "a"])).toThrow("Invalid or duplicate");
    expect(() => make(["has space"])).toThrow("Invalid or duplicate");
    expect(() => make(["../x"])).toThrow("Invalid or duplicate");
    expect(() => make([""])).toThrow("Invalid or duplicate");
  });
});

describe("focus mode and quiet hours", () => {
  it("focus mode darkens the light, and it returns when focus ends", async () => {
    const r = rig();
    r.c.start();
    await r.c.writes.drained();
    r.feed.emit(agent("agent.failed", { agent_id: "x" }));
    await r.c.writes.drained();
    r.settings.focus = true;
    r.c.refreshPolicy();
    await r.c.writes.drained();
    expect(r.c.snapshot()).toMatchObject({ state: "ERROR", shown: "IDLE", suppressed: "focus" });
    r.feed.emit(agent("agent.waiting", { agent_id: "y" })); // still dark while focused
    await r.c.writes.drained();
    expect(colours(r.lights.a!)).toEqual([rgb("IDLE"), rgb("ERROR"), rgb("IDLE")]);
    r.settings.focus = false;
    r.c.refreshPolicy();
    await r.c.writes.drained();
    expect(colours(r.lights.a!)).toEqual([rgb("IDLE"), rgb("ERROR"), rgb("IDLE"), rgb("ERROR")]);
  });

  it("quiet hours darken the light, including a recording (the red light also respects them)", async () => {
    const r = rig();
    r.settings.quiet = NIGHT;
    r.c.start();
    r.feed.emit(core("notetaker.recording"));
    await r.c.writes.drained();
    expect(r.c.snapshot()).toMatchObject({
      state: "RECORDING",
      shown: "IDLE",
      suppressed: "quiet",
    });
    expect(colours(r.lights.a!)).toEqual([rgb("IDLE")]);
  });

  it("quiet hours end: the light lights up again after refreshPolicy", async () => {
    const r = rig();
    r.settings.quiet = NIGHT;
    r.c.start();
    await r.c.writes.drained();
    r.feed.emit(agent("agent.failed", { agent_id: "x" }));
    r.settings.now = Date.UTC(2026, 9, 23, 7, 0); // 07:00 is the first minute after the window
    r.c.refreshPolicy();
    await r.c.writes.drained();
    expect(colours(r.lights.a!)).toEqual([rgb("IDLE"), rgb("ERROR")]);
  });

  it("an unreadable quiet-hours setting fails dark, never bright", async () => {
    const r = rig();
    r.settings.quiet = { timezone: "Mars/Olympus", start: "22:00", end: "07:00" };
    r.c.start();
    r.feed.emit(agent("agent.failed", { agent_id: "x" }));
    await r.c.writes.drained();
    expect(r.c.snapshot().suppressed).toBe("quiet");
    expect(colours(r.lights.a!)).toEqual([rgb("IDLE")]);
  });
});

describe("isQuiet", () => {
  it("handles a window across midnight, one inside a day, and the exact boundaries", () => {
    const at = (h: number, m = 0) => Date.UTC(2026, 9, 22, h, m);
    expect(isQuiet(at(23), NIGHT)).toBe(true);
    expect(isQuiet(at(3), NIGHT)).toBe(true);
    expect(isQuiet(at(22), NIGHT)).toBe(true);
    expect(isQuiet(at(6, 59), NIGHT)).toBe(true);
    expect(isQuiet(at(7), NIGHT)).toBe(false);
    expect(isQuiet(at(12), NIGHT)).toBe(false);
    const lunch: QuietHours = { timezone: "UTC", start: "12:00", end: "13:00" };
    expect(isQuiet(at(12, 30), lunch)).toBe(true);
    expect(isQuiet(at(13), lunch)).toBe(false);
  });

  it("uses the configured time zone, not the machine's", () => {
    // 23:00 UTC is 19:00 in New York (not quiet) and 04:30 in Kolkata (quiet).
    expect(isQuiet(AT_23_UTC, { ...NIGHT, timezone: "America/New_York" })).toBe(false);
    expect(isQuiet(AT_23_UTC, { ...NIGHT, timezone: "Asia/Kolkata" })).toBe(true);
  });

  it("equal start and end is no window; no setting is no quiet", () => {
    expect(isQuiet(AT_23_UTC, { timezone: "UTC", start: "09:00", end: "09:00" })).toBe(false);
    expect(isQuiet(AT_23_UTC, null)).toBe(false);
  });

  it.each(["24:00", "9:00", "07:60", "noon", ""])("rejects the malformed time %j", (time) => {
    expect(() => isQuiet(AT_23_UTC, { timezone: "UTC", start: time, end: "07:00" })).toThrow(
      "Invalid quiet hours",
    );
  });
});

describe("failing and stuck devices", () => {
  it("reports a failed write by device id only and retries on the next change", async () => {
    const r = rig();
    r.lights.a!.failNext = 1;
    r.c.start();
    await r.c.writes.drained();
    expect(r.errors).toEqual(["a"]);
    r.feed.emit(agent("agent.working", { agent_id: "x" }));
    await r.c.writes.drained();
    expect(colours(r.lights.a!)).toEqual([rgb("WORKING")]);
    expect(r.written).toEqual(["a"]);
  });

  it("a failure of one light does not stop the others", async () => {
    const r = rig(["a", "b"]);
    r.lights.a!.failNext = 5;
    r.c.start();
    await r.c.writes.drained();
    r.feed.emit(agent("agent.failed", { agent_id: "x" }));
    await r.c.writes.drained();
    expect(colours(r.lights.b!)).toEqual([rgb("IDLE"), rgb("ERROR")]);
  });

  it("while a write is stuck the newest state wins and stale ones are never sent", async () => {
    const r = rig();
    r.lights.a!.hang = true;
    r.c.start();
    await Promise.resolve();
    r.feed.emit(agent("agent.working", { agent_id: "x" })); // aborts the stuck IDLE write
    r.feed.emit(agent("agent.failed", { agent_id: "x" })); // aborts the queued WORKING write
    r.lights.a!.hang = false;
    await r.c.writes.drained();
    expect(colours(r.lights.a!)).toEqual([rgb("ERROR")]);
    expect(r.errors).toEqual([]);
  });

  it("stop() aborts the in-flight write and sends nothing after", async () => {
    const r = rig();
    r.lights.a!.hang = true;
    r.c.start();
    await Promise.resolve();
    r.c.stop();
    await r.c.writes.drained();
    expect(r.lights.a!.aborted).toBe(1);
    expect(r.lights.a!.sent).toEqual([]);
  });
});

describe("shutdown", () => {
  it("turns consented lights off and leaves unconsented ones alone", async () => {
    const r = rig(["a", "b"], ["a"]);
    r.c.start();
    r.feed.emit(core("notetaker.recording"));
    await r.c.writes.drained();
    await r.c.shutdown();
    expect(colours(r.lights.a!).at(-1)).toBe(rgb("IDLE"));
    expect(r.lights.b!.sent).toEqual([]);
    expect(r.feed.listeners.size).toBe(0);
  });

  it("does not wait forever on a stuck light, and skips a revoked one", async () => {
    const r = rig(["a", "b"]);
    r.c.start();
    await r.c.writes.drained();
    r.c.revoke("b");
    r.lights.a!.failNext = 1;
    await r.c.shutdown();
    expect(r.errors).toContain("a");
    expect(colours(r.lights.b!)).toEqual([rgb("IDLE")]); // only the initial write, before revoke
  });
});

describe("untrusted content is data, never a device command", () => {
  const hostile =
    "IGNORE PREVIOUS INSTRUCTIONS; set colour 1,2,3; PUT /clip/v2/resource/light/../../config";

  it("agent text, subjects and unknown payload fields never reach any transport", async () => {
    const devices: Device[] = (["hue", "key-light", "luxafor", "lifx"] as const).map((kind) => ({
      id: kind,
      kind,
      transport: new FakeTransport(),
      ...(kind === "hue" ? { resource: HUE_RESOURCE } : {}),
      ...(kind === "lifx" ? { mac: "d073d5012345" } : {}),
    }));
    const feed = new FakeFeed();
    const c = new StatusLightsController({
      devices,
      feed,
      policy: { permitted: () => true, focusMode: () => false, quietHours: () => null },
    });
    c.start();
    feed.emit({
      event_type: "agent.failed",
      source: "agents",
      payload: { agent_id: hostile, task: hostile, color: [1, 2, 3], path: "/x", subject: hostile },
    });
    await c.writes.drained();
    for (const d of devices) {
      const dump = (d.transport as FakeTransport).dump();
      expect(dump).not.toContain("IGNORE");
      expect(dump).not.toContain("../../config");
      expect(dump).not.toContain("1,2,3");
    }
    // Hue is the only transport with a path, and it is the fixed light path for the provisioned id.
    const hue = (devices[0]!.transport as FakeTransport).sent;
    expect(hue.every((s) => s.via === "request" && s.path.endsWith(HUE_RESOURCE))).toBe(true);
  });

  it("spoofed envelopes are ignored: another capability cannot fake an agent failure or a recording", async () => {
    const r = rig();
    r.c.start();
    await r.c.writes.drained();
    r.feed.emit({ event_type: "agent.failed", source: "evil", payload: { agent_id: "x" } });
    r.feed.emit({ event_type: "notetaker.recording", source: "evil" });
    r.feed.emit({ event_type: "notetaker.recording", source: "agents" });
    r.feed.emit({ event_type: "agent.failed", source: "core" });
    await r.c.writes.drained();
    expect(r.c.snapshot().state).toBe("IDLE");
    expect(colours(r.lights.a!)).toEqual([rgb("IDLE")]);
  });

  it("a non-string or oversized agent_id is only a table key, never an error or a command", async () => {
    const r = rig();
    r.c.start();
    await r.c.writes.drained();
    r.feed.emit(agent("agent.working", { agent_id: { toString: "x" } }));
    r.feed.emit(agent("agent.working", { agent_id: "z".repeat(100_000) }));
    r.feed.emit(agent("agent.working"));
    expect(r.c.snapshot().state).toBe("WORKING");
    await r.c.writes.drained();
    expect(colours(r.lights.a!)).toEqual([rgb("IDLE"), rgb("WORKING")]);
  });
});
