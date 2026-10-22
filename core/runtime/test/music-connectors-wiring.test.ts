// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { afterEach, describe, expect, it } from "vitest";
import { startCore, type TestCore } from "./helpers";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function boot(): Promise<TestCore> {
  const core = await startCore();
  cleanups.push(() => core.runtime.stop());
  return core;
}

const enabledSites = async (core: TestCore): Promise<string[]> =>
  (await core.api("GET", "/api/music/connectors")).json.sites
    .filter((s: { enabled: boolean }) => s.enabled)
    .map((s: { site: string }) => s.site);

describe("music site opt-in through the running Core", () => {
  it("lists every site as off, with its exact hosts, and needs the session token", async () => {
    const core = await boot();
    const { sites } = (await core.api("GET", "/api/music/connectors")).json;
    expect(sites.map((s: { site: string }) => s.site).sort()).toEqual([
      "bandcamp",
      "soundcloud",
      "spotify-web",
      "youtube",
    ]);
    expect(sites.every((s: { enabled: boolean }) => !s.enabled)).toBe(true);
    expect(sites.find((s: { site: string }) => s.site === "youtube").hosts).toContain(
      "www.youtube.com",
    );
    expect((await fetch(`${core.base}/api/music/connectors`)).status).toBe(401);
  });

  it("builds a search address only for a site the user allowed, and never fetches it", async () => {
    const core = await boot();
    const search = (site: string, body: unknown) =>
      core.api("POST", `/api/music/connectors/${site}/search`, body);
    expect((await search("youtube", { query: "lofi beats" })).status).toBe(403);

    await core.api("PUT", "/api/music/connectors/youtube", { enabled: true });
    const ok = await search("youtube", { query: "lofi beats & more" });
    expect(ok.json).toEqual({
      url: "https://www.youtube.com/results?search_query=lofi%20beats%20%26%20more",
    });
    expect(await enabledSites(core)).toEqual(["youtube"]);
    // Another site stays off.
    expect((await search("soundcloud", { query: "x" })).status).toBe(403);
  });

  it("exempts only YouTube's own player from ad blocking, and only while it is on", async () => {
    const core = await boot();
    const stance = async () =>
      Object.fromEntries(
        (await core.api("GET", "/api/music/connectors")).json.sites.map(
          (s: { site: string; adBlocking: string }) => [s.site, s.adBlocking],
        ),
      );
    expect(await stance()).toEqual({
      youtube: "normal",
      soundcloud: "normal",
      bandcamp: "normal",
      "spotify-web": "normal",
    });
    await core.api("PUT", "/api/music/connectors/youtube", { enabled: true });
    await core.api("PUT", "/api/music/connectors/bandcamp", { enabled: true });
    expect(await stance()).toMatchObject({ youtube: "exempt", bandcamp: "normal" });
    await core.api("PUT", "/api/music/connectors/youtube", { enabled: false });
    expect((await stance()).youtube).toBe("normal");
  });

  it("refuses an unknown site, a malformed switch and an unusable query, and audits each change", async () => {
    const core = await boot();
    expect((await core.api("PUT", "/api/music/connectors/napster", { enabled: true })).status).toBe(
      404,
    );
    for (const bad of [{}, { enabled: "yes" }, { enabled: true, extra: 1 }])
      expect((await core.api("PUT", "/api/music/connectors/youtube", bad)).status).toBe(400);
    expect(await enabledSites(core)).toEqual([]);

    await core.api("PUT", "/api/music/connectors/youtube", { enabled: true });
    for (const query of ["", "   ", "x".repeat(201), 5])
      expect(
        (await core.api("POST", "/api/music/connectors/youtube/search", { query })).status,
      ).toBe(400);
    const audited = core.runtime.permissions.audit
      .list({ limit: 50 })
      .filter((e) => e.action === "music_connectors.changed");
    expect(audited).toHaveLength(1);
  });

  it("stores the choice in settings, where a restart finds it", async () => {
    const core = await boot();
    await core.api("PUT", "/api/music/connectors/spotify-web", { enabled: true });
    expect(core.runtime.musicConnectors.enabledCount()).toBe(1);
    expect(core.runtime.settings.get("music-connectors.enabled", [])).toEqual(["spotify-web"]);
  });
});
