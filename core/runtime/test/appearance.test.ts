// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { readFileSync } from "node:fs";
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

const pack = (over: Record<string, unknown> = {}, layer: Record<string, unknown> = {}) => ({
  format: "phoenix-outfit",
  version: 1,
  id: "mine",
  name: "Mine",
  author: "Me",
  license: "CC0-1.0",
  layers: [{ slot: "head", svg: '<circle cx="30" cy="20" r="4" fill="#ff0000"/>', ...layer }],
  ...over,
});

describe("Fawkes appearance routes", () => {
  it("starts with no outfit, northern hemisphere and a look for every known source", async () => {
    const core = await boot();
    const res = await core.api("GET", "/api/fawkes/appearance");
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ outfit: "none", hemisphere: "north", packs: [] });
    expect(res.json.builtin.map((b: { id: string }) => b.id)).toContain("ember-scarf");
    const agent = res.json.known.find((k: { id: string }) => k.id === "agent:claude-code");
    expect(agent).toMatchObject({ kind: "agent" });
    expect(res.json.sources["agent:claude-code"]).toMatchObject({ show: true });
    expect(res.json.sources["agent:claude-code"].colour).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("requires the session token", async () => {
    const core = await boot();
    const bare = await fetch(`${core.base}/api/fawkes/appearance`);
    expect(bare.status).toBe(401);
    const post = await fetch(`${core.base}/api/fawkes/appearance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outfit: "none" }),
    });
    expect(post.status).toBe(401);
  });

  it("saves the outfit, hemisphere and a source's colour, glyph and visibility", async () => {
    const core = await boot();
    const res = await core.api("POST", "/api/fawkes/appearance", {
      outfit: "auto-season",
      hemisphere: "south",
      sources: { "agent:codex": { colour: "#1971c2", glyph: "ring", show: false } },
    });
    expect(res.status).toBe(200);
    expect(res.json.outfit).toBe("auto-season");
    expect(res.json.hemisphere).toBe("south");
    expect(res.json.sources["agent:codex"]).toEqual({
      colour: "#1971c2",
      glyph: "ring",
      show: false,
    });
    const again = await core.api("GET", "/api/fawkes/appearance");
    expect(again.json.sources["agent:codex"]).toEqual({
      colour: "#1971c2",
      glyph: "ring",
      show: false,
    });
  });

  it("merges a partial source patch with the existing look", async () => {
    const core = await boot();
    await core.api("POST", "/api/fawkes/appearance", {
      sources: { "agent:codex": { colour: "#1971c2", glyph: "ring" } },
    });
    const res = await core.api("POST", "/api/fawkes/appearance", {
      sources: { "agent:codex": { show: false } },
    });
    expect(res.json.sources["agent:codex"]).toEqual({
      colour: "#1971c2",
      glyph: "ring",
      show: false,
    });
  });

  describe("validation", () => {
    const bad: [string, unknown][] = [
      ["a named colour", { sources: { "agent:codex": { colour: "red" } } }],
      ["an uppercase hex colour", { sources: { "agent:codex": { colour: "#AABBCC" } } }],
      ["a short hex colour", { sources: { "agent:codex": { colour: "#abc" } } }],
      ["a url as a colour", { sources: { "agent:codex": { colour: "url(https://x.invalid)" } } }],
      ["an unknown glyph", { sources: { "agent:codex": { glyph: "skull" } } }],
      ["a non-boolean show", { sources: { "agent:codex": { show: "yes" } } }],
      ["an unknown source field", { sources: { "agent:codex": { icon: "x" } } }],
      ["an unknown capability", { sources: { "capability:nope": { show: false } } }],
      ["a source id of neither kind", { sources: { "service:x": { show: false } } }],
      [
        "a source id with control characters",
        { sources: { "agent:co\u0007dex": { show: false } } },
      ],
      ["a source id with bidi characters", { sources: { "agent:co\u202edex": { show: false } } }],
      [
        "a source id with a zero-width space",
        { sources: { "agent:co\u200bdex": { show: false } } },
      ],
      ["a very long source id", { sources: { [`agent:${"a".repeat(80)}`]: { show: false } } }],
      ["sources that is not an object", { sources: [] }],
      ["an unknown outfit", { outfit: "does-not-exist" }],
      ["a non-string outfit", { outfit: 5 }],
      ["a bad hemisphere", { hemisphere: "east" }],
      ["an unknown top-level field", { packs: [] }],
    ];
    it.each(bad)("rejects %s", async (_name, body) => {
      const core = await boot();
      const res = await core.api("POST", "/api/fawkes/appearance", body);
      expect(res.status).toBe(400);
      expect((await core.api("GET", "/api/fawkes/appearance")).json.outfit).toBe("none");
    });

    it("rejects more than 64 styled sources", async () => {
      const core = await boot();
      const sources: Record<string, unknown> = {};
      for (let i = 0; i < 65; i++) sources[`agent:a${i}`] = { show: false };
      expect((await core.api("POST", "/api/fawkes/appearance", { sources })).status).toBe(400);
    });

    it("rejects an oversize body (413) rather than reading it", async () => {
      const core = await boot();
      const res = await core.api("POST", "/api/fawkes/appearance", { outfit: "x".repeat(300_000) });
      expect(res.status).toBe(413);
    });
  });
});

describe("outfit packs", () => {
  it("imports a valid pack, lists it and lets it be worn, then deletes it and takes it off", async () => {
    const core = await boot();
    const res = await core.api("POST", "/api/fawkes/packs", pack());
    expect(res.status).toBe(200);
    expect(res.json.packs.map((p: { id: string }) => p.id)).toEqual(["mine"]);
    expect((await core.api("POST", "/api/fawkes/appearance", { outfit: "mine" })).json.outfit).toBe(
      "mine",
    );
    const gone = await core.api("DELETE", "/api/fawkes/packs/mine");
    expect(gone.status).toBe(200);
    expect(gone.json.packs).toEqual([]);
    expect(gone.json.outfit).toBe("none");
    expect((await core.api("DELETE", "/api/fawkes/packs/mine")).status).toBe(404);
  });

  it("replaces a pack with the same id instead of adding a second one", async () => {
    const core = await boot();
    await core.api("POST", "/api/fawkes/packs", pack());
    const res = await core.api("POST", "/api/fawkes/packs", pack({ name: "Mine v2" }));
    expect(res.json.packs).toHaveLength(1);
    expect(res.json.packs[0].name).toBe("Mine v2");
  });

  it("refuses a pack that takes a built-in outfit's id", async () => {
    const core = await boot();
    expect((await core.api("POST", "/api/fawkes/packs", pack({ id: "ember-scarf" }))).status).toBe(
      400,
    );
  });

  const hostile: [string, Record<string, unknown>][] = [
    ["a script", pack({}, { svg: "<script>alert(1)</script>" })],
    ["a foreignObject", pack({}, { svg: '<foreignObject width="1" height="1"/>' })],
    ["an on* attribute", pack({}, { svg: '<path d="M1 1 L2 2" onload="x()"/>' })],
    ["a javascript: fill", pack({}, { svg: '<path d="M1 1 L2 2" fill="javascript:x"/>' })],
    ["an external use", pack({}, { svg: '<use href="https://example.invalid/x.svg#a"/>' })],
    ["a bidi name", pack({ name: "Lovely\u202eevil" })],
    ["a control character in the author", pack({ author: "A\u0000B" })],
    ["a zero-width space in the licence", pack({ license: "MIT\u200b" })],
    ["a too-long name", pack({ name: "n".repeat(41) })],
    ["an unknown animation", pack({}, { animation: "x", still: '<circle cx="3" cy="3" r="1"/>' })],
  ];
  it.each(hostile)("rejects a pack with %s, server-side, and stores nothing", async (_n, body) => {
    const core = await boot();
    const res = await core.api("POST", "/api/fawkes/packs", body);
    expect(res.status).toBe(400);
    expect((await core.api("GET", "/api/fawkes/appearance")).json.packs).toEqual([]);
  });

  it("allows at most 8 imported packs", async () => {
    const core = await boot();
    for (let i = 0; i < 8; i++) {
      expect((await core.api("POST", "/api/fawkes/packs", pack({ id: `pack-${i}a` }))).status).toBe(
        200,
      );
    }
    expect((await core.api("POST", "/api/fawkes/packs", pack({ id: "pack-9a" }))).status).toBe(400);
  });

  it("keeps imported packs within 200 KB in total", async () => {
    const core = await boot();
    // ~72 KB per pack: two fit under 200 KB, the third does not.
    const path = `<path d="M1 1 ${"L2 2 ".repeat(300)}"/>`;
    const heavy = (id: string) => ({
      ...pack({ id }),
      layers: Array.from({ length: 5 }, () => ({ slot: "aura", svg: path.repeat(10) })),
    });
    const statuses: number[] = [];
    for (const id of ["heavy-a", "heavy-b", "heavy-c"]) {
      statuses.push((await core.api("POST", "/api/fawkes/packs", heavy(id))).status);
    }
    expect(statuses).toEqual([200, 200, 400]);
    const stored = (await core.api("GET", "/api/fawkes/appearance")).json;
    expect(stored.packs).toHaveLength(2);
    expect(JSON.stringify(stored.packs).length).toBeLessThanOrEqual(200_000);
  });

  it("drops a stored pack that no longer passes the allow-list when it is read back", async () => {
    const core = await boot();
    core.runtime.settings.set("fawkes.appearance", {
      outfit: "evil",
      hemisphere: "north",
      packs: [pack({ id: "evil" }, { svg: "<script>x</script>" })],
      sources: {},
    });
    const res = await core.api("GET", "/api/fawkes/appearance");
    expect(res.json.packs).toEqual([]);
    expect(res.json.outfit).toBe("none");
  });
});

describe("live updates", () => {
  it("publishes fawkes.appearance.changed to connected views after every change", async () => {
    const core = await boot();
    const ws = connect(core.port, TOKEN);
    await ws.opened;
    ws.send({ type: "subscribe", channels: ["event.created"] });
    const seen = (type: string) =>
      ws.next((m) => m.channel === "event.created" && m.data?.event?.event_type === type);

    await core.api("POST", "/api/fawkes/appearance", { outfit: "ember-scarf" });
    expect((await seen("fawkes.appearance.changed")).data.event.payload).toEqual({
      changed: "settings",
    });

    await core.api("POST", "/api/fawkes/packs", pack());
    expect((await seen("fawkes.appearance.changed")).data.event.payload).toEqual({
      changed: "pack",
    });

    await core.api("DELETE", "/api/fawkes/packs/mine");
    await seen("fawkes.appearance.changed");
    ws.ws.close();
  });

  it("does not publish for a rejected change", async () => {
    const core = await boot();
    const seen: string[] = [];
    core.runtime.bus.subscribe("test-appearance", "fawkes.*", (e) => void seen.push(e.event_type));
    await core.api("POST", "/api/fawkes/appearance", { outfit: "nope" });
    await core.api("POST", "/api/fawkes/packs", pack({}, { svg: "<script/>" }));
    const settled = Promise.withResolvers<void>();
    setImmediate(() => settled.resolve());
    await settled.promise;
    expect(seen).toEqual([]);
  });

  it("cannot be forged through POST /api/events (core is reserved)", async () => {
    const core = await boot();
    const res = await core.api("POST", "/api/events", {
      event_id: "evt_forged0001",
      event_type: "fawkes.appearance.changed",
      version: "1.1",
      source: "core",
      timestamp: new Date().toISOString(),
      severity: "info",
      payload: {},
    });
    expect(res.status).toBe(403);
  });
});

describe("pill surface", () => {
  it("paints its own surface in the colour the Wardrobe's contrast check assumes", () => {
    // PILL_BACKGROUND is #ffffff in pet/assets (sources.ts); the pill CSS must paint exactly that.
    const css = readFileSync(
      new URL("../../../apps/web/src/components/source-pills.css", import.meta.url),
      "utf8",
    );
    const sources = readFileSync(
      new URL("../../../pet/assets/src/outfits/sources.ts", import.meta.url),
      "utf8",
    );
    const declared = /PILL_BACKGROUND = "(#[0-9a-f]{6})"/.exec(sources)?.[1];
    expect(declared).toBeTruthy();
    expect(/\.source-pill \{[^}]*background: (#[0-9a-f]{6})/s.exec(css)?.[1]).toBe(declared);
  });
});
