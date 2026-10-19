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
