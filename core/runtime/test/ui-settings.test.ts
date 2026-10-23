// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { afterEach, describe, expect, it } from "vitest";
import { connect, startCore, TOKEN, type TestCore } from "./helpers";

const cores: TestCore[] = [];
afterEach(async () => {
  for (const core of cores.splice(0)) await core.runtime.stop();
});
async function boot() {
  const core = await startCore();
  cores.push(core);
  return core;
}

const SUPPORTED = ["en", "zh", "hi", "es", "ar", "fr", "bn", "pt", "ru", "id"];

describe("UI settings routes (ui.locale)", () => {
  it("defaults to English and lists the ten supported languages", async () => {
    const core = await boot();
    const res = await core.api("GET", "/api/ui/settings");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ locale: "en", supported: SUPPORTED });
  });

  it("saves a supported locale and reads it back", async () => {
    const core = await boot();
    const set = await core.api("POST", "/api/ui/settings", { locale: "ar" });
    expect(set.status).toBe(200);
    expect(set.json.locale).toBe("ar");
    expect((await core.api("GET", "/api/ui/settings")).json.locale).toBe("ar");
    expect(core.runtime.settings.get("ui.locale", "en")).toBe("ar");
  });

  it.each([
    ["an unknown code", { locale: "xx" }],
    ["the pseudo-locale", { locale: "en-XA" }],
    ["a regional tag", { locale: "pt-BR" }],
    ["a wrong case", { locale: "EN" }],
    ["a number", { locale: 1 }],
    ["a missing field", {}],
  ])("rejects %s and keeps the saved language", async (_name, body) => {
    const core = await boot();
    await core.api("POST", "/api/ui/settings", { locale: "fr" });
    const res = await core.api("POST", "/api/ui/settings", body);
    expect(res.status).toBe(400);
    expect((await core.api("GET", "/api/ui/settings")).json.locale).toBe("fr");
  });

  it("falls back to English when the stored value is not a supported code", async () => {
    const core = await boot();
    core.runtime.settings.set("ui.locale", "klingon");
    expect((await core.api("GET", "/api/ui/settings")).json.locale).toBe("en");
  });

  it("requires the session token", async () => {
    const core = await boot();
    expect((await fetch(`${core.base}/api/ui/settings`)).status).toBe(401);
    const post = await fetch(`${core.base}/api/ui/settings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: "es" }),
    });
    expect(post.status).toBe(401);
  });

  it("tells connected views when the language changes, and not for a rejected change", async () => {
    const core = await boot();
    const ws = connect(core.port, TOKEN);
    await ws.opened;
    ws.send({ type: "subscribe", channels: ["event.created"] });
    const seen: string[] = [];
    core.runtime.bus.subscribe("test-ui", "ui.*", (e) => void seen.push(e.event_type));
    await core.api("POST", "/api/ui/settings", { locale: "xx" });
    expect(seen).toEqual([]);
    await core.api("POST", "/api/ui/settings", { locale: "ru" });
    const msg = await ws.next(
      (m) => m.channel === "event.created" && m.data?.event?.event_type === "ui.settings.changed",
    );
    expect(msg.data.event.payload).toEqual({ locale: "ru" });
    ws.ws.close();
  });
});

describe("sound settings routes (ui.sounds, Phase 59)", () => {
  it("are off by default at 60 percent", async () => {
    const core = await boot();
    const res = await core.api("GET", "/api/ui/sounds");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ enabled: false, volume: 60 });
  });

  it("save the switch and the volume separately and read them back", async () => {
    const core = await boot();
    expect((await core.api("POST", "/api/ui/sounds", { enabled: true })).json).toEqual({
      enabled: true,
      volume: 60,
    });
    expect((await core.api("POST", "/api/ui/sounds", { volume: 0 })).json).toEqual({
      enabled: true,
      volume: 0,
    });
    expect((await core.api("GET", "/api/ui/sounds")).json).toEqual({ enabled: true, volume: 0 });
    expect(core.runtime.settings.get("ui.sounds", null)).toEqual({ enabled: true, volume: 0 });
  });

  it.each([
    ["an empty body", {}],
    ["an unknown field", { enabled: true, loud: 1 }],
    ["a string switch", { enabled: "true" }],
    ["a volume above 100", { volume: 101 }],
    ["a negative volume", { volume: -1 }],
    ["a fractional volume", { volume: 1.5 }],
    ["a string volume", { volume: "50" }],
    ["a null volume", { volume: null }],
  ])("reject %s and keep what was saved", async (_name, body) => {
    const core = await boot();
    await core.api("POST", "/api/ui/sounds", { enabled: true, volume: 30 });
    const res = await core.api("POST", "/api/ui/sounds", body);
    expect(res.status).toBe(400);
    expect((await core.api("GET", "/api/ui/sounds")).json).toEqual({ enabled: true, volume: 30 });
  });

  it("fall back field by field when the stored value is damaged", async () => {
    const core = await boot();
    core.runtime.settings.set("ui.sounds", { enabled: "yes", volume: 900 });
    expect((await core.api("GET", "/api/ui/sounds")).json).toEqual({ enabled: false, volume: 60 });
    core.runtime.settings.set("ui.sounds", "loud");
    expect((await core.api("GET", "/api/ui/sounds")).json).toEqual({ enabled: false, volume: 60 });
  });

  it("require the session token", async () => {
    const core = await boot();
    expect((await fetch(`${core.base}/api/ui/sounds`)).status).toBe(401);
    const post = await fetch(`${core.base}/api/ui/sounds`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(post.status).toBe(401);
  });

  it("tell connected views after a change, and not after a rejected one", async () => {
    const core = await boot();
    const ws = connect(core.port, TOKEN);
    await ws.opened;
    ws.send({ type: "subscribe", channels: ["event.created"] });
    const seen: string[] = [];
    core.runtime.bus.subscribe("test-sounds", "ui.*", (e) => void seen.push(e.event_type));
    await core.api("POST", "/api/ui/sounds", { volume: 500 });
    expect(seen).toEqual([]);
    await core.api("POST", "/api/ui/sounds", { enabled: true, volume: 42 });
    const msg = await ws.next(
      (m) => m.channel === "event.created" && m.data?.event?.event_type === "ui.sounds.changed",
    );
    expect(msg.data.event.payload).toEqual({ enabled: true, volume: 42 });
    ws.ws.close();
  });
});
