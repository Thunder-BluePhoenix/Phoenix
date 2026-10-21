// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { OutageDetector, parseContinuityConfig, parseHost } from "../../src/continuity";
import { ENABLE_ALL, continuityRig, statusOf, types } from "./rig";

describe("OutageDetector", () => {
  it("goes down only after N consecutive failures, once, and up once", () => {
    const d = new OutageDetector(3);
    expect(d.observe(false, 1)).toBeNull();
    expect(d.observe(false, 2)).toBeNull();
    expect(d.observe(false, 3)).toEqual({ kind: "down", at: 3, failingSince: 1 });
    expect(d.observe(false, 4)).toBeNull();
    expect(d.observe(false, 5)).toBeNull();
    expect(d.observe(true, 9)).toEqual({ kind: "up", at: 9, outageMs: 8 });
    expect(d.observe(true, 10)).toBeNull();
  });

  it("ignores flapping that never reaches N in a row", () => {
    const d = new OutageDetector(3);
    const seen = [false, false, true, false, false, true, false, false, true].map((ok, i) =>
      d.observe(ok, i),
    );
    expect(seen.every((t) => t === null)).toBe(true);
    expect(d.down).toBe(false);
  });

  it("a second outage after recovery is reported again with its own start", () => {
    const d = new OutageDetector(2);
    d.observe(false, 1);
    expect(d.observe(false, 2)?.kind).toBe("down");
    expect(d.observe(true, 3)?.kind).toBe("up");
    d.observe(false, 10);
    expect(d.observe(false, 11)).toEqual({ kind: "down", at: 11, failingSince: 10 });
  });
});

describe("host list", () => {
  it("defaults to nothing: no hard-coded hosts, all extras off", () => {
    const c = parseContinuityConfig(undefined);
    expect(c.network).toMatchObject({ enabled: false, hosts: [] });
    expect(c.hotspot.enabled).toBe(false);
    expect(c.nudge).toMatchObject({
      enabled: false,
      panes: [],
      sessions: [],
      allowedCommands: [],
      enter: false,
    });
    expect(c.throttle.enabled).toBe(false);
  });

  it("accepts host and host:port and rejects anything else", () => {
    expect(parseHost("example.test")).toEqual({ host: "example.test", port: 443 });
    expect(parseHost("10.0.0.1:8080")).toEqual({ host: "10.0.0.1", port: 8080 });
    for (const bad of ["", "-x", "a b", "a;b", "http://x", "x:0", "x:70000", "x/y", 5, null]) {
      expect(parseHost(bad)).toBeNull();
    }
  });
});

describe("network watch in the module", () => {
  const on = { continuity: { network_watch: { enabled: true, hosts: ["example.test"] } } };

  it("emits down after 3 failed probes and up on recovery, each once", async () => {
    const r = await continuityRig({ config: on, withSession: false });
    r.net.up = false;
    await r.tick(2);
    expect(types(r)).toEqual([]);
    await r.tick(1);
    expect(types(r)).toEqual(["awake.network.down"]);
    await r.tick(4);
    expect(types(r)).toEqual(["awake.network.down"]);
    r.net.up = true;
    await r.tick(1);
    await r.tick(2);
    expect(types(r)).toEqual(["awake.network.down", "awake.network.up"]);
    expect(r.events[0]?.severity).toBe("warning");
    r.shutdown();
  });

  it("flapping below the threshold produces no events", async () => {
    const r = await continuityRig({ config: on, withSession: false });
    for (const up of [false, false, true, false, false, true]) {
      r.net.up = up;
      await r.tick();
    }
    expect(types(r)).toEqual([]);
    r.shutdown();
  });

  it("does not probe with no hosts chosen, and stops probing on shutdown", async () => {
    const none = await continuityRig({
      config: { continuity: { network_watch: { enabled: true } } },
    });
    await none.tick(5);
    expect(none.net.probes).toBe(0);
    const r = await continuityRig({ config: on });
    await r.tick(2);
    const before = r.net.probes;
    r.shutdown();
    await r.tick(5);
    expect(r.net.probes).toBe(before);
  });

  it("everything off: no probe and no Runner call even during a long outage", async () => {
    const r = await continuityRig({ config: {} });
    r.net.up = false;
    await r.tick(40);
    expect(r.net.probes).toBe(0);
    expect(r.sys.runs).toEqual([]);
    expect(r.events).toEqual([]);
  });

  it("an enabled switch with no targets is still inert", async () => {
    const r = await continuityRig({
      config: {
        continuity: {
          nudge: { enabled: true },
          hotspot: { enabled: true },
          throttle_check: { enabled: true },
        },
      },
    });
    r.net.up = false;
    await r.tick(40);
    expect(r.sys.runs).toEqual([]);
  });

  it("records the last outage in status", async () => {
    const r = await continuityRig({ config: on, withSession: false });
    r.net.up = false;
    await r.tick(3);
    r.net.up = true;
    await r.tick(1);
    const status = await statusOf(r);
    expect(status.last_outage?.ended_at).not.toBeNull();
    expect(status.last_outage?.hotspot).toBe("skipped");
    r.shutdown();
  });
});

describe("declared", () => {
  it("every event is declared and the state rule uses an existing state with a ttl", async () => {
    const r = await continuityRig({ config: ENABLE_ALL });
    expect(r.module.events).toEqual(
      expect.arrayContaining(["awake.network.down", "awake.network.up", "awake.nudge.result"]),
    );
    const down = r.module.stateRules.find((s) => s.match === "awake.network.down");
    expect(down?.effect).toMatchObject({ state: "WARNING" });
    expect(down?.effect.ttlMs).toBeGreaterThan(0);
    expect(r.module.stateRules.find((s) => s.match === "awake.network.up")?.effect).toEqual({
      clear: true,
    });
    r.shutdown();
  });
});
